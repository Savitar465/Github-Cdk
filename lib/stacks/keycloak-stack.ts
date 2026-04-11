import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import { GithubDatabase, GithubVpc, KeycloakManifests, KubeCluster } from '../constructs';

export interface KeycloakStackProps extends cdk.StackProps, EnvironmentConfig {}

/**
 * Top-level stack for the Keycloak deployment.
 *
 * This stack is intentionally thin – it only wires together the three
 * reusable constructs:
 *   - {@link GithubVpc} → VPC with public + private subnets
 *   - {@link GithubDatabase} → RDS PostgreSQL
 *   - {@link KeycloakManifests} → Kubernetes resources on EKS
 *
 * All configuration is driven by {@link EnvironmentConfig}, which keeps
 * environment-specific values out of the stack code.
 */
export class KeycloakStack extends cdk.Stack {
  /** Exposed for cross-stack use (e.g. deploying additional Helm charts). */
  public readonly cluster: eks.ICluster;

  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);

    // ── Network ───────────────────────────────────────────────────────────────
    const network = new GithubVpc(this, 'Network', {
      maxAzs: props.vpcMaxAzs,
      natGateways: props.vpcNatGateways,
    });

    // ── Database ──────────────────────────────────────────────────────────────
    const database = new GithubDatabase(this, 'Database', {
      vpc: network.vpc,
      dbPassword: props.dbPassword,
      dbName: props.dbName,
      multiAz: props.rdsMultiAz,
      instanceType: props.rdsInstanceType,
      allocatedStorageGb: props.rdsAllocatedStorageGb,
      engineVersion: props.rdsEngineVersion,
    });

    // ── EKS Cluster ───────────────────────────────────────────────────────────
    const kubeCluster = new KubeCluster(this, 'KubeCluster', {
      vpc: network.vpc,
      clusterName: props.clusterName,
      nodeInstanceType: props.eksNodeInstanceType,
      desiredSize: props.eksNodeDesiredSize,
      minSize: props.eksNodeMinSize,
      maxSize: props.eksNodeMaxSize,
      adminRoleArns: props.eksAdminRoleArns,
    });
    this.cluster = kubeCluster.cluster;

    // ── Keycloak on Kubernetes ────────────────────────────────────────────────
    new KeycloakManifests(this, 'KeycloakManifests', {
      cluster: this.cluster,
      keycloakHostname: props.keycloakHostname,
      exposure: props.keycloakExposure,
      keycloakAdminUser: props.keycloakAdminUser,
      keycloakAdminPassword: props.keycloakAdminPassword,
      cloudflareTunnelToken: props.cloudflareTunnelToken,
      mkcertTlsCertB64: props.mkcertTlsCertB64,
      mkcertTlsKeyB64: props.mkcertTlsKeyB64,
      dbHost: database.endpointAddress,
      dbName: props.dbName,
      dbPassword: props.dbPassword,
      replicas: props.keycloakReplicas,
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
