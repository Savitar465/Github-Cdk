import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface OrganizationsMsEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;
  readonly dbSecurityGroup: ec2.SecurityGroup;

  // ── Database ──────────────────────────────────────────────────────────────
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbName: string;
  readonly dbUsername: string;
  readonly dbPassword: string;
  /** Path to the RDS SSL bundle inside the container image. */
  readonly sslCertPath: string;

  // ── JWT ───────────────────────────────────────────────────────────────────
  readonly jwtIssuerUri: string;
  readonly jwtJwkSetUri: string;

  /** @default 8085 */
  readonly serverPort?: number;
  /** @default 1024 */
  readonly memoryLimitMiB?: number;
  /** @default 512 */
  readonly cpu?: number;
  /** @default 1 */
  readonly desiredCount?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
}

/**
 * GitHub organizations microservice running on Fargate.
 * Connects to RDS PostgreSQL.
 * Reachable within the VPC at organizations-ms.github.local:8085.
 */
export class OrganizationsMsEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: OrganizationsMsEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      dbSecurityGroup,
      dbHost,
      dbPort,
      dbName,
      dbUsername,
      dbPassword,
      sslCertPath,
      jwtIssuerUri,
      jwtJwkSetUri,
      serverPort = 8085,
      memoryLimitMiB = 1024,
      cpu = 512,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for github-organizations-ms Fargate tasks',
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(serverPort),
      'Allow service traffic from VPC',
    );

    dbSecurityGroup.addIngressRule(
      this.taskSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow organizations-ms tasks to access the database',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/organizations-ms',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('organizations-ms', {
      image: ecs.ContainerImage.fromRegistry('cfulano/github-organizations-ms:latest'),
      portMappings: [{ containerPort: serverPort, protocol: ecs.Protocol.TCP }],
      environment: {
        SERVER_PORT: String(serverPort),
        DB_HOST: dbHost,
        DB_PORT: String(dbPort),
        DB_NAME: dbName,
        DB_USERNAME: dbUsername,
        DB_PASSWORD: dbPassword,
        SSL_CERT_PATH: sslCertPath,
        JWT_ISSUER_URI: jwtIssuerUri,
        JWT_JWK_SET_URI: jwtJwkSetUri,
        JAVA_TOOL_OPTIONS: '-Xms256m -Xmx512m',
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'organizations-ms',
      }),
    });

    // ── Fargate service ───────────────────────────────────────────────────────
    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount,
      securityGroups: [this.taskSecurityGroup],
      vpcSubnets: placeTasksInPublicSubnets
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: placeTasksInPublicSubnets,
      circuitBreaker: { rollback: true },
      cloudMapOptions: { name: 'organizations-ms' },
    });

    this.cloudMapService = this.service.cloudMapService;
  }
}
