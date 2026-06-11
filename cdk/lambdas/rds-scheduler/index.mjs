/**
 * Lambda de apagado automático de RDS por inactividad.
 *
 * Disparada por EventBridge cada hora. Comprueba si hubo actividad en RDS
 * en las últimas INACTIVITY_HOURS horas mediante métricas de CloudWatch.
 * Si no hubo actividad (DatabaseConnections máximo = 0), apaga RDS.
 *
 * Las instancias Lambda se terminan automáticamente tras ~15 minutos de
 * inactividad, cerrando sus conexiones HikariCP. Por eso, pasadas 2 horas
 * sin uso, DatabaseConnections será 0 y RDS puede apagarse con seguridad.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';

const rdsClient = new RDSClient({ region: 'eu-west-1' });
const cwClient  = new CloudWatchClient({ region: 'eu-west-1' });

const DB_INSTANCE_ID    = process.env.RDS_INSTANCE_ID;
const INACTIVITY_HOURS  = parseInt(process.env.INACTIVITY_HOURS || '2', 10);

export const handler = async () => {
  // 1. Verificar estado actual de RDS
  const describe = await rdsClient.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })
  );

  const dbStatus = describe.DBInstances[0].DBInstanceStatus;
  console.log(`RDS status: ${dbStatus}`);

  if (dbStatus !== 'available') {
    // RDS ya está parada, arrancando o en mantenimiento. Sin acción.
    return;
  }

  // 2. Consultar actividad en CloudWatch: máximo de conexiones en las últimas N horas
  const now       = new Date();
  const startTime = new Date(now.getTime() - INACTIVITY_HOURS * 60 * 60 * 1000);

  const metrics = await cwClient.send(new GetMetricStatisticsCommand({
    Namespace:  'AWS/RDS',
    MetricName: 'DatabaseConnections',
    Dimensions: [{ Name: 'DBInstanceIdentifier', Value: DB_INSTANCE_ID }],
    StartTime:  startTime,
    EndTime:    now,
    Period:     3600, // granularidad de 1 hora
    Statistics: ['Maximum'],
  }));

  const maxConnections = Math.max(
    0,
    ...metrics.Datapoints.map(dp => dp.Maximum ?? 0)
  );

  console.log(`Max connections in last ${INACTIVITY_HOURS}h: ${maxConnections}`);

  // 3. Apagar RDS si no hubo actividad
  if (maxConnections === 0) {
    console.log('No activity detected. Stopping RDS.');
    await rdsClient.send(
      new StopDBInstanceCommand({ DBInstanceIdentifier: DB_INSTANCE_ID })
    );
    console.log('RDS stop command sent.');
  } else {
    console.log('Activity detected. RDS stays running.');
  }
};