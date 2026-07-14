import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface AiEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;

  /** Cloud Map name, e.g. 'issue-classifier-ms' → issue-classifier-ms.github.local */
  readonly cloudMapName: string;
  /**
   * ECR repository (outside this stack, survives destroys) holding the image.
   * CI/CD pushes :latest on every merge to main; the model travels inside
   * the image (basic MLOps: model version tied to image version).
   */
  readonly ecrRepositoryName: string;
  readonly serverPort: number;
  readonly logGroupName: string;

  // ── JWT (same values as the Java microservices) ──────────────────────────
  readonly jwtIssuerUri: string;
  readonly jwtJwkSetUri: string;

  /** @default 1024 (the summarizer loads a torch model) */
  readonly memoryLimitMiB?: number;
  /** @default 256 */
  readonly cpu?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
}

/**
 * Generic Fargate service for the Mini-GitHub AI microservices (FastAPI).
 * Internal-only: reachable via Cloud Map from the frontend server, never
 * exposed through a load balancer.
 */
export class AiEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: AiEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      cloudMapName,
      ecrRepositoryName,
      serverPort,
      logGroupName,
      jwtIssuerUri,
      jwtJwkSetUri,
      memoryLimitMiB = 1024,
      cpu = 256,
      placeTasksInPublicSubnets = false,
    } = props;

    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: `Security group for ${cloudMapName} Fargate tasks`,
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(serverPort),
      'Allow service traffic from VPC',
    );

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    const repository = ecr.Repository.fromRepositoryName(this, 'EcrRepo', ecrRepositoryName);

    taskDefinition.addContainer(cloudMapName, {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      portMappings: [{ containerPort: serverPort, protocol: ecs.Protocol.TCP }],
      environment: {
        SERVER_PORT: String(serverPort),
        APP_SECURITY_OAUTH2_ENABLED: 'true',
        JWT_ISSUER_URI: jwtIssuerUri,
        JWT_JWK_SET_URI: jwtJwkSetUri,
      },
      logging: ecs.LogDriver.awsLogs({ logGroup, streamPrefix: cloudMapName }),
    });

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
      cloudMapOptions: { name: cloudMapName },
    });

    this.cloudMapService = this.service.cloudMapService;
  }
}
