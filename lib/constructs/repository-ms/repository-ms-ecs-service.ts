import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface RepositoryMsEcsServiceProps {
  readonly cluster: ecs.Cluster;
  readonly vpc: ec2.IVpc;

  // ── MongoDB connection ────────────────────────────────────────────────────
  readonly mongoHost: string;
  readonly mongoPort: number;
  readonly mongoDatabase: string;
  readonly mongoUsername: string;
  readonly mongoPassword: string;
  /** @default 'admin' */
  readonly mongoAuthDatabase?: string;

  // ── Git server ────────────────────────────────────────────────────────────
  readonly gitServerHttpUrl: string;
  readonly gitServerSshHost: string;
  readonly gitServerSshPort: number;

  // ── Auth / JWT ────────────────────────────────────────────────────────────
  readonly microserviceAuthToken: string;
  readonly jwtIssuerUri: string;
  readonly jwtJwkSetUri: string;

  // ── Keycloak ──────────────────────────────────────────────────────────────
  readonly keycloakHost: string;
  readonly keycloakRealm: string;
  /** Optional — omit when Keycloak is on the default HTTP/HTTPS port. */
  readonly keycloakPort?: string;

  /** @default 8090 */
  readonly serverPort?: number;
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
 * GitHub repository microservice running on Fargate.
 * Connects to MongoDB at mongodb.github.local:27017.
 * Reachable publicly via ALB and within the VPC at repository-ms.github.local:8090.
 */
export class RepositoryMsEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  public readonly cloudMapService: servicediscovery.IService | undefined;

  constructor(scope: Construct, id: string, props: RepositoryMsEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      mongoHost,
      mongoPort,
      mongoDatabase,
      mongoUsername,
      mongoPassword,
      mongoAuthDatabase = 'admin',
      gitServerHttpUrl,
      gitServerSshHost,
      gitServerSshPort,
      microserviceAuthToken,
      jwtIssuerUri,
      jwtJwkSetUri,
      keycloakHost,
      keycloakRealm,
      keycloakPort = '',
      serverPort = 8090,
      memoryLimitMiB = 1024,
      cpu = 512,
      desiredCount = 1,
      placeTasksInPublicSubnets = false,
      dockerHubSecret,
    } = props;

    // ── Security group ────────────────────────────────────────────────────────
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
      vpc,
      description: 'Security group for github-repository-ms Fargate tasks',
      allowAllOutbound: true,
    });

    this.taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(serverPort),
      'Allow service traffic from VPC',
    );

    // ── Application Load Balancer (public) ────────────────────────────────────
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    });

    this.loadBalancer.connections.allowTo(
      this.taskSecurityGroup,
      ec2.Port.tcp(serverPort),
      'ALB to repository-ms container',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/repository-ms',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB,
      cpu,
    });

    taskDefinition.addContainer('repository-ms', {
      image: ecs.ContainerImage.fromRegistry('cfulano/github-repository-ms:latest', { credentials: dockerHubSecret }),
      portMappings: [{ containerPort: serverPort, protocol: ecs.Protocol.TCP }],
      environment: {
        SERVER_PORT: String(serverPort),
        MONGO_HOST: mongoHost,
        MONGO_PORT: String(mongoPort),
        MONGO_DATABASE: mongoDatabase,
        MONGO_USERNAME: mongoUsername,
        MONGO_PASSWORD: mongoPassword,
        MONGO_AUTH_DATABASE: mongoAuthDatabase,
        GIT_SERVER_HTTP_URL: gitServerHttpUrl,
        GIT_SERVER_SSH_HOST: gitServerSshHost,
        GIT_SERVER_SSH_PORT: String(gitServerSshPort),
        MICROSERVICE_AUTH_TOKEN: microserviceAuthToken,
        JWT_ISSUER_URI: jwtIssuerUri,
        JWT_JWK_SET_URI: jwtJwkSetUri,
        KEYCLOAK_HOST: keycloakHost,
        KEYCLOAK_PORT: keycloakPort,
        KEYCLOAK_REALM: keycloakRealm,
        JAVA_TOOL_OPTIONS: '-Xms256m -Xmx512m',
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'repository-ms',
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
      // Give Spring Boot + MongoDB init time before ALB health checks count.
      healthCheckGracePeriod: cdk.Duration.seconds(180),
      minHealthyPercent: 0,
      circuitBreaker: { rollback: true },
      cloudMapOptions: { name: 'repository-ms' },
    });

    this.cloudMapService = this.service.cloudMapService;

    // ── Listener & targets ────────────────────────────────────────────────────
    const listener = this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('RepositoryTargets', {
      port: serverPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/actuator/health',
        healthyHttpCodes: '200-499',
        port: String(serverPort),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
  }
}
