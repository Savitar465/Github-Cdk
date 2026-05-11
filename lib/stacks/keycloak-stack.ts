import * as cdk from 'aws-cdk-lib';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import { GithubDatabase, GithubVpc, KeycloakEcsService, EcsCluster, UsersEcsService } from '../constructs';

export interface KeycloakStackProps extends cdk.StackProps, EnvironmentConfig {}

/**
 * Top-level stack for the Keycloak deployment on ECS (EC2 launch type).
 *
 * Wires together:
 *   - {@link GithubVpc}         → VPC with public + private subnets
 *   - {@link EcsCluster}        → EC2-backed ECS cluster
 *   - {@link GithubDatabase}    → RDS PostgreSQL
 *   - {@link KeycloakEcsService}→ Keycloak ECS service + ALB
 *
 * Free-tier / dev mode (VPC_NAT_GATEWAYS=0):
 *   Both EC2 instances and ECS tasks are placed in public subnets so they can
 *   reach ECR and CloudWatch without NAT gateways.  RDS is placed in isolated
 *   subnets and only reachable from the task security group.
 */
export class KeycloakStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);

    // Tasks and EC2 instances need public subnets when there are no NAT gateways.
    const noNat = props.vpcNatGateways === 0;

    // ── Network ───────────────────────────────────────────────────────────────
    const network = new GithubVpc(this, 'Network', {
      maxAzs: props.vpcMaxAzs,
      natGateways: props.vpcNatGateways,
    });

    // ── ECS Cluster ───────────────────────────────────────────────────────────
    const ecsCluster = new EcsCluster(this, 'EcsCluster', {
      vpc: network.vpc,
      clusterName: props.clusterName,
    });
    // ── Service Discovery (Cloud Map private DNS namespace) ───────────────────
    // Services register under github.local so they can reach each other via DNS
    // (e.g. users.github.local, keycloak.github.local) without leaving the VPC.
    ecsCluster.cluster.addDefaultCloudMapNamespace({
      name: 'github.local',
      type: servicediscovery.NamespaceType.DNS_PRIVATE,
      vpc: network.vpc,
    });

    // ── Database ──────────────────────────────────────────────────────────────
    const database = new GithubDatabase(this, 'Database', {
      vpc: network.vpc,
      dbPassword: props.dbPassword,
      dbName: props.dbName,
      additionalDatabases: [props.usersDbName],
      multiAz: props.rdsMultiAz,
      instanceType: props.rdsInstanceType,
      allocatedStorageGb: props.rdsAllocatedStorageGb,
      engineVersion: props.rdsEngineVersion,
      publiclyAccessible: props.rdsPubliclyAccessible,
    });

    // ── Keycloak on ECS ───────────────────────────────────────────────────────
    const keycloakService = new KeycloakEcsService(this, 'KeycloakService', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dbSecurityGroup: database.securityGroup,
      keycloakHostname: props.keycloakHostname,
      keycloakAdminUser: props.keycloakAdminUser,
      keycloakAdminPassword: props.keycloakAdminPassword,
      dbHost: database.endpointAddress,
      dbName: props.dbName,
      dbPassword: props.dbPassword,
      replicas: props.keycloakReplicas,
      // Mirror the cluster placement: no NAT → tasks go into public subnets.
      placeTasksInPublicSubnets: noNat,
    });

    // ── Users microservice ────────────────────────────────────────────────────
    const usersService = new UsersEcsService(this, 'UsersService', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      placeTasksInPublicSubnets: noNat,
      dbSecurityGroup: database.securityGroup,
      dbHost: database.endpointAddress,
      dbName: props.usersDbName,
      dbPassword: props.dbPassword,
      serverPort: props.usersServerPort,
      springAppName: props.usersSpringAppName,
      keycloakIssuerUri: props.keycloakIssuerUri,
      keycloakJwkSetUri: props.keycloakJwkSetUri,
      keycloakClientId: props.keycloakClientId,
      keycloakClientSecret: props.keycloakClientSecret,
      keycloakAuthGrantType: props.keycloakAuthGrantType,
      keycloakScope: props.keycloakScope,
      keycloakServerUrl: props.keycloakServerUrl,
      keycloakRealm: props.keycloakRealmName,
      keycloakAdminClient: props.keycloakAdminClient,
      keycloakAdminClientSecret: props.keycloakAdminClientSecret,
    });

    // Both services must wait for the DB-init trigger so that the `keycloak`
    // and `ms-users` databases exist before any container tries to connect.
    if (database.dbInitTrigger) {
      keycloakService.service.node.addDependency(database.dbInitTrigger);
      usersService.service.node.addDependency(database.dbInitTrigger);
    }

    // ── CloudFormation Outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterName', {
      value: ecsCluster.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.endpointAddress,
      description: 'RDS PostgreSQL endpoint',
      exportName: `${this.stackName}-DbEndpoint`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: keycloakService.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
      exportName: `${this.stackName}-LoadBalancerDns`,
    });

    new cdk.CfnOutput(this, 'UsersServiceDiscoveryDns', {
      value: 'users.github.local',
      description: 'DNS name for the users microservice (reachable from within the VPC)',
      exportName: `${this.stackName}-UsersServiceDiscoveryDns`,
    });
  }
}