import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface UsersEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;
  readonly dbSecurityGroup: ec2.SecurityGroup;
  readonly dbHost: string;
  readonly dbName: string;
  readonly dbPassword: string;
  readonly serverPort: number;
  readonly springAppName: string;
  readonly keycloakIssuerUri: string;
  readonly keycloakJwkSetUri: string;
  readonly keycloakClientId: string;
  readonly keycloakClientSecret: string;
  readonly keycloakAuthGrantType: string;
  readonly keycloakScope: string;
  readonly keycloakServerUrl: string;
  readonly keycloakRealm: string;
  readonly keycloakAdminClient: string;
  readonly keycloakAdminClientSecret: string;
  /** @default 1024 */
  readonly memoryLimitMiB?: number;
  /** @default 512 (0.5 vCPU) */
  readonly cpu?: number;
  /** @default 1 */
  readonly desiredCount?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
  /** Secrets Manager secret with `username`/`password` keys for Docker Hub authenticated pulls. */
  readonly dockerHubSecret?: secretsmanager.ISecret;
}

export class UsersEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: UsersEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      dbSecurityGroup,
      dbHost,
      dbName,
      dbPassword,
      serverPort,
      springAppName,
      keycloakIssuerUri,
      keycloakJwkSetUri,
      keycloakClientId,
      keycloakClientSecret,
      keycloakAuthGrantType,
      keycloakScope,
      keycloakServerUrl,
      keycloakRealm,
      keycloakAdminClient,
      keycloakAdminClientSecret,
      memoryLimitMiB = 1024,
      cpu = 512,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
      dockerHubSecret,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Security group for github-ms-users Fargate tasks',
      allowAllOutbound: true,
    });

    taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(serverPort),
      'Allow service traffic from VPC',
    );

    taskSecurityGroup.addEgressRule(
      dbSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access',
    );
    dbSecurityGroup.addIngressRule(
      taskSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow users-ms tasks to access the database',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/github-ms-users',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition (Fargate) ─────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('users', {
      image: ecs.ContainerImage.fromRegistry('cfulano/github-ms-users:latest', { credentials: dockerHubSecret }),
      portMappings: [{ containerPort: serverPort, protocol: ecs.Protocol.TCP }],
      environment: {
        SERVER_PORT: String(serverPort),
        SPRING_APPLICATION_NAME: springAppName,
        USUARIOS_DB_URL: `jdbc:postgresql://${dbHost}:5432/${dbName}`,
        USUARIOS_DB_USERNAME: 'postgres',
        USUARIOS_DB_PASSWORD: dbPassword,
        KEYCLOAK_ISSUER_URI: keycloakIssuerUri,
        KEYCLOAK_JWK_SET_URI: keycloakJwkSetUri,
        KEYCLOAK_CLIENT_ID: keycloakClientId,
        KEYCLOAK_CLIENT_SECRET: keycloakClientSecret,
        KEYCLOAK_AUTH_GRANT_TYPE: keycloakAuthGrantType,
        KEYCLOAK_SCOPE: keycloakScope,
        KEYCLOAK_SERVER_URL: keycloakServerUrl,
        KEYCLOAK_REALM: keycloakRealm,
        KEYCLOAK_ADMIN_CLIENT: keycloakAdminClient,
        KEYCLOAK_ADMIN_CLIENT_SECRET: keycloakAdminClientSecret,
        JAVA_TOOL_OPTIONS: '-Xms256m -Xmx512m',
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'users',
      }),
    });

    // ── Fargate service ───────────────────────────────────────────────────────
    const vpcSubnets: ec2.SubnetSelection = placeTasksInPublicSubnets
      ? { subnetType: ec2.SubnetType.PUBLIC }
      : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount,
      securityGroups: [taskSecurityGroup],
      vpcSubnets,
      assignPublicIp: placeTasksInPublicSubnets,
      circuitBreaker: { rollback: true },
      cloudMapOptions: {
        name: 'users',
      },
    });

    this.taskSecurityGroup = taskSecurityGroup;
    this.cloudMapService = this.service.cloudMapService;
  }
}
