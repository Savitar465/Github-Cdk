import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as triggers from 'aws-cdk-lib/triggers';
import * as path from 'path';
import { Construct } from 'constructs';

export interface GitHubDatabaseProps {
  /** VPC in which to place the RDS instance */
  readonly vpc: ec2.IVpc;
  /**
   * RDS master password for the `postgres` user.
   * ⚠️ Use `cdk.SecretValue.secretsManager(...)` in production.
   */
  readonly dbPassword: string;
  /** Name of the primary PostgreSQL database (created by the RDS instance) */
  readonly dbName: string;
  /**
   * Additional database names to create inside the same RDS instance.
   * Created by a Lambda trigger that runs once at deploy time.
   */
  readonly additionalDatabases?: string[];
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
  /**
   * The CDK Trigger that creates additional databases.
   * ECS services should declare a dependency on this so CloudFormation
   * waits for the databases to exist before starting any containers.
   */
  public readonly dbInitTrigger?: triggers.Trigger;


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

    // ── Create additional databases via a Lambda trigger ──────────────────────
    // RDS only creates the primary database at instance launch. Any extra
    // databases (e.g. one per microservice) are provisioned here at deploy time.
    const additionalDatabases = props.additionalDatabases ?? [];
    if (additionalDatabases.length > 0) {
      const allDatabases = [props.dbName, ...additionalDatabases];

      // Security group allowing the trigger Lambda to reach the RDS instance.
      // Only needed when the instance is not publicly accessible.
      const triggerSg = !isPubliclyAccessible
        ? new ec2.SecurityGroup(this, 'DbInitLambdaSg', {
            vpc: props.vpc,
            description: 'Security group for DB init Lambda trigger',
          })
        : undefined;

      if (triggerSg) {
        this.securityGroup.addIngressRule(
          triggerSg,
          ec2.Port.tcp(5432),
          'Allow DB init Lambda to connect',
        );
      }

      const dbInitFn = new lambdaNodejs.NodejsFunction(this, 'DbInitFn', {
        entry: path.join(__dirname, '../../lambda/db-init.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        // When publicly accessible the Lambda reaches the RDS via its public
        // endpoint — no VPC placement needed. Otherwise put it inside the VPC.
        ...(triggerSg && {
          vpc: props.vpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          securityGroups: [triggerSg],
        }),
        environment: {
          DB_HOST: this.endpointAddress,
          DB_PASSWORD: props.dbPassword,
          DB_NAMES: allDatabases.join(','),
        },
        bundling: {
          nodeModules: ['pg'],
        },
        // 10 retries × 15 s delay + connection/query overhead
        timeout: cdk.Duration.minutes(5),
      });

      this.dbInitTrigger = new triggers.Trigger(this, 'DbInitTrigger', {
        handler: dbInitFn,
        executeAfter: [instance],
        invocationType: triggers.InvocationType.REQUEST_RESPONSE,
      });
    }
  }
}

