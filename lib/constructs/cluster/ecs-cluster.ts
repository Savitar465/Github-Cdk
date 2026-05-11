import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface EcsClusterProps {
  readonly vpc: ec2.IVpc;
  readonly clusterName: string;
}

export class EcsCluster extends Construct {
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id);

    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: props.vpc,
      clusterName: props.clusterName,
      containerInsights: true,
    });
  }
}
