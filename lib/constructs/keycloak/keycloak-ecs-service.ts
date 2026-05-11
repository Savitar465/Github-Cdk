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
  /**
   * Public hostname used for Keycloak (no scheme, no path, no port).
   * When omitted, the ALB's auto-generated DNS name is used — useful when
   * you don't own a custom domain.
   */
  readonly keycloakHostname?: string;
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
 *  - Memory is capped at 1400 MiB so it fits on a t3.small (2 GiB total, with
 *    headroom for the ECS agent and OS).
 *  - When `placeTasksInPublicSubnets` is true (no NAT gateways) tasks are
 *    placed in public subnets and assigned a public IP so they can pull images
 *    from ECR and write logs to CloudWatch.
 *  - When `keycloakHostname` is omitted, the ALB DNS name is used as
 *    KC_HOSTNAME so the service is reachable without a custom domain.
 */
export class KeycloakEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

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

    // Allow HTTP traffic from the ALB / anywhere inside the VPC.
    taskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow HTTP from ALB/VPC',
    );

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

    // ── Application Load Balancer ─────────────────────────────────────────────
    // Created before the task definition so its DNS name can be used as
    // KC_HOSTNAME when no custom domain is provided.
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
    });

    // Keycloak 25+ serves /health/* on the management port (9000), not 8080.
    // CDK auto-wires the traffic port (8080) but not the health-check port,
    // so we add the rule explicitly using the ALB's own security group.
    this.loadBalancer.connections.allowTo(taskSecurityGroup, ec2.Port.tcp(9000));

    // Use the provided hostname, or fall back to the ALB DNS name so the
    // service works without a custom domain.
    const resolvedHostname = keycloakHostname ?? this.loadBalancer.loadBalancerDnsName;

    // ── CloudWatch log group ──────────────────────────────────────────────────
    const keycloakLogGroup = new logs.LogGroup(this, 'KeycloakLogGroup', {
      logGroupName: '/ecs/keycloak',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition (Fargate) ─────────────────────────────────────────────
    // 1 vCPU / 2 GB is the smallest Fargate combination that comfortably fits
    // the Keycloak JVM (heap capped at 768m) plus OS/agent overhead.
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    const keycloakContainer = taskDefinition.addContainer('keycloak', {
      image: ecs.ContainerImage.fromRegistry('quay.io/keycloak/keycloak:26.3.3'),
      // Override the default entrypoint so we can run kcadm.sh after Keycloak
      // starts to force sslRequired=NONE on the master realm.  The default
      // value (external) blocks all HTTP access and is persisted in RDS, so
      // KC_HOSTNAME with an http:// scheme alone is not enough to fix it.
      entryPoint: ['/bin/bash', '-c'],
      // Script runs after Keycloak is up to patch master-realm settings that
      // are persisted in RDS and don't update when KC_HOSTNAME changes:
      //   • sslRequired=NONE  — removes the "HTTPS required" block on HTTP
      //   • redirectUris=["*"] on security-admin-console — fixes the
      //     "Invalid parameter: redirect_uri" error after a hostname change
      command: [
        [
          '/opt/keycloak/bin/kc.sh start &',
          'PID=$!',
          "trap 'kill $PID; wait $PID' TERM INT",
          // Wait until kcadm can log in (== Keycloak is fully up).
          'until /opt/keycloak/bin/kcadm.sh config credentials'
          + ' --server http://localhost:8080 --realm master'
          + ' --user "$KC_BOOTSTRAP_ADMIN_USERNAME"'
          + ' --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" 2>/dev/null'
          + '; do sleep 5; done',
          // Disable HTTPS enforcement stored in the master realm row.
          '/opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE 2>/dev/null || true',
          // Widen the redirect URIs on the built-in security-admin-console client
          // to ["*"] so the admin console works regardless of which ALB hostname
          // is used.  Without this the login fails with "invalid_redirect_uri"
          // when KC_HOSTNAME differs from what Keycloak originally stored in RDS.
          "CLIENT_ID=$(/opt/keycloak/bin/kcadm.sh get clients -r master -q clientId=security-admin-console --fields id 2>/dev/null | grep -o '\"id\" : \"[^\"]*\"' | grep -o '\"[^\"]*\"$' | tr -d '\"')",
          "[ -n \"$CLIENT_ID\" ] && /opt/keycloak/bin/kcadm.sh update clients/$CLIENT_ID -r master -s 'redirectUris=[\"*\"]' 2>/dev/null || true",
          // Keep the bash process (PID 1) alive waiting for Keycloak to exit.
          // Without this line bash exits after the kcadm commands, which kills
          // the container and triggers the ECS circuit breaker.
          'wait $PID',
        ].join('\n')
      ],
      environment: {
        KC_BOOTSTRAP_ADMIN_USERNAME: keycloakAdminUser,
        KC_BOOTSTRAP_ADMIN_PASSWORD: keycloakAdminPassword,
        KC_HOSTNAME: `http://${resolvedHostname}`,
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

    // ── Fargate service ───────────────────────────────────────────────────────
    const vpcSubnets: ec2.SubnetSelection = placeTasksInPublicSubnets
      ? { subnetType: ec2.SubnetType.PUBLIC }
      : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: replicas,
      securityGroups: [taskSecurityGroup],
      vpcSubnets,
      assignPublicIp: placeTasksInPublicSubnets,
      // On a fresh database Keycloak runs 100+ Liquibase migrations before
      // /health/ready returns 200. Give it 8 minutes to be safe.
      healthCheckGracePeriod: cdk.Duration.seconds(480),
      circuitBreaker: { rollback: true },
    });

    // ── Listener & targets ────────────────────────────────────────────────────
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
        healthyThresholdCount: 3,
        unhealthyThresholdCount: 5,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS name for Keycloak',
    });

    new cdk.CfnOutput(this, 'KeycloakUrl', {
      value: `http://${resolvedHostname}/admin`,
      description: 'Keycloak admin console URL',
    });
  }
}
