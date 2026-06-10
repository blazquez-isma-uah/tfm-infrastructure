import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
   * Se usa para que CDK localice el JAR compilado por maven-shade (target/app.jar)
   * y lo suba a Lambda como asset ZIP.
   * Relativo al directorio cdk/ o absoluto segun el entorno de desarrollo.
   */
  identityServicePath: string;

  /** Path al directorio raiz de MS Users. */
  usersServicePath: string;

  /** Path al directorio raiz de MS Events. */
  eventsServicePath: string;

  /** Path que MS Events usa para llamar a MS Surveys y eliminar encuestas por evento. */
  surveysServiceDeleteByEventIdPath: string;

  /** Ruta al directorio del proyecto tfm-surveys en disco. */
  surveysServicePath: string;
  
  /** Path de API que MS Surveys usa para llamar a MS Events y validar existencia de evento. */
  eventsServiceExistsPath: string;
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

    // ─── API Gateway HTTP API ───────────────────────────────────────────────────────────────
    // HTTP API (apigatewayv2) en lugar de REST API (apigateway) por tres razones:
    //   1. JWT Authorizer nativo: no requiere Lambda Authorizer adicional
    //   2. Payload format v2: compatible con SpringDelegatingLambdaContainerHandler
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
    this.apiUrl = api.apiEndpoint;

    // ─── JWT Authorizer ───────────────────────────────────────────────────────────────
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


    // ─── MS Identity ───────────────────────────────────────────────────────────────
    // Identity es stateless (sin BD) y actúa como adaptador entre el sistema y la Cognito Admin API
    // Utiliza empaquetado con JAR/ZIP en lugar de imagen Docker porque es compatible con SnapStart, que ayuda a reducir el cold start de Spring Boot en Lambda.

    // 1. IAM Role para la Lambda de Identity
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

    // 2. Lambda Function para MS Identity
    // Function con Code.fromAsset: Lambda que usa un JAR/ZIP en lugar de imagen Docker.
    const identityLambda = new lambda.Function(this, 'IdentityLambda', {
      functionName: 'tfm-identity',
      description: 'MS Identity - Adaptador Cognito Admin API. Stateless, sin BD.',
      runtime: lambda.Runtime.JAVA_21, // runtime gestionado de AWS para Java 21
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
      // 30s: con SnapStart + CRaC el cold start total es de ~4-7s
      // 30s da margen suficiente ante cualquier degradacion puntual de red o de restauracion.
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

    // SnapStart: toma un snapshot del proceso Java despues de que SpringDelegatingLambdaContainerHandler
    // ha completado la inicializacion asincrona de Spring Boot durante la fase INIT.
    // Con SnapStart + CRaC, el cold start total para el usuario se reduce significativamente
    // El hook CRaC afterRestore en SnapStartPrimingResource recrea
    // el cliente Cognito y pre-calienta la conexion antes de que llegue la primera peticion real.
    // Escape hatch: CDK L2 (Function) no expone SnapStart en su API de alto nivel.
    // Se accede al recurso CloudFormation subyacente (CfnFunction) para configurarlo.
    const cfnIdentityLambda = identityLambda.node.defaultChild as lambda.CfnFunction;
    cfnIdentityLambda.snapStart = {
      // SnapStart activo sobre versiones publicadas, no sobre $LATEST.
      // Requiere el alias 'live' para que API Gateway invoque la version publicada con snapshot.
      applyOn: 'PublishedVersions',
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

    // 3. Ruta en API Gateway para MS Identity
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


    // ─── MS Users ───────────────────────────────────────────────────────────────
    // Gestiona perfiles de usuario, instrumentos y roles.
    // Delega la gestion de identidades en Cognito a MS Identity via Feign.
    // Expone tres grupos de rutas: /api/users/**, /api/instruments/**, /api/roles/**

    // 1. IAM Role para Lambda MS Users
    // Users necesita:
    //   - AWSLambdaBasicExecutionRole: escribir logs en CloudWatch (obligatorio)
    // Las credenciales de BD se inyectan como variables de entorno desde SSM en tiempo de deploy via CloudFormation dynamic references.
    // No necesita ssm:GetParameter en su IAM role porque CloudFormation resuelve los parametros SSM durante el deploy, no en tiempo de ejecucion.
    const usersRole = new iam.Role(this, 'UsersLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM Role para Lambda MS Users - acceso a CloudWatch',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // 2. Lambda Function para MS Users
    const usersLambda = new lambda.Function(this, 'UsersLambda', {
      functionName: 'tfm-users',
      description: 'MS Users - Gestion de perfiles, instrumentos y roles.',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
      code: lambda.Code.fromAsset(props.usersServicePath + '/target/app.jar'),
      role: usersRole,
      memorySize: 1024,
      // 45s: con el cold start de MS Identity + el tiempo de procesamiento + overhead de red, 30s puede ser justo para las llamadas Feign.
      timeout: cdk.Duration.seconds(45),
      environment: {
        SPRING_PROFILES_ACTIVE: 'aws',
        MAIN_CLASS: 'com.tfm.bandas.users.UsuariosApplication',
        COGNITO_JWKS_URI: props.cognitoJwksUri,
        COGNITO_ISSUER_URI: props.cognitoIssuerUri,
        // URL base del API Gateway: MS Users la usa para llamar a MS Identity via Feign.
        IDENTITY_SERVICE_URI: this.apiUrl,
        // Credenciales de BD resueltas desde SSM Parameter Store por CloudFormation en deploy.
        // El valor real nunca aparece en el template de CloudFormation ni en los logs de CDK.
        DB_URL: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/url/users'),
        DB_USERNAME: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/username'),
        DB_PASSWORD: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/password'),
      },
    });

    // SnapStart activo con CRaC.
    // SnapStartPrimingResource hace calentamiento de la conexion a BD en afterRestore.
    const cfnUsersLambda = usersLambda.node.defaultChild as lambda.CfnFunction;
    cfnUsersLambda.snapStart = {
      applyOn: 'PublishedVersions',
    };

    // Alias 'live' apuntando a la version publicada con SnapStart.
    const usersAlias = new lambda.Alias(this, 'UsersAlias', {
      aliasName: 'live',
      version: usersLambda.currentVersion,
      description: 'Alias live - apunta a la version publicada con SnapStart activo',
    });

    // 3. Rutas en API Gateway para MS Users
    // Los tres grupos de rutas apuntan a la misma Lambda.
    // La autorizacion por metodo la gestiona Spring Security con @PreAuthorize.
    const usersIntegration = new apigatewayv2integrations.HttpLambdaIntegration(
      'UsersIntegration',
      usersAlias,
    );

    api.addRoutes({
      path: '/api/users/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    api.addRoutes({
      path: '/api/instruments/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    api.addRoutes({
      path: '/api/roles/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    // Rutas base sin sub-path (GET /api/users, GET /api/roles, GET /api/instruments)
    // {proxy+} requiere al menos un segmento y no captura el path base.
    // Se necesita una ruta adicional para cada path raiz.
    api.addRoutes({
      path: '/api/users',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    api.addRoutes({
      path: '/api/instruments',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    api.addRoutes({
      path: '/api/roles',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: usersIntegration,
      authorizer: jwtAuth,
    });

    // ─── MS Events ───────────────────────────────────────────────────────────────
    // 1. IAM Role
    const eventsRole = new iam.Role(this, 'EventsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM Role para Lambda MS Events',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Permiso para leer los parámetros de BD desde SSM
    // Nota: no se requiere permiso ssm:GetParameter en el role; CloudFormation resuelve los parámetros SSM al desplegar (valueForStringParameter).

    // 2. Lambda con JAR Shade (no imagen Docker — SnapStart no soporta imágenes Docker)
    const eventsLambda = new lambda.Function(this, 'EventsLambda', {
      functionName: 'tfm-events',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
      code: lambda.Code.fromAsset(props.eventsServicePath + '/target/app.jar'),
      role: eventsRole,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(45),
      environment: {
        SPRING_PROFILES_ACTIVE: 'aws',
        MAIN_CLASS: 'com.tfm.bandas.events.EventosApplication',
        COGNITO_JWKS_URI: props.cognitoJwksUri,
        COGNITO_ISSUER_URI: props.cognitoIssuerUri,
        SURVEYS_SERVICE_URI: this.apiUrl,
        SURVEYS_SERVICE_DELETE_BY_EVENT_ID_PATH: props.surveysServiceDeleteByEventIdPath,
        DB_URL: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/url/events'),
        DB_USERNAME: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/username'),
        DB_PASSWORD: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/password'),
      },
    });

    // 3. SnapStart via escape hatch (no hay API nativa en CDK para esto)
    const cfnEventsLambda = eventsLambda.node.defaultChild as lambda.CfnFunction;
    cfnEventsLambda.snapStart = { applyOn: 'PublishedVersions' };

    // 4. Alias — SnapStart solo aplica a versiones publicadas, no a $LATEST
    const eventsAlias = new lambda.Alias(this, 'EventsAlias', {
      aliasName: 'live',
      version: eventsLambda.currentVersion,
      description: 'Alias live - apunta a la version publicada con SnapStart activo',        
    });

    // 5. Integración con API Gateway
    const eventsIntegration = new apigatewayv2integrations.HttpLambdaIntegration(
      'EventsIntegration',
      eventsAlias,
    );

    // 6. Rutas — ruta base + proxy+
    //    La ruta base /api/events es necesaria porque {proxy+} requiere al menos
    //    un segmento adicional; sin ella, GET /api/events devolvería 404.
    api.addRoutes({
      path: '/api/events',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: eventsIntegration,
      authorizer: jwtAuth,
    });
    api.addRoutes({
      path: '/api/events/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: eventsIntegration,
      authorizer: jwtAuth,
    });

    // ─── MS Surveys ──────────────────────────────────────────────────────────────

    // 1. IAM Role
    const surveysRole = new iam.Role(this, 'SurveysLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM Role para Lambda MS Surveys',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Permiso para leer los parámetros de BD desde SSM
    surveysRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:eu-west-1:229502948023:parameter/tfm/db/*`,
      ],
    }));

    // 2. Lambda con JAR Shade (no imagen Docker — SnapStart no soporta imágenes Docker)
    const surveysLambda = new lambda.Function(this, 'SurveysLambda', {
      functionName: 'tfm-surveys',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
      code: lambda.Code.fromAsset(props.surveysServicePath + '/target/app.jar'),
      role: surveysRole,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(45),
      environment: {
        SPRING_PROFILES_ACTIVE: 'aws',
        MAIN_CLASS: 'com.tfm.bandas.surveys.SurveysApplication',
        COGNITO_JWKS_URI: props.cognitoJwksUri,
        COGNITO_ISSUER_URI: props.cognitoIssuerUri,
        // MS Surveys llama a MS Events vía API Gateway para validar existencia de evento
        // this.apiUrl es la URL base del API Gateway sin sufijo de path.
        // Feign construye la URL completa: EVENTS_SERVICE_URI + EVENTS_SERVICE_EXISTS_PATH + {eventId}
        EVENTS_SERVICE_URI: this.apiUrl,
        EVENTS_SERVICE_EXISTS_PATH: props.eventsServiceExistsPath,
        DB_URL: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/url/surveys'),
        DB_USERNAME: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/username'),
        DB_PASSWORD: ssm.StringParameter.valueForStringParameter(this, '/tfm/db/password'),
      },
    });

    // 3. SnapStart via escape hatch (no hay API nativa en CDK para esto)
    const cfnSurveysLambda = surveysLambda.node.defaultChild as lambda.CfnFunction;
    cfnSurveysLambda.snapStart = { applyOn: 'PublishedVersions' };

    // 4. Alias — SnapStart solo aplica a versiones publicadas, no a $LATEST
    const surveysAlias = new lambda.Alias(this, 'SurveysAlias', {
      aliasName: 'live',
      version: surveysLambda.currentVersion,
      description: 'Alias live - apunta a la version publicada con SnapStart activo',        
    });

    // 5. Integración con API Gateway
    const surveysIntegration = new apigatewayv2integrations.HttpLambdaIntegration(
      'SurveysIntegration',
      surveysAlias,
    );

    // 6. Rutas — ruta base + proxy+
    //    La ruta base /api/surveys es necesaria porque {proxy+} requiere al menos
    //    un segmento adicional; sin ella, GET /api/surveys devolvería 404.
    api.addRoutes({
      path: '/api/surveys',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: surveysIntegration,
      authorizer: jwtAuth,
    });
    api.addRoutes({
      path: '/api/surveys/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: surveysIntegration,
      authorizer: jwtAuth,
    });


    // ── Outputs ────────────────────────────────────────────────────────────
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
    
    new cdk.CfnOutput(this, 'UsersLambdaArn', {
      value: usersLambda.functionArn,
      description: 'ARN de la Lambda MS Users',
    });

    new cdk.CfnOutput(this, 'UsersAliasArn', {
      value: usersAlias.functionArn,
      description: 'ARN del alias live de Lambda MS Users - SnapStart activo',
    });
    
    new cdk.CfnOutput(this, 'EventsLambdaArn', {
      value: eventsLambda.functionArn,
      description: 'ARN de la Lambda MS Events',
    });

    new cdk.CfnOutput(this, 'EventsAliasArn', {
      value: eventsAlias.functionArn,
      description: 'ARN del alias live de Lambda MS Events - SnapStart activo',
    });

    new cdk.CfnOutput(this, 'SurveysLambdaArn', {
      value: surveysLambda.functionArn,
      description: 'ARN de la Lambda MS Surveys',
    });

    new cdk.CfnOutput(this, 'SurveysAliasArn', {
      value: surveysAlias.functionArn,
      description: 'ARN del alias live de Lambda MS Surveys - SnapStart activo',
    });
  }
}