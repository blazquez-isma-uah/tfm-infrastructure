import * as cdk from 'aws-cdk-lib';
import { FrontendStack } from '../lib/frontend-stack';
import { AuthStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';
import { TfmLambdaStack } from '../lib/lambda-stack';

const app = new cdk.App();

const env = {
  account: '229502948023',
  region: 'eu-west-1',
};


const authStack = new AuthStack(app, 'TfmAuthStack', {
  env,
  description: 'TFM Bandas de Musica - Autenticacion con Amazon Cognito',
});

const databaseStack = new DatabaseStack(app, 'TfmDatabaseStack', {
  env,
  description: 'TFM Bandas de Musica - Base de datos MySQL en RDS con SSL',
});

// TfmLambdaStack recibe props de AuthStack mediante cross-stack references de CloudFormation.
// Esto crea una dependencia explícita entre stacks: TfmAuthStack debe desplegarse antes que TfmLambdaStack, 
// y no puede destruirse mientras TfmLambdaStack lo consuma.
// Trade-off aceptado conscientemente: los valores de Cognito (User Pool, Client ID) son estables y no se recrearán. 
// Así se evita hardcodear valores que podrían desincronizarse si el stack de autenticación evolucionara.
// TfmLambdaStack se instancia antes que FrontendStack porque FrontendStack
// necesita el endpoint del API Gateway para configurar el behavior /api/* de CloudFront.
// TfmLambdaStack expone apiUrl como propiedad publica para este proposito.
const lambdaStack = new TfmLambdaStack(app, 'TfmLambdaStack', {
  env,
  description: 'TFM Bandas de Musica - Lambdas, API Gateway y JWT Authorizer',
  cognitoIssuerUri: authStack.issuerUri,
  cognitoClientId: authStack.userPoolClientId,
  cognitoJwksUri: authStack.jwksUri,
  cognitoUserPoolId: authStack.userPoolId,
  identityServicePath: '../../identity',
  usersServicePath: '../../users',
  eventsServicePath: '../../events',
  surveysServiceDeleteByEventIdPath: '/api/surveys/event/',
  surveysServicePath: '../../surveys',
  eventsServiceExistsPath: '/api/events/{eventId}',
  // Identificador de la instancia RDS para las Lambdas de scheduler y health check.
  // Cross-stack reference: TfmDatabaseStack exporta el valor, TfmLambdaStack lo importa.
  rdsInstanceId: databaseStack.dbInstanceIdentifier,
});

// FrontendStack recibe el endpoint del API Gateway via cross-stack reference.
// Esto garantiza que el hostname de CloudFront siempre apunta al API Gateway
// correcto, sin valores hardcodeados que puedan desincronizarse.
new FrontendStack(app, 'TfmFrontendStack', {
  env,
  description: 'TFM Bandas de Musica - Frontend React en S3 + CloudFront',
  apiGatewayEndpoint: lambdaStack.apiUrl,
});