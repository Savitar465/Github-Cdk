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

  // ── MongoDB (self-managed on ECS) ─────────────────────────────────────────
  /** Root password for MongoDB ⚠️ use Secrets Manager in production */
  readonly mongodbPassword: string;
  /** Root username for MongoDB */
  readonly mongodbUsername: string;

  // ── Users microservice ────────────────────────────────────────────────────
  /** Database name for the users microservice (created inside the shared RDS instance) */
  readonly usersDbName: string;
  /** Port the Spring Boot users service listens on */
  readonly usersServerPort: number;
  /** Spring application name */
  readonly usersSpringAppName: string;
  /** Keycloak issuer URI for token validation */
  readonly keycloakIssuerUri: string;
  /** Keycloak JWK set URI for token validation */
  readonly keycloakJwkSetUri: string;
  /** Keycloak client ID for users-ms */
  readonly keycloakClientId: string;
  /** Keycloak client secret for users-ms */
  readonly keycloakClientSecret: string;
  /** OAuth2 grant type */
  readonly keycloakAuthGrantType: string;
  /** OAuth2 scope */
  readonly keycloakScope: string;
  /** Keycloak server URL (for admin operations) */
  readonly keycloakServerUrl: string;
  /** Keycloak realm name */
  readonly keycloakRealmName: string;
  /** Keycloak admin client ID */
  readonly keycloakAdminClient: string;
  /** Keycloak admin client secret */
  readonly keycloakAdminClientSecret: string;
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

function getMinLengthString(name: string, min: number): string {
  const value = getRequiredString(name);
  if (value.length < min) {
    throw new Error(`Environment variable ${name} must be at least ${min} characters long. Received ${value.length} character(s).`);
  }
  return value;
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
    keycloakHostname: getOptionalString('KEYCLOAK_HOSTNAME'),
    keycloakAdminUser: getOptionalString('KEYCLOAK_ADMIN_USER') ?? 'admin',
    keycloakAdminPassword: getRequiredString('KEYCLOAK_ADMIN_PASSWORD'),
    dbPassword: getRequiredString('DB_PASSWORD'),
    dbName: getOptionalString('KEYCLOAK_DB_NAME') ?? 'keycloak',
    keycloakReplicas: parseNumber('KEYCLOAK_REPLICAS', 1),
    rdsMultiAz: parseBoolean('RDS_MULTI_AZ', false),
    rdsInstanceType: getOptionalString('RDS_INSTANCE_TYPE') ?? 't4g.micro',
    rdsAllocatedStorageGb: parseNumber('RDS_ALLOCATED_STORAGE_GB', 20),
    rdsEngineVersion: getOptionalString('RDS_ENGINE_VERSION') ?? '16.4',
    rdsPubliclyAccessible: parseBoolean('RDS_PUBLICLY_ACCESSIBLE', true),
    mongodbPassword: getMinLengthString('MONGODB_PASSWORD', 8),
    mongodbUsername: getOptionalString('MONGODB_USERNAME') ?? 'mongoadmin',
    usersDbName: getOptionalString('USERS_DB_NAME') ?? 'ms-users',
    usersServerPort: parseNumber('SERVER_PORT', 8081),
    usersSpringAppName: getOptionalString('SPRING_APPLICATION_NAME') ?? 'users-ms',
    keycloakIssuerUri: getRequiredString('KEYCLOAK_ISSUER_URI'),
    keycloakJwkSetUri: getRequiredString('KEYCLOAK_JWK_SET_URI'),
    keycloakClientId: getRequiredString('KEYCLOAK_CLIENT_ID'),
    keycloakClientSecret: getRequiredString('KEYCLOAK_CLIENT_SECRET'),
    keycloakAuthGrantType: getOptionalString('KEYCLOAK_AUTH_GRANT_TYPE') ?? 'client_credentials',
    keycloakScope: getOptionalString('KEYCLOAK_SCOPE') ?? 'openid',
    keycloakServerUrl: getRequiredString('KEYCLOAK_SERVER_URL'),
    keycloakRealmName: getRequiredString('KEYCLOAK_REALM'),
    keycloakAdminClient: getRequiredString('KEYCLOAK_ADMIN_CLIENT'),
    keycloakAdminClientSecret: getRequiredString('KEYCLOAK_ADMIN_CLIENT_SECRET'),
  };
}
