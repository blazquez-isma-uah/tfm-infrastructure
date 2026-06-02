import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';

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
}

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

    // ── 1. API Gateway HTTP API ────────────────────────────────────────────
    //
    // HTTP API (apigatewayv2) en lugar de REST API (apigateway) por tres razones:
    //   1. JWT Authorizer nativo: no requiere Lambda Authorizer adicional
    //   2. Payload format v2: compatible con HttpApiV2ProxyRequest en los LambdaHandlers
    //   3. Coste y latencia: ~3.5x más barata y ~5ms menos de overhead que REST API
    //
    // corsAllowance NO se configura aquí porque CORS lo gestiona el frontend a través de CloudFront. 
    // Las Lambdas reciben peticiones desde API Gateway (mismo dominio desde la perspectiva del navegador si se configura CF delante),
    // o directamente en desarrollo desde el frontend local con su propia config CORS.
    // En cualquier caso, CORS en API Gateway y en Spring (@Profile("docker")) son mutuamente excluyentes por diseño.
    const api = new apigatewayv2.HttpApi(this, 'TfmHttpApi', {
      apiName: 'tfm-bandas-api',
      description: 'TFM Bandas de Musica - API Gateway HTTP API',
      // Sin defaultAuthorizer: las rutas públicas no deben heredar el authorizer.
      // El JWT Authorizer se asigna ruta a ruta de forma explícita.
    });

    // ── 2. JWT Authorizer ──────────────────────────────────────────────────
    //
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
    const jwtAuthorizer = new apigatewayv2.HttpAuthorizer(this, 'CognitoJwtAuthorizer', {
      httpApi: api,
      type: apigatewayv2.HttpAuthorizerType.JWT,
      authorizerName: 'cognito-jwt-authorizer',
      // Dónde buscar el token en la petición entrante
      identitySource: ['$request.header.Authorization'],
      jwtIssuer: props.cognitoIssuerUri,
      jwtAudience: [props.cognitoClientId],
    });

    // ── 3. Outputs ─────────────────────────────────────────────────────────
    //
    // apiUrl es la URL base que usarán:
    //   - Las variables de entorno Feign de cada Lambda (IDENTITY_SERVICE_URI, etc.)
    //   - El frontend como VITE_API_BASE_URL
    //   - Los tests con curl para verificar cada endpoint
    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.apiEndpoint,
      description: 'URL base del API Gateway - usar como base para todas las llamadas REST',
    });

    new cdk.CfnOutput(this, 'JwtAuthorizerId', {
      value: jwtAuthorizer.authorizerId,
      description: 'ID del JWT Authorizer - referencia interna para asignar a rutas',
    });
  }
}