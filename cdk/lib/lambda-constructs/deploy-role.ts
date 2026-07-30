import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface BackendDeployRoleResult {
  deploymentBucket: s3.Bucket;
  backendDeployRole: iam.Role;
}

export function createBackendDeployRole(scope: Construct): BackendDeployRoleResult {
  const stack = cdk.Stack.of(scope);

  // ── GitHub Actions — Rol de deploy para microservicios ────────────────────────

  // Referencia al proveedor OIDC de GitHub creado en FrontendStack.
  // fromOpenIdConnectProviderArn() no crea ningún recurso CloudFormation:
  // solo obtiene una referencia de solo lectura al proveedor existente.
  const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
    scope,
    'GithubOidcRef',
    `arn:aws:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`
  );

  // Bucket S3 para artefactos de despliegue (JARs de Lambda).
  // Nombre con account ID para garantizar unicidad global de S3.
  // El JAR en S3 no es un backup ni un archivo histórico - es simplemente el código actualmente desplegado en producción
  // Siempre se sube un nuevo JAR a S3 antes de actualizar el microservicio (PR mergeado en main) y se borra el JAR anterior.
  // No se borran los jar actuales de los jar porque debe existir para hacer deploy de la Lambda.
  const deploymentBucket = new s3.Bucket(scope, 'DeploymentBucket', {
    bucketName: `tfm-deployments-${stack.account}`,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    // Sin lifecycleRules: cada microservicio mantiene un único JAR con clave fija
    // (tfm-users/app.jar, tfm-events/app.jar, etc.). El coste de ~320 MB es
    // ~$0.007/mes, insignificante. Borrar el JAR haría fallar cdk deploy al
    // intentar referenciar un objeto inexistente en S3.
  });

  // Rol separado del frontend por principio de minimo privilegio:
  // una brecha en el workflow del frontend no puede modificar codigo Lambda.
  const backendDeployRole = new iam.Role(scope, 'BackendDeployRole', {
    roleName: 'tfm-github-actions-backend-deploy',
    description: 'Rol asumido por GitHub Actions para desplegar microservicios en Lambda',
    assumedBy: new iam.WebIdentityPrincipal(
      githubOidcProvider.openIdConnectProviderArn,
      {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            'repo:blazquez-isma-uah/tfm-identity:*',
            'repo:blazquez-isma-uah/tfm-users:*',
            'repo:blazquez-isma-uah/tfm-events:*',
            'repo:blazquez-isma-uah/tfm-surveys:*',
          ],
        },
      }
    ),
  });

  // Permiso: subir JARs al bucket de artefactos antes de actualizar Lambda.
  backendDeployRole.addToPolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
    resources: [
      deploymentBucket.bucketArn,
      `${deploymentBucket.bucketArn}/*`,
    ],
  }));

  // Permiso: actualizar codigo, publicar version y consultar estado de cada Lambda.
  // GetFunction es necesario para los waiters de la CLI:
  //   - wait function-updated-v2  (tras update-function-code)
  //   - wait function-active-v2   (tras publish-version, espera al snapshot SnapStart)
  backendDeployRole.addToPolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'lambda:UpdateFunctionCode',
      'lambda:PublishVersion',
      'lambda:GetFunction',
    ],
    // GetFunction necesita dos patrones de ARN:
    //   - ARN base (function:tfm-xxx): para update-function-code y publish-version
    //   - ARN con cualificador (function:tfm-xxx:*): para wait function-active-v2
    //     --qualifier VERSION, que llama a GetFunction sobre el ARN versionado
    resources: [
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-identity`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-users`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-events`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-surveys`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-identity:*`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-users:*`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-events:*`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-surveys:*`,
    ],
  }));

  // UpdateAlias se evalua sobre el ARN base de la funcion, no sobre el ARN del alias.
  backendDeployRole.addToPolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['lambda:UpdateAlias'],
    resources: [
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-identity`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-users`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-events`,
      `arn:aws:lambda:${stack.region}:${stack.account}:function:tfm-surveys`,
    ],
  }));

  return { deploymentBucket, backendDeployRole };
}
