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

  private static resolvePostgresVersion(version: string): rds.PostgresEngineVersion {
    switch (version) {
      case '15.10':
        return rds.PostgresEngineVersion.VER_15_10;
      case '17.2':
        return rds.PostgresEngineVersion.VER_17_2;
      case '16.4':
      default:
        return rds.PostgresEngineVersion.VER_16_4;
    }
  }

  constructor(scope: Construct, id: string, props: GitHubDatabaseProps) {
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

    const instance = new rds.DatabaseInstance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: GithubDatabase.resolvePostgresVersion(props.engineVersion),
      }),
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

