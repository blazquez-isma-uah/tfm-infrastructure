import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { LambdaStackProps, LambdaCodeResolver } from '../lambda-stack';

export interface IdentityLambdaResult {
  lambda: lambda.Function;
  alias: lambda.Alias;
}

export function createIdentityLambda(
  scope: Construct,
  props: LambdaStackProps,
  lambdaCode: LambdaCodeResolver,
  api: apigatewayv2.HttpApi,
  jwtAuth: apigatewayv2.IHttpRouteAuthorizer,
): IdentityLambdaResult {
  // ─── MS Identity ───────────────────────────────────────────────────────────────
  // Identity es stateless (sin BD) y actúa como adaptador entre el sistema y la Cognito Admin API
  // Utiliza empaquetado con JAR/ZIP en lugar de imagen Docker porque es compatible con SnapStart, que ayuda a reducir el cold start de Spring Boot en Lambda.

  // 1. IAM Role para la Lambda de Identity
  // Cada Lambda tiene su propio IAM Role con permisos mínimos. Identity necesita:
  const identityRole = new iam.Role(scope, 'IdentityLambdaRole', {
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
              `arn:aws:cognito-idp:eu-west-1:${cdk.Stack.of(scope).account}:userpool/${props.cognitoUserPoolId}`,
            ],
          }),
        ],
      }),
    },
  });

  // 2. Lambda Function para MS Identity
  // Function con Code.fromAsset: Lambda que usa un JAR/ZIP en lugar de imagen Docker.
  const identityLambda = new lambda.Function(scope, 'IdentityLambda', {
    functionName: 'tfm-identity',
    description: 'MS Identity - Adaptador Cognito Admin API. Stateless, sin BD.',
    runtime: lambda.Runtime.JAVA_21, // runtime gestionado de AWS para Java 21
    // Handler oficial delegado de aws-serverless-java-container 2.x.
    // No usamos un handler propio: SpringDelegatingLambdaContainerHandler
    // procesa correctamente las peticiones HTTP API v2 mediante
    // AwsSpringHttpProcessingUtils. La clase principal de Spring Boot se
    // indica con la variable de entorno MAIN_CLASS.
    handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
    // El código de la Lambda se empaqueta en un JAR/ZIP con maven-shade y se sube a S3.
    code: lambdaCode(props.identityServicePath, 'tfm-identity/app.jar'),
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
  const identityAlias = new lambda.Alias(scope, 'IdentityAlias', {
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

  return { lambda: identityLambda, alias: identityAlias };
}
