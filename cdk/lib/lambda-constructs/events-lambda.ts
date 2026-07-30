import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { LambdaStackProps, LambdaCodeResolver } from '../lambda-stack';

export interface EventsLambdaResult {
  lambda: lambda.Function;
  alias: lambda.Alias;
}

export function createEventsLambda(
  scope: Construct,
  props: LambdaStackProps,
  lambdaCode: LambdaCodeResolver,
  api: apigatewayv2.HttpApi,
  jwtAuth: apigatewayv2.IHttpRouteAuthorizer,
  apiUrl: string,
): EventsLambdaResult {
  // ─── MS Events ───────────────────────────────────────────────────────────────
  // 1. IAM Role
  const eventsRole = new iam.Role(scope, 'EventsLambdaRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description: 'IAM Role para Lambda MS Events',
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'
      ),
    ],
  });

  // 2. Lambda con JAR Shade (no imagen Docker — SnapStart no soporta imágenes Docker)
  const eventsLambda = new lambda.Function(scope, 'EventsLambda', {
    functionName: 'tfm-events',
    runtime: lambda.Runtime.JAVA_21,
    handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
    // El código de la Lambda se empaqueta en un JAR/ZIP con maven-shade y se sube a S3.
    code: lambdaCode(props.eventsServicePath, 'tfm-events/app.jar'),
    role: eventsRole,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(45),
    environment: {
      SPRING_PROFILES_ACTIVE: 'aws',
      MAIN_CLASS: 'com.tfm.bandas.events.EventosApplication',
      COGNITO_JWKS_URI: props.cognitoJwksUri,
      COGNITO_ISSUER_URI: props.cognitoIssuerUri,
      SURVEYS_SERVICE_URI: apiUrl,
      SURVEYS_SERVICE_DELETE_BY_EVENT_ID_PATH: props.surveysServiceDeleteByEventIdPath,
      DB_URL: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/url/events'),
      DB_USERNAME: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/username'),
      // DB_PASSWORD se lee de SSM como String (no SecureString) por decision documentada.
      // CloudFormation no puede resolver {{resolve:ssm-secure:...}} en variables de entorno de Lambda.
      // Lambda cifra las variables de entorno at rest con KMS por defecto, lo que da un nivel de proteccion equivalente.
      // La alternativa de Secrets Manager (SecretValue.secretsManager) introduciria
      // una dependencia adicional sin beneficio de seguridad real en este contexto.
      DB_PASSWORD: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/password'),
    },
  });

  // 3. SnapStart via escape hatch (no hay API nativa en CDK para esto)
  const cfnEventsLambda = eventsLambda.node.defaultChild as lambda.CfnFunction;
  cfnEventsLambda.snapStart = { applyOn: 'PublishedVersions' };

  // 4. Alias — SnapStart solo aplica a versiones publicadas, no a $LATEST
  const eventsAlias = new lambda.Alias(scope, 'EventsAlias', {
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

  return { lambda: eventsLambda, alias: eventsAlias };
}
