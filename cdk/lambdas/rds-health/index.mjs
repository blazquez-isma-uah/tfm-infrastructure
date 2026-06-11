/**
 * Lambda de health check y arranque de RDS.
 *
 * Llamada desde LoginPage antes del login para verificar el estado de la base de datos. 
 * Si RDS está parada, la arranca y lanza warm-up de las Lambdas de negocio en paralelo para aprovechar el tiempo de arranque.
 *
 * Endpoint: GET /health/database (público, sin JWT)
 * Respuestas:
 *   {"status": "AVAILABLE"}  — RDS lista, proceder con login
 *   {"status": "STARTING"}   — RDS arrancando, mostrar pantalla de espera
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  StartDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  LambdaClient,
  InvokeCommand,
} from '@aws-sdk/client-lambda';

const rdsClient  = new RDSClient({ region: 'eu-west-1' });
const lambdaClient = new LambdaClient({ region: 'eu-west-1' });

// Instancia RDS a monitorizar y arrancar.
const DB_INSTANCE_ID = process.env.RDS_INSTANCE_ID;
// Lambdas de negocio a "calentar" enviándoles una invocación dummy mientras RDS arranca.
// Esto elimina los cold starts de SnapStart, mejorando la experiencia post-login.
const LAMBDA_ALIASES = JSON.parse(process.env.LAMBDA_ALIASES || '[]');

// Evento HTTP API v2 mínimo para invocar /actuator/health en cada Lambda de negocio.
// El endpoint es público (permitAll en SecurityConfig), no requiere JWT.
const warmupPayload = Buffer.from(JSON.stringify({
  version: '2.0',
  routeKey: 'GET /actuator/health',
  rawPath: '/actuator/health',
  rawQueryString: '',
  headers: {
    'content-type': 'application/json',
    'x-forwarded-proto': 'https',
  },
  requestContext: {
    http: { method: 'GET', path: '/actuator/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
    routeKey: 'GET /actuator/health',
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
  const describe = await rdsClient.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })
  );

  const dbStatus = describe.DBInstances[0].DBInstanceStatus;
  console.log(`RDS status: ${dbStatus}`);

  if (dbStatus === 'available') {
    return response('AVAILABLE');
  }

  if (dbStatus === 'stopped') {
    // Arrancar RDS
    await rdsClient.send(
      new StartDBInstanceCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })
    );
    console.log('RDS start command sent.');

    // Warm-up de las Lambdas de negocio en paralelo mientras RDS arranca.
    // InvocationType Event: fire and forget, no esperamos respuesta.
    // Esto aprovecha los 2-4 minutos de arranque de RDS para eliminar
    // los cold starts de SnapStart, mejorando la experiencia post-login.
    await Promise.allSettled(
      LAMBDA_ALIASES.map(arn =>
        lambdaClient.send(new InvokeCommand({
          FunctionName: arn,
          InvocationType: 'Event',
          Payload: warmupPayload,
        }))
      )
    );
    console.log(`Warm-up sent to ${LAMBDA_ALIASES.length} Lambda aliases.`);
  }

  // Tanto 'stopped' (recién arrancada) como 'starting' devuelven STARTING.
  // El frontend muestra la pantalla de espera y reintenta cada 30s.
  return response('STARTING');
};