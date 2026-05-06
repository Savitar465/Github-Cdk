import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import { GithubDatabase, GithubVpc, KeycloakEcsService, EcsCluster } from '../constructs';

export interface KeycloakStackProps extends cdk.StackProps, EnvironmentConfig {}

/**
 * Top-level stack for the Keycloak deployment on ECS.
 *
 * This stack is intentionally thin – it only wires together the three
 * reusable constructs:
 *   - {@link GithubVpc} → VPC with public + private subnets
 *   - {@link GithubDatabase} → RDS PostgreSQL
 *   - {@link KeycloakEcsService} → ECS Fargate service with Keycloak
 *
 * All configuration is driven by {@link EnvironmentConfig}, which keeps
 * environment-specific values out of the stack code.
 */
export class KeycloakStack extends cdk.Stack {
  /** Exposed for cross-stack use (e.g. deploying additional services). */
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);

    // ── Network ───────────────────────────────────────────────────────────────
    const network = new GithubVpc(this, 'Network', {
      maxAzs: props.vpcMaxAzs,
      natGateways: props.vpcNatGateways,
    });

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const ecsCluster = new EcsCluster(this, 'EcsCluster', {
      vpc: network.vpc,
      clusterName: props.clusterName,
      instanceType: props.ecsInstanceType,
      desiredCapacity: props.ecsDesiredCapacity,
      minCapacity: props.ecsMinCapacity,
      maxCapacity: props.ecsMaxCapacity,
    });
    this.cluster = ecsCluster.cluster;

    // ── Database ──────────────────────────────────────────────────────────────
    const database = new GithubDatabase(this, 'Database', {
      vpc: network.vpc,
      dbPassword: props.dbPassword,
      dbName: props.dbName,
      multiAz: props.rdsMultiAz,
      instanceType: props.rdsInstanceType,
      allocatedStorageGb: props.rdsAllocatedStorageGb,
      engineVersion: props.rdsEngineVersion,
      publiclyAccessible: props.rdsPubliclyAccessible,
    });

    // ── Keycloak on ECS ────────────────────────────────────────────────────────
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
    });

    // ── CloudFormation Outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.endpointAddress,
      description: 'RDS PostgreSQL endpoint',
      exportName: `${this.stackName}-DbEndpoint`,
    });

    new cdk.CfnOutput(this, 'KeycloakUrl', {
      value: `http://${props.keycloakHostname}`,
      description: 'Keycloak base URL',
      exportName: `${this.stackName}-KeycloakUrl`,
    });

    if (keycloakService.loadBalancer) {
      new cdk.CfnOutput(this, 'LoadBalancerDns', {
        value: keycloakService.loadBalancer.loadBalancerDnsName,
        description: 'Application Load Balancer DNS name',
        exportName: `${this.stackName}-LoadBalancerDns`,
      });
    }
  }
}
