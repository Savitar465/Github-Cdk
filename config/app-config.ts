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

  /** ECS cluster name */
  readonly clusterName: string;
  /** VPC availability zones */
  readonly vpcMaxAzs: number;
  /** Number of NAT gateways */
  readonly vpcNatGateways: number;
  /** Instance type for ECS EC2 capacity (e.g. t3.small) */
  readonly ecsInstanceType: string;
  /** Desired ECS capacity */
  readonly ecsDesiredCapacity: number;
  /** Minimum ECS capacity */
  readonly ecsMinCapacity: number;
  /** Maximum ECS capacity */
  readonly ecsMaxCapacity: number;

  /**
   * Public hostname for Keycloak (no scheme/path/port).
   * When omitted, the ALB's auto-generated DNS name is used automatically.
   */
  readonly keycloakHostname?: string;
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
  /** RDS instance class (e.g. t4g.micro) */
  readonly rdsInstanceType: string;
  /** Allocated storage in GiB */
  readonly rdsAllocatedStorageGb: number;
  /** PostgreSQL engine version */
  readonly rdsEngineVersion: string;
  /** Whether the RDS instance should be publicly reachable */
  readonly rdsPubliclyAccessible: boolean;
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

function getHostnameOnly(name: string): string {
  const value = getRequiredString(name);
  if (value.includes('://') || value.includes('/') || value.includes(':')) {
    throw new Error(`Environment variable ${name} must be a hostname only (no scheme, path, or port). Received: ${value}`);
  }
  return value;
}

/**
 * Returns the validated configuration read from `.env`/process env.
 */
export function getEnvironmentConfig(): AppConfig {
  return {
    stackName: getOptionalString('CDK_STACK_NAME') ?? 'KeycloakStack',
    account: getOptionalString('AWS_ACCOUNT_ID'),
    region: getOptionalString('AWS_REGION'),
    clusterName: getOptionalString('ECS_CLUSTER_NAME') ?? 'github-ecs',
    vpcMaxAzs: parseNumber('VPC_MAX_AZS', 2),
    vpcNatGateways: parseNumber('VPC_NAT_GATEWAYS', 1),
    ecsInstanceType: getOptionalString('ECS_INSTANCE_TYPE') ?? 't3.small',
    ecsDesiredCapacity: parseNumber('ECS_DESIRED_CAPACITY', 1),
    ecsMinCapacity: parseNumber('ECS_MIN_CAPACITY', 1),
    ecsMaxCapacity: parseNumber('ECS_MAX_CAPACITY', 1),
    keycloakHostname: getOptionalString('KEYCLOAK_HOSTNAME'),
    keycloakAdminUser: getOptionalString('KEYCLOAK_ADMIN_USER') ?? 'admin',
    keycloakAdminPassword: getRequiredString('KEYCLOAK_ADMIN_PASSWORD'),
    dbPassword: getRequiredString('DB_PASSWORD'),
    dbName: getOptionalString('DB_NAME') ?? 'keycloak',
    keycloakReplicas: parseNumber('KEYCLOAK_REPLICAS', 1),
    rdsMultiAz: parseBoolean('RDS_MULTI_AZ', false),
    rdsInstanceType: getOptionalString('RDS_INSTANCE_TYPE') ?? 't4g.micro',
    rdsAllocatedStorageGb: parseNumber('RDS_ALLOCATED_STORAGE_GB', 20),
    rdsEngineVersion: getOptionalString('RDS_ENGINE_VERSION') ?? '16.4',
    rdsPubliclyAccessible: parseBoolean('RDS_PUBLICLY_ACCESSIBLE', false),
  };
}
