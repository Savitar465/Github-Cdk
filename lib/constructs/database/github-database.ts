import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface GitHubDatabaseProps {
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
  /** RDS instance class (e.g. db.t3.micro) */
  readonly instanceType: string;
  /** Initial storage allocation in GiB */
  readonly allocatedStorageGb: number;
  /** PostgreSQL engine version (supported: 15.10, 16.4, 17.2) */
  readonly engineVersion: string;
}

/**
 * L3 construct that provisions an RDS PostgreSQL instance
 * and its associated security group for the Keycloak database.
 *
 * The security group allows inbound TCP 5432 from anywhere inside the VPC.
 */
export class GithubDatabase extends Construct {
  /** CloudFormation token with the RDS endpoint address */
  public readonly endpointAddress: string;
  /** Security group attached to the RDS instance */
  public readonly securityGroup: ec2.SecurityGroup;


  constructor(scope: Construct, id: string, props: GitHubDatabaseProps) {
    super(scope, id);

    const engineVersionMap: Record<string, rds.PostgresEngineVersion> = {
      '15.10': rds.PostgresEngineVersion.VER_15_10,
      '16.4': rds.PostgresEngineVersion.VER_16_4,
      '17.2': rds.PostgresEngineVersion.VER_17_2,
    };
    const selectedEngineVersion = engineVersionMap[props.engineVersion] ?? rds.PostgresEngineVersion.VER_16_4;

    // Security group – allow EKS nodes (and any VPC traffic) to reach postgres
    this.securityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'Allow EKS nodes to reach Keycloak PostgreSQL on 5432',
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'EKS to Postgres',
    );

    const instance = new rds.DatabaseInstance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({ version: selectedEngineVersion }),
      credentials: rds.Credentials.fromPassword(
        'postgres',
        cdk.SecretValue.unsafePlainText(props.dbPassword),
      ),
      databaseName: props.dbName,
      instanceType: new ec2.InstanceType(props.instanceType),
      allocatedStorage: props.allocatedStorageGb,
      storageEncrypted: true,
      multiAz: props.multiAz ?? false,
      backupRetention: cdk.Duration.days(0),
      deletionProtection: false,
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deleteAutomatedBackups: true,
    });

    this.endpointAddress = instance.instanceEndpoint.hostname;
  }
}

