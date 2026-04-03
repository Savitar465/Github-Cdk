import { config as loadDotEnv } from 'dotenv';

// Load .env once at startup so every consumer of this module gets the same values.
loadDotEnv();

/**
 * CDK configuration loaded from environment variables.
 */
export interface EnvironmentConfig {
  /** AWS account ID – leave undefined for environment-agnostic deployment */
  readonly account?: string;
  /** AWS region – leave undefined for environment-agnostic deployment */
  readonly region?: string;

  /** EKS cluster name */
  readonly clusterName: string;
  /** VPC availability zones */
  readonly vpcMaxAzs: number;
  /** Number of NAT gateways */
  readonly vpcNatGateways: number;
  /** Node instance type for EKS managed node group (e.g. t3.small) */
  readonly eksNodeInstanceType: string;
  /** Desired worker node count */
  readonly eksNodeDesiredSize: number;
  /** Minimum worker node count */
  readonly eksNodeMinSize: number;
  /** Maximum worker node count */
  readonly eksNodeMaxSize: number;

  /** Public hostname exposed via the Keycloak Ingress */
  readonly keycloakHostname: string;
  /** Keycloak bootstrap admin username */
  readonly keycloakAdminUser: string;
  /** Keycloak bootstrap admin password ⚠️ use Secrets Manager in production */
  readonly keycloakAdminPassword: string;

  /** RDS master password for the `postgres` user ⚠️ use Secrets Manager in production */
  readonly dbPassword: string;
  /** PostgreSQL database name used by Keycloak */
  readonly dbName: string;
  /** Number of Keycloak StatefulSet replicas */
  readonly keycloakReplicas: number;
  /** Enable Multi-AZ standby for RDS */
  readonly rdsMultiAz: boolean;
  /** RDS instance class (e.g. db.t3.micro) */
  readonly rdsInstanceType: string;
  /** Allocated storage in GiB */
  readonly rdsAllocatedStorageGb: number;
  /** PostgreSQL engine version */
  readonly rdsEngineVersion: string;
}

/** App-level settings that are not consumed directly by stack props. */
export interface AppConfig extends EnvironmentConfig {
  /** CloudFormation stack name */
  readonly stackName: string;
}

function getOptionalString(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw || undefined;
}

function getRequiredString(name: string): string {
  const value = getOptionalString(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(name: string, defaultValue: number): number {
  const raw = getOptionalString(name);
  if (!raw) {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer. Received: ${raw}`);
  }

  return value;
}

function parseBoolean(name: string, defaultValue: boolean): boolean {
  const raw = getOptionalString(name);
  if (!raw) {
    return defaultValue;
  }

  switch (raw.toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
      return true;
    case 'false':
    case '0':
    case 'no':
      return false;
    default:
      throw new Error(`Environment variable ${name} must be one of: true, false, 1, 0, yes, no. Received: ${raw}`);
  }
}

/**
 * Returns the validated configuration read from `.env`/process env.
 */
export function getEnvironmentConfig(): AppConfig {
  return {
    stackName: getOptionalString('CDK_STACK_NAME') ?? 'KeycloakStack',
    account: getOptionalString('AWS_ACCOUNT_ID'),
    region: getOptionalString('AWS_REGION'),
    clusterName: getOptionalString('EKS_CLUSTER_NAME') ?? 'keycloak-cluster',
    vpcMaxAzs: parseNumber('VPC_MAX_AZS', 2),
    vpcNatGateways: parseNumber('VPC_NAT_GATEWAYS', 0),
    eksNodeInstanceType: getOptionalString('EKS_NODE_INSTANCE_TYPE') ?? 't3.small',
    eksNodeDesiredSize: parseNumber('EKS_NODE_DESIRED_SIZE', 1),
    eksNodeMinSize: parseNumber('EKS_NODE_MIN_SIZE', 1),
    eksNodeMaxSize: parseNumber('EKS_NODE_MAX_SIZE', 1),
    keycloakHostname: getRequiredString('KEYCLOAK_HOSTNAME'),
    keycloakAdminUser: getOptionalString('KEYCLOAK_ADMIN_USER') ?? 'admin',
    keycloakAdminPassword: getRequiredString('KEYCLOAK_ADMIN_PASSWORD'),
    dbPassword: getRequiredString('KEYCLOAK_DB_PASSWORD'),
    dbName: getOptionalString('KEYCLOAK_DB_NAME') ?? 'keycloak',
    keycloakReplicas: parseNumber('KEYCLOAK_REPLICAS', 1),
    rdsMultiAz: parseBoolean('RDS_MULTI_AZ', false),
    rdsInstanceType: getOptionalString('RDS_INSTANCE_TYPE') ?? 'db.t3.micro',
    rdsAllocatedStorageGb: parseNumber('RDS_ALLOCATED_STORAGE_GB', 20),
    rdsEngineVersion: getOptionalString('RDS_ENGINE_VERSION') ?? '16.4',
  };
}


