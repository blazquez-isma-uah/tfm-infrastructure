import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {

  // Exponemos el endpoint del cluster para que LambdaStack construya las URLs de conexión.
  // Se expone dbClusterIdentifier
  // Aurora no requiere arranque manual — se reanuda automáticamente al recibir la primera conexión
  public readonly dbEndpoint: string;
  public readonly dbPort: string;
  public readonly dbClusterIdentifier: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── 1. Security Group ─────────────────────────────────────────────────
    // Sin VPC propia: usamos la VPC por defecto de la cuenta AWS.
    // La protección real es SSL obligatorio (Parameter Group) + credenciales en Secrets Manager.
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true }),
      securityGroupName: 'tfm-aurora-sg',
      description: 'TFM Bandas - Aurora MySQL acceso publico con SSL obligatorio',
      allowAllOutbound: false,
    });

    // Puerto 3306 abierto a cualquier IP - la seguridad se garantiza por SSL obligatorio y credenciales en SSM
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      'Aurora/MySQL publico - proteccion por SSL obligatorio en Parameter Group'
    );

    // ── 2. Cluster Parameter Group - SSL obligatorio ──────────────────────
    // En Aurora se usa un ParameterGroup a nivel de CLUSTER (no de instancia).
    // require_secure_transport tiene alcance GLOBAL en Aurora MySQL, por lo que
    // se configura aquí y se aplica a todas las instancias del cluster.
    //
    // NOTA: Si VER_3_08_0 no compila con tu versión de CDK, usar:
    //   rds.AuroraMysqlEngineVersion.of('8.0.mysql_aurora.3.08.0')
    const clusterParameterGroup = new rds.ParameterGroup(this, 'ClusterParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      description: 'TFM Bandas - Aurora MySQL 3.08 con SSL obligatorio',
      parameters: {
        require_secure_transport: 'ON',
      },
    });

    // ── 3. Aurora Serverless v2 Cluster ───────────────────────────────────
    // Por qué Aurora Serverless v2 con 0 ACU:
    //   - Pausa automática nativa tras inactividad (elimina Lambda tfm-rds-scheduler)
    //   - Reanudación automática en ~15 segundos (vs 7-10 min de RDS start/stop)
    //   - Escala de 0 a 2 ACUs según demanda, facturando por segundo
    //   - Elimina los ciclos de recovery erráticos causados por el scheduler anterior
    //   - Coste en reposo: solo almacenamiento (~$0.01/mes para este volumen de datos)
    //   - Coste estimado anual en producción real (150 usuarios, 30 eventos/año): ~$40-50/año
    //
    // serverlessV2MinCapacity: 0 → habilita auto-pause (sin coste de cómputo cuando inactivo)
    // serverlessV2MaxCapacity: 2 → máximo 4 GB RAM, suficiente para picos de 150 usuarios
    //
    // Nueva clave en Secrets Manager (tfm/aurora/master-credentials) 
    const dbCluster = new rds.DatabaseCluster(this, 'TfmDatabase', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('tfm_admin', {
        secretName: 'tfm/aurora/master-credentials',
      }),
      defaultDatabaseName: 'tfm_main',
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpcForAurora', { isDefault: true }),
      vpcSubnets: {
        // Subnets públicas de la VPC por defecto — necesario para publiclyAccessible: true.
        // Misma decisión de diseño que RDS: sin VPC privada para reducir costes.
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [dbSecurityGroup],
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        // publiclyAccessible: true permite conexión directa desde Lambda sin VPC privada.
        // Misma decisión de diseño que RDS: protección por SSL + credenciales en Secrets Manager.
        publiclyAccessible: true,
      }),
      parameterGroup: clusterParameterGroup,
      // Protección contra borrado accidental - Impide que se borre el cluster desde la consola o CLI
      deletionProtection: true,           
      // Se mantiene el cluster y los datos en caso de borrado de la stack (para evitar pérdida accidental)
      removalPolicy: cdk.RemovalPolicy.RETAIN, 
      backup: {
        // 7 dias - Recomendado y sin coste adicional en Aurora Serverless v2
        retention: cdk.Duration.days(7),   
      },
      // Cifrado de datos en reposo con KMS gestionado por AWS
      // Recomendado para cumplir con buenas prácticas de seguridad y GDPR y sin coste adicional en Aurora Serverless v2
      storageEncrypted: true,            
    });

    // Auto-pause: Aurora pausa el cluster tras 30 minutos sin conexiones activas.
    //
    // CDK L2 no expone SecondsUntilAutoPause directamente cuando serverlessV2MinCapacity=0.
    // Se configura mediante escape hatch sobre el recurso CloudFormation subyacente.
    //
    // Rango permitido: 300s (5 min) — 86400s (24 h).
    // 900s (15 min): apropiado para una banda de música. Las sesiones de respuesta 
    // a encuestas duran 5-10 min; con 15 min de margen Aurora no se pausa mientras
    // hay actividad y pausa rápido cuando todos los usuarios han terminado.
    const cfnCluster = dbCluster.node.defaultChild as rds.CfnDBCluster;
    cfnCluster.addPropertyOverride(
      'ServerlessV2ScalingConfiguration.SecondsUntilAutoPause',
      900
    );
    // ── 4. Exponer propiedades ────────────────────────────────────────────
    this.dbEndpoint = dbCluster.clusterEndpoint.hostname;
    this.dbPort = '3306'; // Aurora MySQL siempre usa 3306 — no es un Token CDK
    this.dbClusterIdentifier = dbCluster.clusterIdentifier;
    
    // ── 5. SSM Parameters ─────────────────────────────────────────────────
    // Almacenamos en SSM los datos de conexion de cada microservicio.
    // Las Lambdas leeran estos parametros en tiempo de arranque.
    // Tipo String para el endpoint y puerto (no son secretos).
    // Las contrasenas van en Secrets Manager (gestionado por CDK automaticamente).

    // Endpoint compartido (los 3 MS usan la misma instancia RDS)
    new ssm.StringParameter(this, 'DbEndpointParam', {
      parameterName: '/tfm/db/endpoint',
      stringValue: dbCluster.clusterEndpoint.hostname,
      description: 'Cluster endpoint Aurora MySQL de TFM Bandas',
    });

    new ssm.StringParameter(this, 'DbPortParam', {
      parameterName: '/tfm/db/port',
      stringValue: '3306',
      description: 'Puerto del cluster Aurora MySQL de TFM Bandas',
    });

    // URLs JDBC de cada microservicio
    // Formato: jdbc:mysql://ENDPOINT:3306/SCHEMA?useSSL=true&requireSSL=true
    // useSSL=true: activa SSL en el driver JDBC de MySQL
    // requireSSL=true: falla si el servidor no acepta SSL (doble garantia)
    new ssm.StringParameter(this, 'DbUrlUsers', {
      parameterName: '/tfm/db/url/users',
      stringValue: `jdbc:mysql://${dbCluster.clusterEndpoint.hostname}:3306/tfm_users?useSSL=true&requireSSL=true`,
      description: 'JDBC URL Aurora para MS Users',
    });

    new ssm.StringParameter(this, 'DbUrlEvents', {
      parameterName: '/tfm/db/url/events',
      stringValue: `jdbc:mysql://${dbCluster.clusterEndpoint.hostname}:3306/tfm_events?useSSL=true&requireSSL=true`,
      description: 'JDBC URL Aurora para MS Events',
    });

    new ssm.StringParameter(this, 'DbUrlSurveys', {
      parameterName: '/tfm/db/url/surveys',
      stringValue: `jdbc:mysql://${dbCluster.clusterEndpoint.hostname}:3306/tfm_surveys?useSSL=true&requireSSL=true`,
      description: 'JDBC URL Aurora para MS Surveys',
    });

    // Nombre de usuario admin (no es secreto, si el valor de la contrasena)
    new ssm.StringParameter(this, 'DbUsernameParam', {
      parameterName: '/tfm/db/username',
      stringValue: 'tfm_admin',
      description: 'Usuario administrador de Aurora — contraseña en Secrets Manager tfm/aurora/master-credentials',
    });

    // ── 6. Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'Cluster endpoint Aurora — usar para conectar con MySQL Workbench o mysql CLI',
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: '3306',
      description: 'Puerto Aurora MySQL',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbCluster.secret!.secretArn,
      description: 'ARN del secreto en Secrets Manager — credenciales del admin de Aurora',
    });

    new cdk.CfnOutput(this, 'DbClusterIdentifier', {
      value: dbCluster.clusterIdentifier,
      description: 'Identificador del cluster Aurora — para aws CLI y consola',
    });
  }
}