import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { Construct } from 'constructs';

export interface EcsClusterProps {
    readonly vpc: ec2.IVpc;
    readonly clusterName: string;
    readonly instanceType: string;
    readonly desiredCapacity: number;
    readonly minCapacity: number;
    readonly maxCapacity: number;
    /** If true, launch EC2 instances in public subnets (gives instances public IPs). Useful when VPC has no NAT gateways. */
    readonly placeInstancesInPublicSubnets?: boolean;
}

/**
 * ECS cluster construct for container orchestration.
 * Uses EC2 launch type with auto-scaling.
 */
export class EcsCluster extends Construct {
    public readonly cluster: ecs.Cluster;
    public readonly autoScalingGroup: autoscaling.AutoScalingGroup;

    constructor(scope: Construct, id: string, props: EcsClusterProps) {
        super(scope, id);

        this.cluster = new ecs.Cluster(this, 'EcsCluster', {
            vpc: props.vpc,
            clusterName: props.clusterName,
            containerInsights: true,
        });

        // Add EC2 capacity to the cluster
        const asgOptions: any = {
            instanceType: ec2.InstanceType.of(
                ec2.InstanceClass.T3,
                ec2.InstanceSize.SMALL,
            ),
            minCapacity: props.minCapacity,
            desiredCapacity: props.desiredCapacity,
            maxCapacity: props.maxCapacity,
        };

        if (props.placeInstancesInPublicSubnets) {
            asgOptions.vpcSubnets = { subnetType: ec2.SubnetType.PUBLIC };
        }

        this.autoScalingGroup = this.cluster.addCapacity('Capacity', asgOptions);
    }
}

