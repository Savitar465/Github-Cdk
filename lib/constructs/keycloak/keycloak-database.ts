import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface KeycloakDatabaseProps {
  /** VPC in which to place the RDS instance */
  readonly vpc: ec2.IVpc;
  /**
   * RDS master password for the `postgres` user.
   * ⚠️ Use `cdk.SecretValue.secretsManager(...)` in production.
   */
  readonly dbPassword: string;
  /** Name of the PostgreSQL database */
  readonly dbName: string;
  /**
   * Enable Multi-AZ standby replica.
   * @default false
   */
  readonly multiAz?: boolean;
}

/**
 * L3 construct that provisions an RDS PostgreSQL instance
 * and its associated security group for the Keycloak database.
 *
 * The security group allows inbound TCP 5432 from anywhere inside the VPC.
 */
export class KeycloakDatabase extends Construct {
  /** CloudFormation token with the RDS endpoint address */
  public readonly endpointAddress: string;
  /** Security group attached to the RDS instance */
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: KeycloakDatabaseProps) {
    super(scope, id);

    // Security group – allow EKS nodes (and any VPC traffic) to reach postgres
    this.securityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'Allow EKS nodes to reach Keycloak PostgreSQL on 5432',
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'EKS → Postgres',
    );

    const privateSubnetIds = props.vpc.privateSubnets.map((subnet) => subnet.subnetId);

    const dbSubnetGroup = new cdk.CfnResource(this, 'SubnetGroup', {
      type: 'AWS::RDS::DBSubnetGroup',
      properties: {
        DBSubnetGroupDescription: 'Subnet group for Keycloak PostgreSQL',
        SubnetIds: privateSubnetIds,
      },
    });

    const dbInstance = new cdk.CfnResource(this, 'Instance', {
      type: 'AWS::RDS::DBInstance',
      properties: {
        DBName: props.dbName,
        DBInstanceClass: 'db.t3.small',
        AllocatedStorage: '20',
        Engine: 'postgres',
        EngineVersion: '15.8',
        MasterUsername: 'postgres',
        MasterUserPassword: props.dbPassword,
        DBSubnetGroupName: dbSubnetGroup.getAtt('DBSubnetGroupName'),
        VPCSecurityGroups: [this.securityGroup.securityGroupId],
        MultiAZ: props.multiAz ?? false,
        StorageEncrypted: true,
        PubliclyAccessible: false,
        DeletionProtection: false,
      },
    });
    dbInstance.node.addDependency(dbSubnetGroup);
    dbInstance.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.endpointAddress = dbInstance.getAtt('Endpoint.Address').toString();
  }
}

