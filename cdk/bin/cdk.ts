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

new FrontendStack(app, 'TfmFrontendStack', {
  env,
  description: 'TFM Bandas de Musica - Frontend React en S3 + CloudFront',
});

const authStack = new AuthStack(app, 'TfmAuthStack', {
  env,
  description: 'TFM Bandas de Musica - Autenticacion con Amazon Cognito',
});

new DatabaseStack(app, 'TfmDatabaseStack', {
  env,
  description: 'TFM Bandas de Musica - Base de datos MySQL en RDS con SSL',
});

// TfmLambdaStack recibe props de AuthStack mediante cross-stack references de CloudFormation.
// Esto crea una dependencia explícita entre stacks: TfmAuthStack debe desplegarse antes que TfmLambdaStack, 
// y no puede destruirse mientras TfmLambdaStack lo consuma.
// Trade-off aceptado conscientemente: los valores de Cognito (User Pool, Client ID) son estables y no se recrearán. 
// Así se evita hardcodear valores que podrían desincronizarse si el stack de autenticación evolucionara.
new TfmLambdaStack(app, 'TfmLambdaStack', {
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
  eventsServiceExistsPath: '/api/events/',
});