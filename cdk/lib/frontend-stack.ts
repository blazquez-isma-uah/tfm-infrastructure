import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class FrontendStack extends cdk.Stack {
  // Exponemos estos valores para usarlos desde GitHub Actions

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── 1. S3 bucket PRIVADO ──────────────────────────────────────────────
    // BlockPublicAccess.BLOCK_ALL garantiza que nadie puede acceder
    // directamente al bucket. Solo CloudFront puede leerlo via OAC.
    // RemovalPolicy.DESTROY + autoDeleteObjects: en un proyecto académico
    // es conveniente poder destruir el stack limpiamente con `cdk destroy`.
    const websiteBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── 2. CloudFront Distribution con OAC ───────────────────────────────
    // OAC (Origin Access Control) es el mecanismo moderno de AWS para que
    // CloudFront acceda a S3 privado. Reemplaza al antiguo OAI.
    //
    // errorResponses: las rutas de React Router (ej: /admin/users) no
    // existen como ficheros en S3. S3 devuelve 403/404. CloudFront los
    // intercepta y devuelve index.html con HTTP 200, dejando que React
    // Router gestione la navegación en el cliente. Sin esto, cualquier
    // refresh o enlace directo daría error.
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // ── 3. OIDC Provider de GitHub ────────────────────────────────────────
    // Se registra GitHub como proveedor de identidad de confianza en esta cuenta AWS. 
    // GitHub Actions puede entonces pedir credenciales temporales
    // a AWS asumiendo un rol, sin necesidad de Access Keys estáticas.
    // Se crea una sola vez por cuenta AWS — CDK lo gestiona como recurso.
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // ── 4. IAM Role para GitHub Actions ──────────────────────────────────
    // La condición StringLike limita qué repositorios y ramas pueden asumir este rol. 
    // Solo el repositorio tfm-front-web de tu usuario puede usarlo.
    // En fases posteriores ampliaremos este rol con permisos de ECR y Lambda.
    const githubActionsRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'tfm-github-actions-deploy',
      description: 'Role asumido por GitHub Actions para desplegar el frontend y microservicios',
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub':
              'repo:blazquez-isma-uah/tfm-*:*',
          },
        }
      ),
    });

    // Permiso: leer y escribir en el bucket del frontend
    websiteBucket.grantReadWrite(githubActionsRole);

    // Permiso: invalidar caché de CloudFront tras cada despliegue
    githubActionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      })
    );

    // ── 3. Outputs ────────────────────────────────────────────────────────
    // Estos valores aparecerán en la consola al terminar el cdk deploy
    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'Nombre del bucket S3 donde se sube el bundle de React',
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL pública del frontend con HTTPS',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'ID de la distribución CloudFront',
    });

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: githubActionsRole.roleArn,
      description: 'ARN del role que usa GitHub Actions para desplegar',
    });
  }
}