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
}

/**
 * ECS service that runs Keycloak with RDS PostgreSQL backend.
 *
 * Deployment strategy:
 *  - `alb`: Creates an Application Load Balancer for external access
 */
export class KeycloakEcsService extends Construct {
  public readonly service: ecs.FargateService;
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
    } = props;

    // Create security group for the ECS tasks
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Security group for Keycloak ECS tasks',
      allowAllOutbound: true,
    });

    // Allow ingress from ALB (if used) and database access
    taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow HTTP from ALB/VPC',
    );

    // Allow access to PostgreSQL
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

    // Create an explicit CloudWatch log group so the task has a concrete target.
    const keycloakLogGroup = new logs.LogGroup(this, 'KeycloakLogGroup', {
      logGroupName: '/ecs/keycloak',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 512,
    });

    // Add Keycloak container
    const keycloakContainer = taskDefinition.addContainer('keycloak', {
      image: ecs.ContainerImage.fromRegistry('quay.io/keycloak/keycloak:26.3.3'),
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
      ],
    });

    keycloakContainer.addUlimits({
      name: ecs.UlimitName.NOFILE,
      softLimit: 1024,
      hardLimit: 2048,
    });

    // Create service
    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: replicas,
      assignPublicIp: false,
      securityGroups: [taskSecurityGroup],
    });

    // Set up the load balancer for external ingress.
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
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
      },
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS name for Keycloak',
    });
  }
}






