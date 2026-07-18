import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { LambdaStackProps, LambdaCodeResolver } from '../lambda-stack';

export interface UsersLambdaResult {
  lambda: lambda.Function;
  alias: lambda.Alias;
}

export function createUsersLambda(
  scope: Construct,
  props: LambdaStackProps,
  lambdaCode: LambdaCodeResolver,
  api: apigatewayv2.HttpApi,
  jwtAuth: apigatewayv2.IHttpRouteAuthorizer,
  apiUrl: string,
): UsersLambdaResult {
  // ─── Bucket S3 para fotos de perfil ───────────────────────────────────────
  // Privado: el acceso siempre pasa por presigned URLs generadas por MS Users, nunca por URL pública directa.
  // Sin versionado: cada subida sobrescribe la anterior (key = {iamId}.jpg), no se conserva histórico de fotos.
  const profilePicturesBucket = new s3.Bucket(scope, 'ProfilePicturesBucket', {
    bucketName: `tfm-profile-pictures-${cdk.Stack.of(scope).account}`,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    cors: [
      {
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
        allowedOrigins: [
          'https://d36zednbsqfg0h.cloudfront.net',
          'http://localhost:5173',
        ],
        allowedHeaders: ['*'],
        maxAge: 3000,
      },
    ],
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
  const usersRole = new iam.Role(scope, 'UsersLambdaRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description: 'IAM Role para Lambda MS Users - acceso a CloudWatch',
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    ],
    // Permisos para generar presigned URLs de PUT y GET en el bucket de fotos de perfil
    inlinePolicies: {
      ProfilePicturesPolicy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject', 's3:GetObject'],
            resources: [`${profilePicturesBucket.bucketArn}/*`],
          }),
        ],
      }),
    },
  });

  // 2. Lambda Function para MS Users
  const usersLambda = new lambda.Function(scope, 'UsersLambda', {
    functionName: 'tfm-users',
    description: 'MS Users - Gestion de perfiles, instrumentos y roles.',
    runtime: lambda.Runtime.JAVA_21,
    handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
    // El código de la Lambda se empaqueta en un JAR/ZIP con maven-shade y se sube a S3.
    code: lambdaCode(props.usersServicePath, 'tfm-users/app.jar'),
    role: usersRole,
    memorySize: 1024,
    // 45s: con el cold start de MS Identity + el tiempo de procesamiento + overhead de red, 30s puede ser justo para las llamadas Feign.
    timeout: cdk.Duration.seconds(45),
    environment: {
      SPRING_PROFILES_ACTIVE: 'aws',
      MAIN_CLASS: 'com.tfm.bandas.users.UsuariosApplication',
      COGNITO_JWKS_URI: props.cognitoJwksUri,
      COGNITO_ISSUER_URI: props.cognitoIssuerUri,
      // Key del bucket de fotos de perfil
      PROFILE_PICTURES_BUCKET: profilePicturesBucket.bucketName,
      PROFILE_PICTURE_UPLOAD_URL_TTL_MINUTES: '5',
      PROFILE_PICTURE_DOWNLOAD_URL_TTL_MINUTES: '10',
      // URL base del API Gateway: MS Users la usa para llamar a MS Identity via Feign.
      IDENTITY_SERVICE_URI: apiUrl,
      // Credenciales de BD resueltas desde SSM Parameter Store por CloudFormation en deploy.
      // El valor real nunca aparece en el template de CloudFormation ni en los logs de CDK.
      // valueFromLookup resuelve el valor en tiempo de deploy y detecta cambios en el valor de SSM para redeployar la Lambda si cambia
      DB_URL: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/url/users'),
      DB_USERNAME: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/username'),
      // DB_PASSWORD se lee de SSM como String (no SecureString) por decision documentada.
      // CloudFormation no puede resolver {{resolve:ssm-secure:...}} en variables de entorno de Lambda.
      // Lambda cifra las variables de entorno at rest con KMS por defecto, lo que da un nivel de proteccion equivalente.
      // La alternativa de Secrets Manager (SecretValue.secretsManager) introduciria
      // una dependencia adicional sin beneficio de seguridad real en este contexto.
      DB_PASSWORD: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/password'),
    },
  });

  // SnapStart activo con CRaC.
  // SnapStartPrimingResource hace calentamiento de la conexion a BD en afterRestore.
  const cfnUsersLambda = usersLambda.node.defaultChild as lambda.CfnFunction;
  cfnUsersLambda.snapStart = {
    applyOn: 'PublishedVersions',
  };

  // Alias 'live' apuntando a la version publicada con SnapStart.
  const usersAlias = new lambda.Alias(scope, 'UsersAlias', {
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

  return { lambda: usersLambda, alias: usersAlias };
}
