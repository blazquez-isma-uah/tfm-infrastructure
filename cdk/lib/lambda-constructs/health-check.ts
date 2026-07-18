import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { LambdaStackProps } from '../lambda-stack';

export interface HealthCheckAliases {
  identityAlias: lambda.Alias;
  usersAlias: lambda.Alias;
  eventsAlias: lambda.Alias;
  surveysAlias: lambda.Alias;
}

export function createHealthCheckLambda(
  scope: Construct,
  props: LambdaStackProps,
  api: apigatewayv2.HttpApi,
  aliases: HealthCheckAliases,
): lambda.Function {
  // ─── Lambda Health Check — arranque de RDS y warm-up ─────────────────────────
  // Endpoint público GET /health/database llamado desde LoginPage antes del login.
  // Comprueba el estado de RDS, la arranca si está parada, y lanza warm-up de las
  // Lambdas de negocio en fire-and-forget para aprovechar el tiempo de arranque de RDS.

  const { identityAlias, usersAlias, eventsAlias, surveysAlias } = aliases;

  const healthRole = new iam.Role(scope, 'RdsHealthLambdaRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description: 'IAM Role para Lambda de health check y arranque de RDS',
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    ],
    inlinePolicies: {
      RdsHealthPolicy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            // InvokeFunction: invocar Lambda de Identity para warm-up
            // Aurora no necesita permisos IAM: se reanuda automáticamente
            // al recibir la primera conexión TCP, sin StartDBInstance.
            actions: ['lambda:InvokeFunction'],
            resources: [
              identityAlias.functionArn,
            ],
          }),
        ],
      }),
    },
  });

  const healthLambda = new lambda.Function(scope, 'RdsHealthLambda', {
    functionName: 'tfm-rds-health',
    description: 'Health check de RDS: comprueba estado, arranca si parada, warm-up de Lambdas',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('./lambdas/rds-health'),
    role: healthRole,
    memorySize: 256,
    timeout: cdk.Duration.seconds(10),
    environment: {
      // Endpoint del cluster Aurora para comprobar disponibilidad via TCP antes del login.
      // Aurora no requiere StartDBInstance — se reanuda sola al recibir la primera conexión.
      AURORA_ENDPOINT: props.auroraEndpoint,
      AURORA_PORT: '3306',
      // ARNs de los alias live de las Lambdas de negocio para warm-up.
      // Se pasan como JSON para evitar múltiples variables de entorno.
      // Solo se incluye el alias de Identity porque es la unica que no necesita autenticacion JWT
      // y puede beneficiarse del warm-up antes de la primera peticion real.
      LAMBDA_ALIASES: JSON.stringify([
        identityAlias.functionArn,
        usersAlias.functionArn,
        eventsAlias.functionArn,
        surveysAlias.functionArn,
      ]),
    },
  });

  // Ruta pública en API Gateway — sin JWT Authorizer.
  // LoginPage la llama antes de autenticarse, por lo que no hay token disponible.
  api.addRoutes({
    path: '/health/database',
    methods: [apigatewayv2.HttpMethod.GET],
    integration: new apigatewayv2integrations.HttpLambdaIntegration(
      'RdsHealthIntegration',
      healthLambda,
    ),
    // Sin authorizer: intencionadamente público
  });

  return healthLambda;
}
