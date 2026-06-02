import * as cdk from 'aws-cdk-lib';
import { FrontendStack } from '../lib/frontend-stack';
import { AuthStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';

const app = new cdk.App();

const env = {
    account: '229502948023',
    region: 'eu-west-1',
  };

new FrontendStack(app, 'TfmFrontendStack', {
  env,
  description: 'TFM Bandas de Música - Frontend React en S3 + CloudFront',
});

new AuthStack(app, 'TfmAuthStack', {
  env,
  description: 'TFM Bandas de Música - Autenticación con Amazon Cognito (User Pool, grupos, App Client)',
});

new DatabaseStack(app, 'TfmDatabaseStack', {
  env,
  description: 'TFM Bandas de Música - Base de datos MySQL en RDS MySQL con SSL obligatorio y SSM Parameter Store',
});