import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {

  // Exponemos el endpoint para que LambdaStack pueda construir las URLs de conexión
  public readonly dbEndpoint: string;
  public readonly dbPort: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── 1. Security Group ─────────────────────────────────────────────────
    // Sin VPC, RDS es publicly accessible. El security group abre el puerto 3306 a 0.0.0.0/0 porque Lambda no tiene IP fija.
    // La proteccion real es SSL obligatorio (Parameter Group) + credenciales en SSM
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      // Sin VPC propia usamos la VPC por defecto de la cuenta AWS.
      // Esta VPC existe en todas las cuentas y no tiene coste.
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true }),
      securityGroupName: 'tfm-rds-sg',
      description: 'TFM Bandas - RDS MySQL acceso publico con SSL obligatorio',
      allowAllOutbound: false, // RDS no necesita trafico saliente
    });

    // Puerto 3306 abierto a cualquier IP - la seguridad se garantiza por SSL obligatorio y credenciales en SSM
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      'MySQL publico - proteccion por SSL obligatorio en Parameter Group'
    );

    // ── 2. Parameter Group - SSL obligatorio ──────────────────────────────
    // require_secure_transport=ON fuerza SSL a nivel de motor MySQL.
    // Cualquier cliente que intente conectar sin SSL recibe un error de conexion.
    // Este parametro es el equivalente MySQL de "ssl-mode=REQUIRED" en el cliente.
    const dbParameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      description: 'TFM Bandas - MySQL 8.0 con SSL obligatorio',
      parameters: {
        require_secure_transport: 'ON',
      },
    });

    // ── 3. RDS MySQL db.t3.micro ──────────────────────────────────────────
    // db.t3.micro: la instancia mas pequena de RDS. Cubierta por Free Tier el primer año (750 h/mes de instancia Single-AZ).
    // Single-AZ: sin replica de alta disponibilidad. Apropiado para un TFM donde la disponibilidad 24/7 no es un requisito critico.
    // publiclyAccessible: true - necesario por la decision sin VPC.
    // deletionProtection: false - permite eliminar la instancia desde CDK en entorno de desarrollo. Se mantiene durante el desarrollo. 
    // TODO: CUANDO EL PROYECT SEA PRODUCTIVO, SE DEBE CAMBIAR A TRUE PARA EVITAR BORRADOS ACCIDENTALES.
    // TODO: CAMBIAR removalPolicy A "RETAIN" CUANDO EL PROYECT SEA PRODUCTIVO PARA EVITAR BORRADOS ACCIDENTALES
    const dbInstance = new rds.DatabaseInstance(this, 'TfmDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      // CDK genera automaticamente usuario "admin" y una contrasena aleatoria
      // y la almacena en Secrets Manager. Nunca se escribe en texto plano.
      credentials: rds.Credentials.fromGeneratedSecret('tfm_admin', {
        secretName: 'tfm/rds/master-credentials',
      }),
      databaseName: 'tfm_main', // BD inicial - los schemas de cada MS los crea Flyway
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVpcForRds', { isDefault: true }),
      vpcSubnets: {
        // Subnets publicas de la VPC por defecto - necesario para publicly accessible
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [dbSecurityGroup],
      parameterGroup: dbParameterGroup,
      publiclyAccessible: true,
      multiAz: false, // Single-AZ - ver justificacion arriba
      allocatedStorage: 20, // GB - minimo de RDS, suficiente
      maxAllocatedStorage: 20, // Sin autoscaling de storage - control de costes
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
      // backupRetention: 1 dias - activa backups automaticos.
      // Unico valor permitido para free tier.
      // En un principio los backups generados no van a llegar a al máximo gratuito de RDS (20 GB)
      backupRetention: cdk.Duration.days(1),
    });

    // ── 4. Exponer endpoint ───────────────────────────────────────────────
    this.dbEndpoint = dbInstance.dbInstanceEndpointAddress;
    this.dbPort = dbInstance.dbInstanceEndpointPort;

    // ── 5. SSM Parameters ─────────────────────────────────────────────────
    // Almacenamos en SSM los datos de conexion de cada microservicio.
    // Las Lambdas leeran estos parametros en tiempo de arranque.
    // Tipo String para el endpoint y puerto (no son secretos).
    // Las contrasenas van en Secrets Manager (gestionado por CDK automaticamente).

    // Endpoint compartido (los 3 MS usan la misma instancia RDS)
    new ssm.StringParameter(this, 'DbEndpointParam', {
      parameterName: '/tfm/db/endpoint',
      stringValue: dbInstance.dbInstanceEndpointAddress,
      description: 'Endpoint del RDS MySQL de TFM Bandas',
    });

    new ssm.StringParameter(this, 'DbPortParam', {
      parameterName: '/tfm/db/port',
      stringValue: dbInstance.dbInstanceEndpointPort,
      description: 'Puerto del RDS MySQL de TFM Bandas',
    });

    // URLs JDBC de cada microservicio
    // Formato: jdbc:mysql://ENDPOINT:3306/SCHEMA?useSSL=true&requireSSL=true
    // useSSL=true: activa SSL en el driver JDBC de MySQL
    // requireSSL=true: falla si el servidor no acepta SSL (doble garantia)
    new ssm.StringParameter(this, 'DbUrlUsers', {
      parameterName: '/tfm/db/url/users',
      stringValue: `jdbc:mysql://${dbInstance.dbInstanceEndpointAddress}:3306/tfm_users?useSSL=true&requireSSL=true`,
      description: 'JDBC URL para MS Users',
    });

    new ssm.StringParameter(this, 'DbUrlEvents', {
      parameterName: '/tfm/db/url/events',
      stringValue: `jdbc:mysql://${dbInstance.dbInstanceEndpointAddress}:3306/tfm_events?useSSL=true&requireSSL=true`,
      description: 'JDBC URL para MS Events',
    });

    new ssm.StringParameter(this, 'DbUrlSurveys', {
      parameterName: '/tfm/db/url/surveys',
      stringValue: `jdbc:mysql://${dbInstance.dbInstanceEndpointAddress}:3306/tfm_surveys?useSSL=true&requireSSL=true`,
      description: 'JDBC URL para MS Surveys',
    });

    // Nombre de usuario admin (no es secreto, si el valor de la contrasena)
    new ssm.StringParameter(this, 'DbUsernameParam', {
      parameterName: '/tfm/db/username',
      stringValue: 'tfm_admin',
      description: 'Usuario administrador de RDS - contrasena en Secrets Manager',
    });

    // ── 6. Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
      description: 'Endpoint RDS - usar para conectar con MySQL Workbench o Flyway',
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: dbInstance.dbInstanceEndpointPort,
      description: 'Puerto RDS',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbInstance.secret!.secretArn,
      description: 'ARN del secreto en Secrets Manager - contiene usuario y contrasena del admin',
    });

    new cdk.CfnOutput(this, 'DbSecretName', {
      value: 'tfm/rds/master-credentials',
      description: 'Nombre del secreto en Secrets Manager',
    });
  }
}