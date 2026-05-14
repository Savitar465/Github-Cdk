import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface IssuesMsEcsServiceProps {
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

  /** @default 8091 */
  readonly serverPort?: number;
  /** @default 9091 */
  readonly grpcPort?: number;
  /** @default 1024 */
  readonly memoryLimitMiB?: number;
  /** @default 512 */
  readonly cpu?: number;
  /** @default 1 */
  readonly desiredCount?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
  /** Secrets Manager secret with `username`/`password` keys for Docker Hub authenticated pulls. */
  readonly dockerHubSecret?: secretsmanager.ISecret;
}

/**
 * GitHub issues microservice running on Fargate.
 * Connects to RDS PostgreSQL.
 * Reachable within the VPC at issues-ms.github.local:8091.
 */
export class IssuesMsEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: IssuesMsEcsServiceProps) {
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
      serverPort = 8091,
      grpcPort = 9091,
      memoryLimitMiB = 1024,
      cpu = 512,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
      dockerHubSecret,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for github-issues-ms Fargate tasks',
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(serverPort),
      'Allow HTTP traffic from VPC',
    );

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(grpcPort),
      'Allow gRPC traffic from VPC',
    );

    dbSecurityGroup.addIngressRule(
      this.taskSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow issues-ms tasks to access the database',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/issues-ms',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('issues-ms', {
      image: ecs.ContainerImage.fromRegistry('cfulano/github-issues-ms:latest', { credentials: dockerHubSecret }),
      portMappings: [
        { containerPort: serverPort, protocol: ecs.Protocol.TCP },
        { containerPort: grpcPort, protocol: ecs.Protocol.TCP },
      ],
      environment: {
        SERVER_PORT: String(serverPort),
        GRPC_PORT: String(grpcPort),
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
        streamPrefix: 'issues-ms',
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
      cloudMapOptions: { name: 'issues-ms' },
    });

    this.cloudMapService = this.service.cloudMapService;
  }
}
