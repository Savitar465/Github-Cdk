import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { KubectlV29Layer } from '@aws-cdk/lambda-layer-kubectl-v29';
import { Construct } from 'constructs';

export interface KubeClusterProps {
  readonly vpc: ec2.IVpc;
  readonly clusterName: string;
  readonly nodeInstanceType: string;
  readonly desiredSize: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/**
 * Reusable EKS construct sized for small development environments.
 */
export class KubeCluster extends Construct {
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: KubeClusterProps) {
    super(scope, id);

    this.cluster = new eks.Cluster(this, 'Cluster', {
      clusterName: props.clusterName,
      vpc: props.vpc,
      version: eks.KubernetesVersion.V1_35,
      kubectlLayer: new KubectlV29Layer(this, 'KubectlLayer'),
      defaultCapacity: 0,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PUBLIC }],
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
    });

    this.cluster.addNodegroupCapacity('DefaultNodeGroup', {
      desiredSize: props.desiredSize,
      minSize: props.minSize,
      maxSize: props.maxSize,
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceTypes: [new ec2.InstanceType(props.nodeInstanceType)],
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD, // <- cambio clave
      diskSize: 20,
    });
  }
}

