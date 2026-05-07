import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import { GithubDatabase, GithubVpc, KeycloakEcsService, EcsCluster } from '../constructs';

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
  public readonly cluster: ecs.Cluster;

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
      instanceType: props.ecsInstanceType,
      desiredCapacity: props.ecsDesiredCapacity,
      minCapacity: props.ecsMinCapacity,
      maxCapacity: props.ecsMaxCapacity,
      placeInstancesInPublicSubnets: noNat,
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

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: keycloakService.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
      exportName: `${this.stackName}-LoadBalancerDns`,
    });
  }
}