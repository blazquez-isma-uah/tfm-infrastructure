import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { LambdaStackProps, LambdaCodeResolver } from '../lambda-stack';

export interface SurveysLambdaResult {
  lambda: lambda.Function;
  alias: lambda.Alias;
}

export function createSurveysLambda(
  scope: Construct,
  props: LambdaStackProps,
  lambdaCode: LambdaCodeResolver,
  api: apigatewayv2.HttpApi,
  jwtAuth: apigatewayv2.IHttpRouteAuthorizer,
  apiUrl: string,
): SurveysLambdaResult {
  // ─── MS Surveys ──────────────────────────────────────────────────────────────

  // 1. IAM Role
  const surveysRole = new iam.Role(scope, 'SurveysLambdaRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description: 'IAM Role para Lambda MS Surveys',
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'
      ),
    ],
  });

  // 2. Lambda con JAR Shade (no imagen Docker — SnapStart no soporta imágenes Docker)
  const surveysLambda = new lambda.Function(scope, 'SurveysLambda', {
    functionName: 'tfm-surveys',
    runtime: lambda.Runtime.JAVA_21,
    handler: 'com.amazonaws.serverless.proxy.spring.SpringDelegatingLambdaContainerHandler::handleRequest',
    // El código de la Lambda se empaqueta en un JAR/ZIP con maven-shade y se sube a S3.
    code: lambdaCode(props.surveysServicePath, 'tfm-surveys/app.jar'),
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
      EVENTS_SERVICE_URI: apiUrl,
      EVENTS_SERVICE_EXISTS_PATH: props.eventsServiceExistsPath,
      DB_URL: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/url/surveys'),
      DB_USERNAME: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/username'),
      DB_PASSWORD: ssm.StringParameter.valueFromLookup(scope, '/tfm/db/password'),
    },
  });

  // 3. SnapStart via escape hatch (no hay API nativa en CDK para esto)
  const cfnSurveysLambda = surveysLambda.node.defaultChild as lambda.CfnFunction;
  cfnSurveysLambda.snapStart = { applyOn: 'PublishedVersions' };

  // 4. Alias — SnapStart solo aplica a versiones publicadas, no a $LATEST
  const surveysAlias = new lambda.Alias(scope, 'SurveysAlias', {
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

  return { lambda: surveysLambda, alias: surveysAlias };
}
