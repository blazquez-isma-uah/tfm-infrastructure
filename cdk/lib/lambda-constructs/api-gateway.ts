import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';
import { LambdaStackProps } from '../lambda-stack';

export interface ApiGatewayResult {
  api: apigatewayv2.HttpApi;
  jwtAuthorizer: apigatewayv2.HttpAuthorizer;
  jwtAuth: apigatewayv2.IHttpRouteAuthorizer;
}

export function createApiGateway(scope: Construct, props: LambdaStackProps): ApiGatewayResult {
  // ─── API Gateway HTTP API ───────────────────────────────────────────────────────────────
  // HTTP API (apigatewayv2) en lugar de REST API (apigateway) por tres razones:
  //   1. JWT Authorizer nativo: no requiere Lambda Authorizer adicional
  //   2. Payload format v2: compatible con SpringDelegatingLambdaContainerHandler
  //   3. Coste y latencia: ~3.5x más barata y ~5ms menos de overhead que REST API
  //
  // corsAllowance NO se configura aquí porque CORS lo gestiona el frontend a través de CloudFront.
  // Las Lambdas reciben peticiones desde API Gateway (mismo dominio desde la perspectiva del navegador si se configura CF delante),
  // o directamente en desarrollo desde el frontend local con su propia config CORS.
  // En cualquier caso, CORS en API Gateway y en Spring (@Profile("docker")) son mutuamente excluyentes por diseño.
  const api = new apigatewayv2.HttpApi(scope, 'TfmHttpApi', {
    apiName: 'tfm-bandas-api',
    description: 'TFM Bandas de Musica - API Gateway HTTP API',
    // Sin defaultAuthorizer: las rutas públicas no deben heredar el authorizer.
    // El JWT Authorizer se asigna ruta a ruta de forma explícita.
  });

  // ─── JWT Authorizer ───────────────────────────────────────────────────────────────
  // El JWT Authorizer valida cada petición antes de invocar la Lambda:
  //   1. Extrae el token de Authorization: Bearer <token>
  //   2. Descarga y cachea el JWKS de Cognito
  //   3. Verifica la firma RSA del token
  //   4. Verifica que 'iss' == issuer (el User Pool de Cognito)
  //   5. Verifica que 'client_id' == audience (el App Client del frontend)
  //   6. Si todo es correcto -> invoca la Lambda
  //   7. Si algo falla -> 401 Unauthorized sin invocar la Lambda
  //
  // Nota sobre 'audience': Cognito emite tokens con el claim 'client_id', no con 'aud' estándar de OAuth2.
  // API Gateway HTTP API acepta ambos cuando se configura en 'identitySource' el header Authorization.
  // Por eso el audience aquí es el Client ID del App Client, no una URL.
  const jwtAuthorizer = new apigatewayv2.HttpAuthorizer(scope, 'CognitoJwtAuthorizer', {
    httpApi: api,
    type: apigatewayv2.HttpAuthorizerType.JWT,
    authorizerName: 'cognito-jwt-authorizer',
    // Dónde buscar el token en la petición entrante
    identitySource: ['$request.header.Authorization'],
    jwtIssuer: props.cognitoIssuerUri,
    jwtAudience: [props.cognitoClientId],
  });

  // Helper para asignar el JWT Authorizer a rutas protegidas.
  // HttpAuthorizer (clase L2 de CDK) no implementa IHttpRouteAuthorizer directamente.
  // Es necesario construir el objeto que implementa la interfaz manualmente.
  // Este patron se repite para cada ruta protegida del API Gateway.
  const jwtAuth: apigatewayv2.IHttpRouteAuthorizer = {
    authorizerId: jwtAuthorizer.authorizerId,
    authorizerType: apigatewayv2.HttpAuthorizerType.JWT,
    bind: () => ({
      authorizerId: jwtAuthorizer.authorizerId,
      authorizationType: 'JWT',
    }),
  } as apigatewayv2.IHttpRouteAuthorizer;

  return { api, jwtAuthorizer, jwtAuth };
}
