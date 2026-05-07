import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface KeycloakEcsServiceProps {
  /** The ECS cluster to deploy the service to */
  readonly cluster: ecs.Cluster;
  /** VPC where the service runs */
  readonly vpc: ec2.IVpc;
  /** Security group for the service (to allow DB access) */
  readonly dbSecurityGroup: ec2.SecurityGroup;
  /** Public hostname used for Keycloak */
  readonly keycloakHostname: string;
  /** Keycloak bootstrap admin username */
  readonly keycloakAdminUser: string;
  /** Keycloak bootstrap admin password */
  readonly keycloakAdminPassword: string;
  /** RDS endpoint address (CloudFormation token is accepted) */
  readonly dbHost: string;
  /** Database name used by Keycloak */
  readonly dbName: string;
  /** Database password injected into the task */
  readonly dbPassword: string;
  /**
   * Number of task replicas.
   * @default 1
   */
  readonly replicas?: number;
  /**
   * When true the ECS tasks are placed in public subnets and given public IPs.
   * Required when the VPC has no NAT gateways so tasks can reach ECR/CloudWatch.
   * @default false
   */
  readonly placeTasksInPublicSubnets?: boolean;
}

/**
 * ECS service that runs Keycloak with an RDS PostgreSQL backend.
 *
 * Free-tier / dev notes:
 *  - Memory is capped at 900 MiB so it fits on a t3.small (2 GiB total, with
 *    headroom for the ECS agent and OS).
 *  - When `placeTasksInPublicSubnets` is true (no NAT gateways) tasks are
 *    placed in public subnets and assigned a public IP so they can pull images
 *    from ECR and write logs to CloudWatch.
 */
export class KeycloakEcsService extends Construct {
  public readonly service: ecs.Ec2Service;
  public readonly loadBalancer?: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: KeycloakEcsServiceProps) {
    super(scope, id);

    const {
      cluster,
      vpc,
      dbSecurityGroup,
      keycloakHostname,
      keycloakAdminUser,
      keycloakAdminPassword,
      dbHost,
      dbName,
      dbPassword,
      replicas = 1,
      placeTasksInPublicSubnets = false,
    } = props;

    // ── Security group for ECS tasks ──────────────────────────────────────────
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Security group for Keycloak ECS tasks',
      allowAllOutbound: true,
    });

    // Allow HTTP from the ALB / anywhere inside the VPC.
    taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow HTTP from ALB/VPC',
    );

    // Keycloak 25+ serves /health/* on a separate management port (9000).
    // This rule is added after the ALB is created below (see loadBalancer.connections).

    // Allow the task to reach PostgreSQL.
    taskSecurityGroup.addEgressRule(
      dbSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL database access',
    );
    dbSecurityGroup.addIngressRule(
      taskSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to access Keycloak database',
    );

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const keycloakLogGroup = new logs.LogGroup(this, 'KeycloakLogGroup', {
      logGroupName: '/ecs/keycloak',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────────────────
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    // Keycloak container.
    // 1400 MiB on a t3.small (2 GiB total) leaves ~400 MiB for the ECS agent
    // and OS. The JVM heap is capped at 768m so RSS stays well inside the limit.
    const keycloakContainer = taskDefinition.addContainer('keycloak', {
      image: ecs.ContainerImage.fromRegistry('quay.io/keycloak/keycloak:26.3.3'),
      memoryLimitMiB: 1400,
      cpu: 512,
      command: ['start'],
      environment: {
        KC_BOOTSTRAP_ADMIN_USERNAME: keycloakAdminUser,
        KC_BOOTSTRAP_ADMIN_PASSWORD: keycloakAdminPassword,
        KC_HOSTNAME: keycloakHostname,
        KC_PROXY_HEADERS: 'xforwarded',
        KC_HTTP_ENABLED: 'true',
        KC_HOSTNAME_STRICT: 'false',
        KC_HEALTH_ENABLED: 'true',
        KC_CACHE: 'local',
        KC_DB: 'postgres',
        KC_DB_URL_DATABASE: dbName,
        KC_DB_URL_HOST: dbHost,
        KC_DB_USERNAME: 'postgres',
        KC_DB_PASSWORD: dbPassword,
        KC_TRANSACTION_XA_ENABLED: 'false',
        KC_METRICS_ENABLED: 'true',
        // Limit JVM heap so Keycloak stays within the container memory budget.
        JAVA_OPTS_APPEND: '-Xms256m -Xmx768m',
      },
      logging: ecs.LogDriver.awsLogs({
        logGroup: keycloakLogGroup,
        streamPrefix: 'keycloak',
      }),
      portMappings: [
        {
          containerPort: 8080,
          protocol: ecs.Protocol.TCP,
        },
        {
          containerPort: 9000,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    keycloakContainer.addUlimits({
      name: ecs.UlimitName.NOFILE,
      softLimit: 1024,
      hardLimit: 2048,
    });

    // ── ECS service ───────────────────────────────────────────────────────────
    // When there are no NAT gateways the tasks must live in public subnets and
    // have a public IP so they can reach ECR (image pull) and CloudWatch (logs).
    const vpcSubnets: ec2.SubnetSelection = placeTasksInPublicSubnets
      ? { subnetType: ec2.SubnetType.PUBLIC }
      : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    this.service = new ecs.Ec2Service(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: replicas,
      // Public IP is required when tasks sit in public subnets (no NAT).
      assignPublicIp: placeTasksInPublicSubnets,
      securityGroups: [taskSecurityGroup],
      vpcSubnets,
      // Keycloak takes 60-120 s to boot; give it extra room before the ALB
      // marks it unhealthy and ECS kills the task (exit 143).
      healthCheckGracePeriod: cdk.Duration.seconds(240),
      // Stop the deployment after repeated failures and roll back instead of
      // retrying indefinitely (which hangs `cdk deploy` forever).
      circuitBreaker: { rollback: true },
    });

    // ── Application Load Balancer ─────────────────────────────────────────────
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
    });

    const listener = this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('KeycloakTargets', {
      port: 8080,
      targets: [this.service],
      healthCheck: {
        path: '/health/ready',
        port: '9000',
        healthyHttpCodes: '200',
        // Require 3 consecutive successes before the target is considered healthy.
        healthyThresholdCount: 3,
        // Allow 5 consecutive failures — combined with the grace period this
        // gives Keycloak 120 s + (5 × 30 s) = 270 s to finish starting up.
        unhealthyThresholdCount: 5,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Allow the ALB (by its own security group, not just CIDR) to reach the
    // Keycloak management port for health checks. CDK only auto-wires the
    // traffic port (8080); we must add port 9000 explicitly.
    this.loadBalancer.connections.allowTo(taskSecurityGroup, ec2.Port.tcp(9000));

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS name for Keycloak',
    });
  }
}