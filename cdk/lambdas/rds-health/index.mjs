/**
 * Lambda de health check para Aurora Serverless v2.
 *
 * Llamada desde LoginPage antes del login para verificar si Aurora está activa.
 *
 * Con Aurora Serverless v2 (0 ACU):
 *   - Aurora SIEMPRE reporta 'available' en la API de RDS, incluso cuando está pausada.
 *   - Aurora se reanuda AUTOMÁTICAMENTE al recibir la primera conexión TCP.
 *   - El tiempo de reanudación es ~15 segundos (vs 7-10 minutos de RDS start/stop).
 *
 * Por eso el check aquí es diferente: en lugar de preguntar a la API de RDS por el estado,
 * intentamos abrir una conexión TCP real al puerto 3306 del cluster Aurora.
 *   - Si conecta   → Aurora está activa     → devolvemos AVAILABLE
 *   - Si no conecta → Aurora está reanudando → devolvemos STARTING
 *
 * Cuando devolvemos STARTING, la primera petición real de la Lambda de negocio
 * (Flyway al arrancar Spring Boot) dispara la reanudación de Aurora.
 * El frontend muestra la pantalla de espera y reintenta cada 10 segundos.
 * En el tercer o cuarto reintento (~30s después), Aurora ya estará disponible.
 *
 * Endpoint: GET /health/database (público, sin JWT)
 * Respuestas:
 *   {"status": "AVAILABLE"}  — Aurora activa, proceder con login
 *   {"status": "STARTING"}   — Aurora reanudando (~15s), mostrar pantalla de espera
 */

import net from 'net';
import {
  LambdaClient,
  InvokeCommand,
} from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: 'eu-west-1' });

// Endpoint y puerto del cluster Aurora. Inyectados como variables de entorno desde CDK.
const AURORA_ENDPOINT = process.env.AURORA_ENDPOINT;
const AURORA_PORT     = parseInt(process.env.AURORA_PORT || '3306', 10);

// ARNs de las Lambdas de negocio a calentar cuando Aurora está activa.
// Solo Identity: es la única sin BD, puede calentarse antes del login.
const LAMBDA_ALIASES = JSON.parse(process.env.LAMBDA_ALIASES || '[]');

/**
 * Intenta establecer una conexión TCP a Aurora con timeout de 3 segundos.
 *
 * Si Aurora está activa (>0 ACU), el puerto 3306 responde inmediatamente.
 * Si Aurora está pausada (0 ACU) y en proceso de reanudación, el puerto
 * puede no responder todavía → timeout → devolvemos false.
 *
 * Usamos TCP raw (net.Socket) y no MySQL porque:
 *   - No añade dependencias al proyecto (net es módulo nativo de Node.js).
 *   - El check es de conectividad, no de autenticación; TCP es suficiente.
 *   - Es más rápido: si el puerto responde, Aurora está lista.
 */
function checkAuroraTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => cleanup(true));   // Puerto 3306 responde → Aurora activa
    socket.on('timeout', () => cleanup(false));  // Sin respuesta en 3s → Aurora reanudando
    socket.on('error',   () => cleanup(false));  // Error de red → tratar como no disponible

    socket.connect(port, host);
  });
}

// Path ficticio que no existe en ningún Lambda. Spring Security intercepta la petición
// y devuelve HTTP 401 (sin JWT) o Spring MVC devuelve 404 (ruta no registrada).
// Ambos son respuestas HTTP válidas: el handler de Lambda termina correctamente
// y Lambda no reintenta la invocación. Suficiente para forzar el restore de SnapStart
// y ejecutar afterRestore() (calentamiento de conexión a Aurora/Cognito).
// El path es intencionadamente genérico para que funcione con cualquier Lambda
// sin depender de rutas concretas de negocio ni de endpoints dedicados.
const warmupPayload = Buffer.from(JSON.stringify({
  version: '2.0',
  routeKey: 'GET /api/warmup',
  rawPath: '/api/warmup',
  rawQueryString: '',
  headers: {
    'content-type': 'application/json',
    'x-forwarded-proto': 'https',
  },
  requestContext: {
    http: { method: 'GET', path: '/api/warmup', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
    routeKey: 'GET /api/warmup',
    stage: '$default',
  },
  isBase64Encoded: false,
}));

const response = (status) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status }),
});

export const handler = async () => {
  const auroraActive = await checkAuroraTcp(AURORA_ENDPOINT, AURORA_PORT);
  console.log(`Aurora TCP check (${AURORA_ENDPOINT}:${AURORA_PORT}): ${auroraActive ? 'ACTIVE' : 'RESUMING'}`);

  if (!auroraActive) {
    // Aurora está pausada o reanudando. No necesitamos hacer nada:
    // la primera conexión de Flyway/HikariCP al arrancar Spring Boot
    // disparará la reanudación automática de Aurora (~15 segundos).
    // El frontend mostrará la pantalla de espera y reintentará cada 10 segundos.
    return response('STARTING');
  }

  // Aurora activa. Lanzar warm-up de todos los Lambdas de negocio en fire-and-forget.
  // Cada Lambda recibirá una petición a /api/warmup (ruta inexistente) y responderá
  // 401 o 404 — respuesta HTTP válida, Lambda no reintenta. El objetivo es forzar
  // el restore de SnapStart y el calentamiento de conexiones (BD y Cognito) en
  // afterRestore() antes de que llegue la primera petición real del usuario post-login.
  if (LAMBDA_ALIASES.length > 0) {
    await Promise.allSettled(
      LAMBDA_ALIASES.map(arn =>
        lambdaClient.send(new InvokeCommand({
          FunctionName: arn,
          InvocationType: 'Event',
          Payload: warmupPayload,
        }))
      )
    );
    console.log(`Warm-up sent to ${LAMBDA_ALIASES.length} Lambda alias(es).`);
  }

  return response('AVAILABLE');
};
