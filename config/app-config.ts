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
    vpcNatGateways: parseNumber('VPC_NAT_GATEWAYS', 1),
    keycloakHostname: getRequiredString('KEYCLOAK_HOSTNAME'),
    keycloakAdminUser: getRequiredString('KEYCLOAK_ADMIN_USER'),
    keycloakAdminPassword: getRequiredString('KEYCLOAK_ADMIN_PASSWORD'),
    dbPassword: getRequiredString('KEYCLOAK_DB_PASSWORD'),
    dbName: getOptionalString('KEYCLOAK_DB_NAME') ?? 'keycloak',
    keycloakReplicas: parseNumber('KEYCLOAK_REPLICAS', 1),
    rdsMultiAz: parseBoolean('RDS_MULTI_AZ', false),
  };
}


