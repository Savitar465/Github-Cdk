import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface FrontendEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;
  readonly filesApiUrl: string;
  readonly usersApiUrl: string;
  readonly repositoryApiUrl: string;
  readonly prApiUrl: string;
  readonly orgApiUrl: string;
  readonly issuesApiUrl: string;
  /** Full URL to the Keycloak instance (e.g. http://<alb-dns>). */
  readonly keycloakUrl: string;
  readonly keycloakRealm: string;
  readonly keycloakClientId: string;
  readonly useKeycloak: boolean;
  readonly useMockAuth: boolean;
  readonly gitHttpUrl: string;
  readonly gitSshHost: string;
  readonly gitSshPort: number;
  /** Port the container listens on. @default 3000 */
  readonly containerPort?: number;
  /** @default 512 */
  readonly memoryLimitMiB?: number;
  /** @default 256 */
  readonly cpu?: number;
  /** @default 1 */
  readonly desiredCount?: number;
  /** When true tasks get a public IP (required when there is no NAT gateway). */
  readonly placeTasksInPublicSubnets?: boolean;
  /** Secrets Manager secret with `username`/`password` keys for Docker Hub authenticated pulls. */
  readonly dockerHubSecret?: secretsmanager.ISecret;
}

/**
 * Frontend web application running on Fargate behind a public ALB.
 * The ALB listens on port 80 and is internet-facing.
 */
export class FrontendEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly taskSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: FrontendEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      filesApiUrl,
      usersApiUrl,
      repositoryApiUrl,
      prApiUrl,
      orgApiUrl,
      issuesApiUrl,
      keycloakUrl,
      keycloakRealm,
      keycloakClientId,
      useKeycloak,
      useMockAuth,
      gitHttpUrl,
      gitSshHost,
      gitSshPort,
      containerPort = 3000,
      memoryLimitMiB = 512,
      cpu = 256,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
      dockerHubSecret,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for github-front Fargate tasks',
      allowAllOutbound: true,
    });

    // ── Application Load Balancer (public) ────────────────────────────────────
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    });

    // Allow ALB to reach container port on the task security group.
    this.loadBalancer.connections.allowTo(
      this.taskSecurityGroup,
      ec2.Port.tcp(containerPort),
      'ALB to frontend container',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/frontend',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('frontend', {
      image: ecs.ContainerImage.fromRegistry('cfulano/github-front:latest', { credentials: dockerHubSecret }),
      portMappings: [{ containerPort, protocol: ecs.Protocol.TCP }],
      environment: {
        NODE_ENV: 'production',
        HOSTNAME: '0.0.0.0',
        PORT: String(containerPort),
        NEXT_PUBLIC_FILES_API_URL: filesApiUrl,
        NEXT_PUBLIC_USERS_API_URL: usersApiUrl,
        NEXT_PUBLIC_REPOSITORY_API_URL: repositoryApiUrl,
        NEXT_PUBLIC_PR_API_URL: prApiUrl,
        NEXT_PUBLIC_ORG_API_URL: orgApiUrl,
        NEXT_PUBLIC_ISSUES_API_URL: issuesApiUrl,
        NEXT_PUBLIC_KEYCLOAK_URL: keycloakUrl,
        NEXT_PUBLIC_KEYCLOAK_REALM: keycloakRealm,
        NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: keycloakClientId,
        NEXT_PUBLIC_USE_KEYCLOAK: String(useKeycloak),
        NEXT_PUBLIC_USE_MOCK_AUTH: String(useMockAuth),
        NEXT_PUBLIC_GIT_HTTP_URL: gitHttpUrl,
        NEXT_PUBLIC_GIT_SSH_HOST: gitSshHost,
        NEXT_PUBLIC_GIT_SSH_PORT: String(gitSshPort),
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'frontend',
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
    });

    // ── Listener & targets ────────────────────────────────────────────────────
    const listener = this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('FrontendTargets', {
      port: containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
  }
}
