import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { HttpAuthorizer, IHttpRouteAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';


/**
 * Props que TfmLambdaStack recibe de otros stacks.
 * Los valores provienen de TfmAuthStack, que los expone como propiedades públicas.
 */
export interface LambdaStackProps extends cdk.StackProps {
  /** Issuer URI del User Pool de Cognito. Formato:
   *  https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_XXXXXXXXX
   *  API Gateway lo usa para verificar el claim 'iss' de cada JWT entrante.
   */
  cognitoIssuerUri: string;

  /** Client ID del App Client de Cognito (el cliente público del frontend).
   *  API Gateway lo usa para verificar el claim 'aud' o 'client_id' de cada JWT.
   *  Solo tokens emitidos para este cliente son aceptados.
   */
  cognitoClientId: string;

    /** JWKS URI del User Pool de Cognito. Formato:
     * https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_XXXXXXXXX/.well-known/jwks.json
     * La Lambda de Identity lo usa para validar la firma de los JWT que recibe en las peticiones.
     * Aunque API Gateway también valida la firma, es buena práctica validar el token dentro de la Lambda para mayor seguridad.
     */
  cognitoJwksUri: string;

  /** User Pool ID del User Pool de Cognito. Formato:
   * eu-west-1_XXXXXXXXX
   * La Lambda de Identity lo usa para llamar a la Cognito Admin API y gestionar usuarios y grupos.
   */ 
  cognitoUserPoolId: string;

  /** Path absoluto o relativo al directorio raiz de cada microservicio.
   * Se usa para que CDK localice el Dockerfile.lambda y construya la imagen Docker.
   * Relativo al directorio cdk/ o absoluto segun el entorno de desarrollo.
   */
  identityServicePath: string;
}

export class TfmLambdaStack extends cdk.Stack {

  /**
   * URL base del API Gateway. Formato:
   * https://XXXXXXXXXX.execute-api.eu-west-1.amazonaws.com
   * 
   * Se expone como propiedad pública para que pueda usarse como variable
   * de entorno en las Lambdas cuando se configuren las URLs de Feign
   * (IDENTITY_SERVICE_URI, SURVEYS_SERVICE_URI, EVENTS_SERVICE_URI).
   */
  public readonly apiUrl: string;


  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // ── 1. API Gateway HTTP API ────────────────────────────────────────────
    //
    // HTTP API (apigatewayv2) en lugar de REST API (apigateway) por tres razones:
    //   1. JWT Authorizer nativo: no requiere Lambda Authorizer adicional
    //   2. Payload format v2: compatible con HttpApiV2ProxyRequest en los LambdaHandlers
    //   3. Coste y latencia: ~3.5x más barata y ~5ms menos de overhead que REST API
    //
    // corsAllowance NO se configura aquí porque CORS lo gestiona el frontend a través de CloudFront. 
    // Las Lambdas reciben peticiones desde API Gateway (mismo dominio desde la perspectiva del navegador si se configura CF delante),
    // o directamente en desarrollo desde el frontend local con su propia config CORS.
    // En cualquier caso, CORS en API Gateway y en Spring (@Profile("docker")) son mutuamente excluyentes por diseño.
    const api = new apigatewayv2.HttpApi(this, 'TfmHttpApi', {
      apiName: 'tfm-bandas-api',
      description: 'TFM Bandas de Musica - API Gateway HTTP API',
      // Sin defaultAuthorizer: las rutas públicas no deben heredar el authorizer.
      // El JWT Authorizer se asigna ruta a ruta de forma explícita.
    });

    // ── 2. JWT Authorizer ──────────────────────────────────────────────────
    //
    // El JWT Authorizer valida cada petición antes de invocar la Lambda:
    //   1. Extrae el token de Authorization: Bearer <token>
    //   2. Descarga y cachea el JWKS de Cognito
    //   3. Verifica la firma RSA del token
    //   4. Verifica que 'iss' == issuer (el User Pool de Cognito)
    //   5. Verifica que 'client_id' == audience (el App Client del frontend)
    //   6. Si todo es correcto -> invoca la Lambda
    //   7. Si algo falla -> 401 Unauthorized sin invocar la Lambda
    //
    // Nota sobre 'audience': Cognito emite tokens con el claim 'client_id', no con 'aud' estándar de OAuth2. 
    // API Gateway HTTP API acepta ambos cuando se configura en 'identitySource' el header Authorization.
    // Por eso el audience aquí es el Client ID del App Client, no una URL.
    const jwtAuthorizer = new apigatewayv2.HttpAuthorizer(this, 'CognitoJwtAuthorizer', {
      httpApi: api,
      type: apigatewayv2.HttpAuthorizerType.JWT,
      authorizerName: 'cognito-jwt-authorizer',
      // Dónde buscar el token en la petición entrante
      identitySource: ['$request.header.Authorization'],
      jwtIssuer: props.cognitoIssuerUri,
      jwtAudience: [props.cognitoClientId],
    });

    // Helper para asignar el JWT Authorizer a rutas protegidas.
    // HttpAuthorizer (clase L2 de CDK) no implementa IHttpRouteAuthorizer directamente.
    // Es necesario construir el objeto que implementa la interfaz manualmente.
    // Este patron se repite para cada ruta protegida del API Gateway.
    const jwtAuth: apigatewayv2.IHttpRouteAuthorizer = {
      authorizerId: jwtAuthorizer.authorizerId,
      authorizerType: apigatewayv2.HttpAuthorizerType.JWT,
      bind: () => ({
        authorizerId: jwtAuthorizer.authorizerId,
        authorizationType: 'JWT',
      }),
    } as apigatewayv2.IHttpRouteAuthorizer;


    // ── 3. MS Identity ────────────────────────────────────────────────────
    // Identity es stateless (sin BD) y actúa como adaptador entre el sistema y la Cognito Admin API
    // Utiliza empaquetado con JAR/ZIP en lugar de imagen Docker porque es compatible con SnapStart, que ayuda a reducir el cold start de Spring Boot en Lambda.

    // 3a. IAM Role para la Lambda de Identity
    // Cada Lambda tiene su propio IAM Role con permisos mínimos. Identity necesita:
    const identityRole = new iam.Role(this, 'IdentityLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM Role para Lambda MS Identity - acceso a CloudWatch y Cognito Admin API',
      // AWSLambdaBasicExecutionRole: escribir logs en CloudWatch (obligatorio)
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      // cognito-idp:*: llamar a la Cognito Admin API para gestionar usuarios y roles
      inlinePolicies: {
        CognitoAdminPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              // Permisos para gestionar usuarios y grupos en el User Pool de Cognito.
              // Se limita al ARN del User Pool concreto del proyecto (no a todos los User Pools).
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminDeleteUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminAddUserToGroup',
                'cognito-idp:AdminRemoveUserFromGroup',
                'cognito-idp:AdminListGroupsForUser',
                'cognito-idp:ListUsers',
                'cognito-idp:ListGroups',
                'cognito-idp:GetGroup',
                'cognito-idp:CreateGroup',
                'cognito-idp:DeleteGroup',
              ],
              resources: [
                `arn:aws:cognito-idp:eu-west-1:${this.account}:userpool/${props.cognitoUserPoolId}`,
              ],
            }),
          ],
        }),
      },
    });

    // 3b. Lambda Function para MS Identity
    // Function con Code.fromAsset: Lambda que usa un JAR/ZIP en lugar de imagen Docker.
    const identityLambda = new lambda.Function(this, 'IdentityLambda', {
      functionName: 'tfm-identity',
      description: 'MS Identity - Adaptador Cognito Admin API. Stateless, sin BD.',
      runtime: lambda.Runtime.JAVA_21, // runtime gestionado de AWS para Java 21
      // handler: 'com.tfm.bandas.identity.LambdaHandler::handleRequest', // clase y metodo que Lambda invoca por cada peticion entrante
      // Handler oficial delegado de aws-serverless-java-container 2.x.
      // No usamos un handler propio: SpringDelegatingLambdaContainerHandler
      // procesa correctamente las peticiones HTTP API v2 mediante
      // AwsSpringHttpProcessingUtils. La clase principal de Spring Boot se
      // indica con la variable de entorno MAIN_CLASS.
      handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
      // El código de la Lambda se empaqueta como un JAR ejecutable (con todas las dependencias incluidas) usando el plugin maven-shade.
      code: lambda.Code.fromAsset(props.identityServicePath + '/target/app.jar'),
      role: identityRole,
      // 1024MB de memoria para mejorar el rendimiento de arranque de Spring Boot.
      memorySize: 1024,
      // 30s: Spring Boot con SnapStart arranca en 1-2s. 
      // 30s es margen suficiente para el primer cold start real si SnapStart falla por algún motivo.
      timeout: cdk.Duration.seconds(30),
      environment: {
        SPRING_PROFILES_ACTIVE: 'aws',
        // Clase @SpringBootApplication que el handler delegado debe arrancar.
        MAIN_CLASS: 'com.tfm.bandas.identity.IdentityApplication',
        COGNITO_JWKS_URI: props.cognitoJwksUri,
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        COGNITO_PERMITTED_ROLES: 'ADMIN,MUSICIAN',
        // Issuer de Cognito para validar el claim 'iss' de los JWT. 
        COGNITO_ISSUER_URI: props.cognitoIssuerUri,
      },
    });

    // SnapStart: toma un snapshot del proceso Java despues de que el bloque estatico de LambdaHandler haya inicializado Spring Boot completo.
    // Las invocaciones posteriores restauran ese snapshot en ~1-2s en lugar de arrancar Spring Boot desde cero (~10-15s).
    // Escape hatch: acceder al recurso CloudFormation subyacente para activar SnapStart.
    // CDK L2 (Function) no expone SnapStart directamente - es necesario usar el recurso L1 (CfnFunction) subyacente.
    const cfnIdentityLambda = identityLambda.node.defaultChild as lambda.CfnFunction;
    cfnIdentityLambda.snapStart = {
      // La activación de SnapStart se hace sobre la versión publicada de la Lambda, no sobre $LATEST.
      // applyOn: 'PublishedVersions',
      // SnapStart descartado.
      // El restore (~1s) no compensa con el tiempo de restablecimiento de conexiones HTTP en la primera invocación post-restore (~16s)
      applyOn: 'None', // Sin publicar versiones, SnapStart se aplica a $LATEST. Útil en desarrollo para evitar tener que publicar cada vez.
    };

    // Alias 'live' apuntando a la version publicada con SnapStart.
    // SnapStart solo aplica a versiones publicadas, no a $LATEST.
    // Sin este alias, API Gateway invocaria $LATEST y el snapshot
    // nunca se usaria - el cold start seguiria siendo de ~9-12 segundos.
    // Con el alias, cada deploy publica una nueva version con su snapshot
    // y el alias se actualiza para apuntar a ella.
    const identityAlias = new lambda.Alias(this, 'IdentityAlias', {
      aliasName: 'live',
      version: identityLambda.currentVersion,
      description: 'Alias live - apunta a la version publicada con SnapStart activo',
    });

    // 3c. Ruta en API Gateway para MS Identity
    // JWT Authorizer aplicado: Identity requiere autenticación en todos sus endpoints.
    // No hay rutas públicas en Identity.
    // authorizationScopes: vacío - no usamos OAuth2 scopes, la autorización  la gestiona Spring Security con @PreAuthorize dentro de la Lambda.
    const identityIntegration = new apigatewayv2integrations.HttpLambdaIntegration(
      'IdentityIntegration',
      identityAlias,
    );

    // ANY /api/identity/{proxy+} captura cualquier método HTTP y cualquier sub-path bajo /api/identity/. 
    // El {proxy+} es un greedy path parameter que pasa el path completo a la Lambda, que lo procesa con Spring MVC.
    api.addRoutes({
      path: '/api/identity/{proxy+}',
      // Se usa ANY en lugar de metodos especificos (GET, POST, etc.) porque la autorizacion por metodo ya la gestiona Spring Security con @PreAuthorize
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: identityIntegration,
      authorizer: jwtAuth,
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.apiEndpoint,
      description: 'URL base del API Gateway - usar como base para todas las llamadas REST',
    });

    new cdk.CfnOutput(this, 'JwtAuthorizerId', {
      value: jwtAuthorizer.authorizerId,
      description: 'ID del JWT Authorizer - referencia interna para asignar a rutas',
    });

    new cdk.CfnOutput(this, 'IdentityLambdaArn', {
      value: identityLambda.functionArn,
      description: 'ARN de la Lambda MS Identity',
    });

    new cdk.CfnOutput(this, 'IdentityAliasArn', {
      value: identityAlias.functionArn,
      description: 'ARN del alias live de Lambda MS Identity - SnapStart activo',
    });
  }
}