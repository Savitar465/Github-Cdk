import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface KeycloakVpcProps {
  /** Maximum number of Availability Zones to use. @default 2 */
  maxAzs?: number;
  /** Number of NAT gateways to provision. @default 1 */
  natGateways?: number;
}

/**
 * Reusable VPC construct with public + private subnets sized for the
 * Keycloak workload (EKS nodes and RDS in private subnets).
 */
export class GithubVpc extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: KeycloakVpcProps = {}) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: props.maxAzs ?? 2,
      natGateways: props.natGateways ?? 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'PrivateIsolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
  }
}

