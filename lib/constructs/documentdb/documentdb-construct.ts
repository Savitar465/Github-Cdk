import * as cdk from 'aws-cdk-lib';
import * as docdb from 'aws-cdk-lib/aws-docdb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface DocumentDbProps {
  readonly vpc: ec2.IVpc;
  readonly masterPassword: string;
  readonly masterUsername?: string;
  readonly instanceType?: ec2.InstanceType;
  readonly instances?: number;
  readonly removalPolicy?: cdk.RemovalPolicy;
}

export class GithubDocumentDb extends Construct {
  public readonly cluster: docdb.DatabaseCluster;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly clusterEndpoint: docdb.Endpoint;

  constructor(scope: Construct, id: string, props: DocumentDbProps) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for DocumentDB cluster',
      allowAllOutbound: false,
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(27017),
      'Allow MongoDB protocol from VPC',
    );

    // TLS disabled for dev ease — remove parameterGroup and use a CA bundle in production.
    const parameterGroup = new docdb.ClusterParameterGroup(this, 'Params', {
      family: 'docdb5.0',
      description: 'Dev cluster params',
      parameters: { tls: 'disabled' },
    });

    this.cluster = new docdb.DatabaseCluster(this, 'Cluster', {
      engineVersion: '5.0.0',
      masterUser: {
        username: props.masterUsername ?? 'docdbadmin',
        password: cdk.SecretValue.unsafePlainText(props.masterPassword),
      },
      instanceType: props.instanceType ?? ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM,
      ),
      instances: props.instances ?? 1,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: this.securityGroup,
      parameterGroup,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      storageEncrypted: true,
    });

    this.clusterEndpoint = this.cluster.clusterEndpoint;
  }
}