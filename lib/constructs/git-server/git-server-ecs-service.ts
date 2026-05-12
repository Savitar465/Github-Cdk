import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface GitServerEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;
  /** URL of the repository microservice used by the git-auth SSH hook. */
  readonly microserviceUrl: string;
  /** Shared bearer token sent by the git-auth script to the microservice. */
  readonly microserviceAuthToken: string;
  /** @default 9080 */
  readonly httpPort?: number;
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
 * Git SSH/HTTP server running on Fargate.
 * Reachable within the VPC at git-server.github.local:9080.
 */
export class GitServerEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: GitServerEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      microserviceUrl,
      microserviceAuthToken,
      httpPort = 9080,
      memoryLimitMiB = 1024,
      cpu = 512,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for git-ssh-http-server Fargate tasks',
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(httpPort),
      'Allow HTTP Git traffic from VPC',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/git-server',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('git-server', {
      image: ecs.ContainerImage.fromRegistry('cfulano/git-ssh-http-server:latest'),
      portMappings: [{ containerPort: httpPort, protocol: ecs.Protocol.TCP }],
      environment: {
        SERVER_MICROSERVICE_URL: microserviceUrl,
        SERVER_MICROSERVICE_AUTH_TOKEN: microserviceAuthToken,
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'git-server',
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
      cloudMapOptions: { name: 'git-server' },
    });

    this.cloudMapService = this.service.cloudMapService;
  }
}
