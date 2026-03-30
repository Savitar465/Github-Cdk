import * as cdk from 'aws-cdk-lib/core';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { KubectlV29Layer } from '@aws-cdk/lambda-layer-kubectl-v29';
import { Construct } from 'constructs';

import {KeycloakDatabase, KeycloakManifests, KubeVpc} from '../constructs';
import { EnvironmentConfig } from '../../config/app-config';

export interface KeycloakStackProps extends cdk.StackProps, EnvironmentConfig {}

/**
 * Top-level stack for the Keycloak deployment.
 *
 * This stack is intentionally thin – it only wires together the three
 * reusable constructs:
 *   - {@link KubeVpc} → VPC with public + private subnets
 *   - {@link KeycloakDatabase} → RDS PostgreSQL 15
 *   - {@link KeycloakManifests} → Kubernetes resources on EKS
 *
 * All configuration is driven by {@link EnvironmentConfig}, which keeps
 * environment-specific values out of the stack code.
 */
export class KeycloakStack extends cdk.Stack {
  /** Exposed for cross-stack use (e.g. deploying additional Helm charts). */
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);

    // ── Network ───────────────────────────────────────────────────────────────
    const network = new KubeVpc(this, 'Network', {
      maxAzs: props.vpcMaxAzs,
      natGateways: props.vpcNatGateways,
    });

    // ── EKS Cluster ───────────────────────────────────────────────────────────
    this.cluster = new eks.Cluster(this, 'Cluster', {
      clusterName: props.clusterName,
      vpc: network.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV29Layer(this, 'KubectlLayer'),
      defaultCapacity: 2,
      defaultCapacityInstance: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM,
      ),
    });

    // ── Database ──────────────────────────────────────────────────────────────
    const database = new KeycloakDatabase(this, 'Database', {
      vpc: network.vpc,
      dbPassword: props.dbPassword,
      dbName: props.dbName,
      multiAz: props.rdsMultiAz,
    });

    // ── CloudFormation Outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'EKS cluster name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.endpointAddress,
      description: 'RDS PostgreSQL endpoint',
      exportName: `${this.stackName}-DbEndpoint`,
    });

    new cdk.CfnOutput(this, 'KeycloakUrl', {
      value: `https://${props.keycloakHostname}`,
      description: 'Keycloak base URL',
      exportName: `${this.stackName}-KeycloakUrl`,
    });
  }
}


