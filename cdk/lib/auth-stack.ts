import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  // Exponemos estos valores para usarlos desde otros stacks y desde el código
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  public readonly jwksUri: string;
  public readonly issuerUri: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── 1. User Pool ──────────────────────────────────────────────────────
    // selfSignUpEnabled: false - en una app de gestión de banda, solo el
    // ADMIN crea usuarios. No tiene sentido el autoregistro público.
    //
    // signInAliases: permitimos login tanto por username como por email,
    // equivalente al comportamiento de Keycloak en Fase 1.
    const userPool = new cognito.UserPool(this, 'TfmUserPool', {
      userPoolName: 'tfm-bandas',
      selfSignUpEnabled: false,
      signInAliases: {
        username: true,
        email: true,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      // EMAIL_ONLY: recuperación de contraseña solo por email.
      // Evitamos SMS para no incurrir en costes de SNS.
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // DESTROY para poder limpiar el entorno fácilmente en desarrollo.
      // En un proyecto real de producción sería RETAIN.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── 2. Hosted UI Domain ───────────────────────────────────────────────
    // Cognito necesita un dominio para servir la pantalla de login (Hosted UI).
    // Usamos un dominio de Cognito gratuito (subdominio de auth.eu-west-1.amazoncognito.com).
    // El prefijo debe ser único globalmente - incluimos el account ID para garantizarlo.
    const hostedUiDomain = userPool.addDomain('TfmCognitoDomain', {
      cognitoDomain: {
        domainPrefix: `tfm-bandas-${this.account}`,
      },
    });

    // ── 3. App Client (frontend) ──────────────────────────────────────────
    // generateSecret: false - cliente público (como frontend-local en Keycloak).
    // Los clientes públicos no pueden guardar un secret de forma segura,
    // por eso usamos PKCE como mecanismo de seguridad en su lugar.
    //
    // authorizationCodeGrant + PKCE S256: equivalente exacto a la configuración de Keycloak en Fase 1.
    const appClient = userPool.addClient('TfmFrontendClient', {
      userPoolClientName: 'tfm-frontend',
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        // URLs a las que Cognito puede redirigir tras el login/logout.
        // Incluimos tanto la URL de CloudFront (producción) como localhost (desarrollo).
        callbackUrls: [
          `https://d36zednbsqfg0h.cloudfront.net`,
          `https://d36zednbsqfg0h.cloudfront.net/dashboard`,
          'http://localhost:5173',
          'http://localhost:5173/dashboard',
        ],
        logoutUrls: [
          `https://d36zednbsqfg0h.cloudfront.net/login`,
          'http://localhost:5173/login',
        ],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(7),
      idTokenValidity: cdk.Duration.hours(1),
    });

    // ── 4. Grupos (equivalente a los roles de Keycloak) ───────────────────
    // En Cognito los roles se modelan como grupos. 
    // El claim cognito:groups en el JWT contendrá los nombres de los grupos a los que pertenece el usuario.
    // Spring Security leerá este claim en lugar de realm_access.roles
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'ADMIN',
      description: 'Administradores del sistema - acceso completo',
    });

    new cognito.CfnUserPoolGroup(this, 'MusicianGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'MUSICIAN',
      description: 'Músicos de la banda - lectura, perfil y encuestas',
    });

    // ── 5. Exponer valores para uso posterior ─────────────────────────────
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = appClient.userPoolClientId;
    this.jwksUri = `https://cognito-idp.eu-west-1.amazonaws.com/${userPool.userPoolId}/.well-known/jwks.json`;
    this.issuerUri = `https://cognito-idp.eu-west-1.amazonaws.com/${userPool.userPoolId}`;

    // ── 6. Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'ID del User Pool - necesario para el frontend y los microservicios',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: appClient.userPoolClientId,
      description: 'Client ID del App Client - necesario para el frontend',
    });

    new cdk.CfnOutput(this, 'JwksUri', {
      value: this.jwksUri,
      description: 'JWKS URI para validación de JWT en los microservicios',
    });

    new cdk.CfnOutput(this, 'IssuerUri', {
      value: this.issuerUri,
      description: 'Issuer URI del User Pool',
    });

    new cdk.CfnOutput(this, 'HostedUiBaseUrl', {
      value: hostedUiDomain.baseUrl(),
      description: 'URL base de la Hosted UI de Cognito',
    });
  }
}