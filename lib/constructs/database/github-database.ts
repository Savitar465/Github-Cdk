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
  /** RDS instance class (e.g. db.t4g.micro) */
  readonly instanceType: string;
  /** Initial storage allocation in GiB */
  readonly allocatedStorageGb: number;
  /** PostgreSQL engine version (supported: 15.10, 16.4, 17.2) */
  readonly engineVersion: string;
  /**
   * Optional security group to allow ingress from (e.g., ECS tasks).
   * If not provided, allows ingress from any VPC CIDR.
   */
  readonly allowedSecurityGroup?: ec2.ISecurityGroup;
  /**
   * Whether the database should be reachable from the public internet.
   * Intended for local/dev deployments only.
   */
  readonly publiclyAccessible?: boolean;
}

function normalizeRdsInstanceType(instanceType: string): string {
  const trimmed = instanceType.trim();
  const bareInstanceType = trimmed.startsWith('db.') ? trimmed.slice(3) : trimmed;

  // Free-plan accounts reject `t3.micro`; use the newer eligible micro size instead.
  if (bareInstanceType === 't3.micro') {
    return 't4g.micro';
  }

  return bareInstanceType;
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
    const selectedInstanceType = normalizeRdsInstanceType(props.instanceType);

    const isPubliclyAccessible = props.publiclyAccessible ?? false;

    // Security group – allow traffic to reach postgres
    this.securityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'Allow applications to reach Keycloak PostgreSQL on 5432',
    });

    // Allow ingress from specific security group, the VPC CIDR, or the public internet.
    if (isPubliclyAccessible) {
      this.securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(5432),
        'Public to Postgres',
      );
    } else if (props.allowedSecurityGroup) {
      this.securityGroup.addIngressRule(
        ec2.Peer.securityGroupId(props.allowedSecurityGroup.securityGroupId),
        ec2.Port.tcp(5432),
        'Application to Postgres',
      );
    } else {
      this.securityGroup.addIngressRule(
        ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
        ec2.Port.tcp(5432),
        'VPC to Postgres',
      );
    }

    const instance = new rds.DatabaseInstance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: isPubliclyAccessible ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.securityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({ version: selectedEngineVersion }),
      credentials: rds.Credentials.fromPassword(
        'postgres',
        cdk.SecretValue.unsafePlainText(props.dbPassword),
      ),
      databaseName: props.dbName,
      instanceType: new ec2.InstanceType(selectedInstanceType),
      allocatedStorage: props.allocatedStorageGb,
      storageEncrypted: true,
      multiAz: props.multiAz ?? false,
      backupRetention: cdk.Duration.days(0),
      deletionProtection: false,
      publiclyAccessible: isPubliclyAccessible,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deleteAutomatedBackups: true,
    });

    this.endpointAddress = instance.instanceEndpoint.hostname;
  }
}

