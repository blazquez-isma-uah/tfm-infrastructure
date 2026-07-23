import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  /**
   * Endpoint completo del API Gateway (formato: https://XXXXX.execute-api.eu-west-1.amazonaws.com).
   * Se usa para configurar el behavior /api/* de CloudFront de forma dinamica,
   * evitando hardcodear el hostname que cambia entre cuentas y al recrear el API.
   * Proviene de TfmLambdaStack.apiUrl via cross-stack reference de CloudFormation.
   */
  apiGatewayEndpoint: string;
}

export class FrontendStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
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

    // ── 2. Origin para API Gateway ────────────────────────────────────────
    // Se extrae el hostname del endpoint completo usando Fn.select + Fn.split.
    // El endpoint tiene formato "https://XXXXX.execute-api.eu-west-1.amazonaws.com".
    // Split por '/' produce: ['https:', '', 'XXXXX.execute-api...'], indice 2 = hostname.
    // Fn.select es una funcion intrinseca de CloudFormation que se resuelve en deploy,
    // por lo que funciona correctamente con cross-stack references (tokens de CDK).
    const apiGatewayHostname = cdk.Fn.select(
      2,
      cdk.Fn.split('/', props.apiGatewayEndpoint)
    );

    const apiGatewayOrigin = new origins.HttpOrigin(apiGatewayHostname, {
      // API Gateway HTTP API usa HTTPS en el puerto 443
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });


    // ── CloudFront Function: enrutado SPA para React Router ─────────────
    // Sustituye al enfoque de errorResponses (403/404 -> index.html), que
    // NO se puede acotar por behavior en CloudFront -- se aplicaba a TODA
    // la distribucion, incluido /api/*, provocando que 403/404 legitimos
    // de la API (JWT invalido, recurso no encontrado) se sustituyeran por
    // una pagina 200 con el HTML del frontend, cacheada ademas segun la
    // politica del origen S3. Esta funcion, asociada solo al
    // defaultBehavior, reescribe la URI antes de tocar S3, sin afectar
    // nunca a /api/* ni /health/*.
    const spaRoutingFunction = new cloudfront.Function(this, 'SpaRoutingFunction', {
      functionName: 'tfm-spa-routing',
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
            var request = event.request;
            var uri = request.uri;
            // Rutas sin extension de fichero (/dashboard, /admin/users, etc.) son
            // rutas de React Router: servir index.html para que el cliente las
            // gestione. Rutas con extension (.js, .css, .png...) pasan intactas
            // hacia el origen S3 real.
            if (!uri.includes('.')) {
                request.uri = '/index.html';
            }
            return request;
        }
      `),
    });


    // ── 3. CloudFront Distribution ────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      // Behavior por defecto: S3 para el frontend estático
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function: spaRoutingFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      // Behavior adicional: /api/* enrutado al API Gateway
      // CACHING_DISABLED es obligatorio: las respuestas de la API son dinámicas.
      // Si CloudFront cacheara respuestas de API, los usuarios verían datos
      // desactualizados. CACHING_DISABLED garantiza que cada petición llega
      // siempre al API Gateway y de ahí a Lambda.
      //
      // ALLOW_ALL en allowedMethods: la API recibe GET, POST, PUT, DELETE,
      // OPTIONS (preflight CORS), HEAD y PATCH.
      //
      // ALL_VIEWER_EXCEPT_HOST_HEADER en originRequestPolicy: CloudFront reenvía al API Gateway
      // todos los headers del cliente, incluyendo Authorization con el JWT.
      // Sin esto, el JWT no llegaría a Lambda y todas las peticiones
      // devolverían 401.
      additionalBehaviors: {
         // No se necesita CORS aquí: frontend y API comparten el mismo
         // dominio CloudFront, por lo que el navegador no envía preflight.
        '/api/*': {
          origin: apiGatewayOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // El endpoint de health de RDS tambien se enruta al API Gateway.
        // Esta ruta es publica (sin JWT) y se llama antes del login
        // para comprobar el estado de la base de datos.
        '/health/*': {
          origin: apiGatewayOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      // errorResponses: [
      //   {
      //     httpStatus: 403,
      //     responseHttpStatus: 200,
      //     responsePagePath: '/index.html',
      //     ttl: cdk.Duration.seconds(0),
      //   },
      //   {
      //     httpStatus: 404,
      //     responseHttpStatus: 200,
      //     responsePagePath: '/index.html',
      //     ttl: cdk.Duration.seconds(0),
      //   },
      // ],
    });

    // ── 4. OIDC Provider de GitHub ────────────────────────────────────────
    // Se registra GitHub como proveedor de identidad de confianza en esta cuenta AWS. 
    // GitHub Actions puede entonces pedir credenciales temporales
    // a AWS asumiendo un rol, sin necesidad de Access Keys estáticas.
    // Se crea una sola vez por cuenta AWS - CDK lo gestiona como recurso.
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // ── 5. IAM Role para GitHub Actions ──────────────────────────────────
    // La condición StringLike limita qué repositorios y ramas pueden asumir este rol. 
    // Solo el repositorio tfm-front-web de tu usuario puede usarlo.
    // En fases posteriores ampliaremos este rol con permisos de ECR y Lambda.
    const githubActionsRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'tfm-github-actions-frontend-deploy',
      description: 'Rol asumido por GitHub Actions para desplegar el frontend en S3/CloudFront',
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub':
              'repo:blazquez-isma-uah/tfm-front-web:*',
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

    // ── 6. Outputs ────────────────────────────────────────────────────────
    // Estos valores aparecerán en la consola al terminar el cdk deploy
    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'Nombre del bucket S3 donde se sube el bundle de React',
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL publica del frontend con HTTPS',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'ID de la distribucion CloudFront',
    });

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: githubActionsRole.roleArn,
      description: 'ARN del role que usa GitHub Actions para desplegar',
    });
  }
}