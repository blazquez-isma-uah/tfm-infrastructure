import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { createApiGateway } from './lambda-constructs/api-gateway';
import { createIdentityLambda } from './lambda-constructs/identity-lambda';
import { createUsersLambda } from './lambda-constructs/users-lambda';
import { createEventsLambda } from './lambda-constructs/events-lambda';
import { createSurveysLambda } from './lambda-constructs/surveys-lambda';
import { createHealthCheckLambda } from './lambda-constructs/health-check';
import { createBackendDeployRole } from './lambda-constructs/deploy-role';

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

  /** Endpoint del cluster Aurora. Usado por tfm-rds-health para comprobar disponibilidad via TCP. */
  auroraEndpoint: string;
}

/** Devuelve el código correcto para una Lambda según la estrategia de empaquetado activa (S3 o JAR local). */
export type LambdaCodeResolver = (localPath: string, s3Key: string) => lambda.Code;

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

    // ─── Estrategia de código para las Lambdas ────────────────────────────────────
    // Por defecto, CDK lee el código de cada Lambda desde S3 (tfm-deployments-ACCOUNT).
    // El pipeline de GitHub Actions es el responsable de compilar y subir el JAR a S3
    // en cada push a main. Esto desacopla los despliegues de infraestructura (CDK) de
    // los despliegues de código (CI/CD), que es la separación de responsabilidades correcta.
    //
    // Para desarrollo rápido sin necesidad de commit, se puede usar el JAR local:
    //   cdk deploy TfmLambdaStack --context useLocalJar=true
    //
    // Esto es útil para probar cambios puntuales en local antes de subirlos a main.
    // En producción y en CI siempre se omite el contexto (usa S3 por defecto).
    const useLocalJar = this.node.tryGetContext('useLocalJar') === 'true';

    // Referencia al bucket de despliegue. Se usa fromBucketName (no new Bucket)
    // porque el bucket se define más abajo en este mismo stack: fromBucketName
    // crea solo una referencia lógica sin crear ningún recurso CloudFormation adicional.
    const deployBucket = s3.Bucket.fromBucketName(
      this,
      'DeployBucketRef',
      `tfm-deployments-${this.account}`
    );

    // Helper: devuelve el código correcto según la estrategia activa.
    // Centraliza la lógica para que cada Lambda no tenga que repetirla.
    // Nota sobre el warning @aws-cdk/aws-lambda:codeFromBucketObjectVersionNotSpecified:
    // CDK avisa de que no rastreará cambios en el objeto S3. Este comportamiento es
    // INTENCIONADO: los cambios de código los gestiona el pipeline de GitHub Actions
    // via aws lambda update-function-code, no CDK. CDK solo gestiona infraestructura.
    // La separación de responsabilidades es deliberada.
    const lambdaCode: LambdaCodeResolver = (localPath, s3Key) =>
      useLocalJar
        ? lambda.Code.fromAsset(localPath + '/target/app.jar')
        : lambda.Code.fromBucket(deployBucket, s3Key);

    const { api, jwtAuthorizer, jwtAuth } = createApiGateway(this, props);
    this.apiUrl = api.apiEndpoint;

    const identity = createIdentityLambda(this, props, lambdaCode, api, jwtAuth);
    const users = createUsersLambda(this, props, lambdaCode, api, jwtAuth, this.apiUrl);
    const events = createEventsLambda(this, props, lambdaCode, api, jwtAuth, this.apiUrl);
    const surveys = createSurveysLambda(this, props, lambdaCode, api, jwtAuth, this.apiUrl);

    createHealthCheckLambda(this, props, api, {
      identityAlias: identity.alias,
      usersAlias: users.alias,
      eventsAlias: events.alias,
      surveysAlias: surveys.alias,
    });

    const { deploymentBucket, backendDeployRole } = createBackendDeployRole(this);

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
      value: identity.lambda.functionArn,
      description: 'ARN de la Lambda MS Identity',
    });

    new cdk.CfnOutput(this, 'IdentityAliasArn', {
      value: identity.alias.functionArn,
      description: 'ARN del alias live de Lambda MS Identity - SnapStart activo',
    });

    new cdk.CfnOutput(this, 'UsersLambdaArn', {
      value: users.lambda.functionArn,
      description: 'ARN de la Lambda MS Users',
    });

    new cdk.CfnOutput(this, 'UsersAliasArn', {
      value: users.alias.functionArn,
      description: 'ARN del alias live de Lambda MS Users - SnapStart activo',
    });

    new cdk.CfnOutput(this, 'EventsLambdaArn', {
      value: events.lambda.functionArn,
      description: 'ARN de la Lambda MS Events',
    });

    new cdk.CfnOutput(this, 'EventsAliasArn', {
      value: events.alias.functionArn,
      description: 'ARN del alias live de Lambda MS Events - SnapStart activo',
    });

    new cdk.CfnOutput(this, 'SurveysLambdaArn', {
      value: surveys.lambda.functionArn,
      description: 'ARN de la Lambda MS Surveys',
    });

    new cdk.CfnOutput(this, 'SurveysAliasArn', {
      value: surveys.alias.functionArn,
      description: 'ARN del alias live de Lambda MS Surveys - SnapStart activo',
    });

    new cdk.CfnOutput(this, 'BackendDeployRoleArn', {
      value: backendDeployRole.roleArn,
      description: 'ARN del rol IAM para GitHub Actions deploy de microservicios',
    });

    new cdk.CfnOutput(this, 'DeploymentBucketName', {
      value: deploymentBucket.bucketName,
      description: 'Bucket S3 para los JARs de despliegue',
    });
  }
}
