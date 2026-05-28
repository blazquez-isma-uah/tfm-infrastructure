import * as cdk from 'aws-cdk-lib';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

new FrontendStack(app, 'TfmFrontendStack', {
  env: {
    account: '229502948023',
    region: 'eu-west-1',
  },
  description: 'TFM Bandas de Música — Frontend React en S3 + CloudFront',
});