import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface MongoDbEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;
  readonly mongodbPassword: string;
  readonly mongodbUsername?: string;
  /** @default 1024 */
  readonly memoryLimitMiB?: number;
  /** @default 512 (0.5 vCPU) */
  readonly cpu?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
}

/**
 * MongoDB 7 running on Fargate with Cloud Map service discovery.
 *
 * Reachable from within the VPC at mongodb.github.local:27017.
 * Data is stored on ephemeral Fargate storage — add EFS for persistence.
 *
 * MongoDB uses binary TCP so it cannot be proxied by HTTP API Gateway.
 * Connect directly from other ECS services via the Cloud Map DNS name.
 */
export class MongoDbEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: MongoDbEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      mongodbPassword,
      mongodbUsername = 'mongoadmin',
      memoryLimitMiB = 1024,
      cpu = 512,
      placeTasksInPublicSubnets = false,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for MongoDB Fargate tasks',
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(27017),
      'Allow MongoDB from VPC',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/mongodb',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('mongodb', {
      image: ecs.ContainerImage.fromRegistry('mongo:7'),
      portMappings: [{ containerPort: 27017, protocol: ecs.Protocol.TCP }],
      environment: {
        MONGO_INITDB_ROOT_USERNAME: mongodbUsername,
        MONGO_INITDB_ROOT_PASSWORD: mongodbPassword,
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'mongodb',
      }),
      healthCheck: {
        command: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    // ── Fargate service ───────────────────────────────────────────────────────
    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [this.taskSecurityGroup],
      vpcSubnets: placeTasksInPublicSubnets
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: placeTasksInPublicSubnets,
      circuitBreaker: { rollback: true },
      cloudMapOptions: { name: 'mongodb' },
    });

    this.cloudMapService = this.service.cloudMapService;
  }
}
