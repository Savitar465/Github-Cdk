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

  // ── Git server ────────────────────────────────────────────────────────────
  /** URL the git-auth SSH hook calls to check repo permissions. */
  readonly gitServerMicroserviceUrl: string;
  /** Shared bearer token sent by the git-auth script. */
  readonly gitServerMicroserviceAuthToken: string;

  // ── Repository microservice ───────────────────────────────────────────────
  readonly repoMongoHost: string;
  readonly repoMongoPort: number;
  readonly repoMongoDatabase: string;
  readonly repoMongoUsername: string;
  readonly repoMongoPassword: string;
  readonly repoMongoAuthDatabase: string;
  readonly repoServerPort: number;
  readonly repoGitServerHttpUrl: string;
  readonly repoGitServerSshHost: string;
  readonly repoGitServerSshPort: number;
  readonly repoMicroserviceAuthToken: string;
  readonly repoJwtIssuerUri: string;
  readonly repoJwtJwkSetUri: string;
  readonly repoKeycloakHost: string;
  readonly repoKeycloakPort: string;
  readonly repoKeycloakRealm: string;

  // ── Organizations microservice ────────────────────────────────────────────
  readonly orgServerPort: number;
  readonly orgDbName: string;
  readonly orgDbPort: number;
  readonly orgDbUsername: string;
  readonly orgDbPassword: string;
  readonly orgSslCertPath: string;
  readonly orgJwtIssuerUri: string;
  readonly orgJwtJwkSetUri: string;

  // ── Issues microservice ───────────────────────────────────────────────────
  readonly issuesServerPort: number;
  readonly issuesGrpcPort: number;
  readonly issuesDbName: string;
  readonly issuesDbPort: number;
  readonly issuesDbUsername: string;
  readonly issuesDbPassword: string;
  readonly issuesSslCertPath: string;
  readonly issuesJwtIssuerUri: string;
  readonly issuesJwtJwkSetUri: string;

  // ── Frontend (Next.js) ────────────────────────────────────────────────────
  readonly frontFilesApiUrl: string;
  readonly frontUsersApiUrl: string;
  readonly frontRepositoryApiUrl: string;
  readonly frontPrApiUrl: string;
  readonly frontOrgApiUrl: string;
  readonly frontIssuesApiUrl: string;
  readonly frontUseKeycloak: boolean;
  readonly frontUseMockAuth: boolean;
  readonly frontGitHttpUrl: string;
  readonly frontGitSshHost: string;
  readonly frontGitSshPort: number;

  // ── Files microservice ────────────────────────────────────────────────────
  readonly filesServerPort: number;
  readonly filesDbName: string;
  readonly filesDbPort: number;
  readonly filesDbUsername: string;
  readonly filesDbPassword: string;
  readonly filesJwtIssuerUri: string;
  readonly filesOauth2Enabled: boolean;

  // ── Docker Hub authenticated pulls ───────────────────────────────────────
  /**
   * Name of an existing Secrets Manager secret containing Docker Hub credentials.
   * The secret must have `username` and `password` keys.
   * When omitted, images are pulled anonymously (subject to rate limits).
   */
  readonly dockerhubSecretName?: string;

  // ── Pull-request microservice ─────────────────────────────────────────────
  readonly prServerPort: number;
  readonly prSpringProfilesActive: string;
  readonly prDbName: string;
  readonly prDbPort: number;
  readonly prDbUsername: string;
  readonly prDbPassword: string;
  readonly prJwtIssuerUri: string;
  readonly prOauth2Enabled: boolean;
  readonly prRepositoryMsUrl: string;

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
    gitServerMicroserviceUrl: getOptionalString('SERVER_MICROSERVICE_URL') ?? 'http://repository-ms.github.local:8090',
    gitServerMicroserviceAuthToken: getRequiredString('SERVER_MICROSERVICE_AUTH_TOKEN'),
    repoMongoHost: getOptionalString('REPO_MONGO_HOST') ?? 'mongodb.github.local',
    repoMongoPort: parseNumber('REPO_MONGO_PORT', 27017),
    repoMongoDatabase: getOptionalString('REPO_MONGO_DATABASE') ?? 'github_repository_ms',
    repoMongoUsername: getRequiredString('REPO_MONGO_USERNAME'),
    repoMongoPassword: getRequiredString('REPO_MONGO_PASSWORD'),
    repoMongoAuthDatabase: getOptionalString('REPO_MONGO_AUTH_DATABASE') ?? 'admin',
    repoServerPort: parseNumber('REPO_SERVER_PORT', 8090),
    repoGitServerHttpUrl: getOptionalString('REPO_GIT_SERVER_HTTP_URL') ?? 'git-server.github.local:9080',
    repoGitServerSshHost: getOptionalString('REPO_GIT_SERVER_SSH_HOST') ?? 'git-server.github.local',
    repoGitServerSshPort: parseNumber('REPO_GIT_SERVER_SSH_PORT', 2222),
    repoMicroserviceAuthToken: getRequiredString('REPO_MICROSERVICE_AUTH_TOKEN'),
    repoJwtIssuerUri: getRequiredString('REPO_JWT_ISSUER_URI'),
    repoJwtJwkSetUri: getRequiredString('REPO_JWT_JWK_SET_URI'),
    repoKeycloakHost: getRequiredString('REPO_KEYCLOAK_HOST'),
    repoKeycloakPort: getOptionalString('REPO_KEYCLOAK_PORT') ?? '',
    repoKeycloakRealm: getRequiredString('REPO_KEYCLOAK_REALM'),
    orgServerPort: parseNumber('ORG_SERVER_PORT', 8085),
    orgDbName: getOptionalString('ORG_DB_NAME') ?? 'github_organizations',
    orgDbPort: parseNumber('ORG_DB_PORT', 5432),
    orgDbUsername: getOptionalString('ORG_DB_USERNAME') ?? 'postgres',
    orgDbPassword: getRequiredString('ORG_DB_PASSWORD'),
    orgSslCertPath: getOptionalString('ORG_SSL_CERT_PATH') ?? './global-bundle.pem',
    orgJwtIssuerUri: getRequiredString('ORG_JWT_ISSUER_URI'),
    orgJwtJwkSetUri: getRequiredString('ORG_JWT_JWK_SET_URI'),
    issuesServerPort: parseNumber('ISSUES_SERVER_PORT', 8091),
    issuesGrpcPort: parseNumber('ISSUES_GRPC_PORT', 9091),
    issuesDbName: getOptionalString('ISSUES_DB_NAME') ?? 'github_issues_db',
    issuesDbPort: parseNumber('ISSUES_DB_PORT', 5432),
    issuesDbUsername: getOptionalString('ISSUES_DB_USERNAME') ?? 'postgres',
    issuesDbPassword: getRequiredString('ISSUES_DB_PASSWORD'),
    issuesSslCertPath: getOptionalString('ISSUES_SSL_CERT_PATH') ?? './global-bundle.pem',
    issuesJwtIssuerUri: getRequiredString('ISSUES_JWT_ISSUER_URI'),
    issuesJwtJwkSetUri: getRequiredString('ISSUES_JWT_JWK_SET_URI'),
    frontFilesApiUrl: getOptionalString('NEXT_PUBLIC_FILES_API_URL') ?? 'http://files-ms.github.local:8083/api',
    frontUsersApiUrl: getOptionalString('NEXT_PUBLIC_USERS_API_URL') ?? 'http://users.github.local:8081',
    frontRepositoryApiUrl: getOptionalString('NEXT_PUBLIC_REPOSITORY_API_URL') ?? 'http://repository-ms.github.local:8090',
    frontPrApiUrl: getOptionalString('NEXT_PUBLIC_PR_API_URL') ?? 'http://pullrequest-ms.github.local:8084/api',
    frontOrgApiUrl: getOptionalString('NEXT_PUBLIC_ORG_API_URL') ?? 'http://organization-ms.github.local:8085',
    frontIssuesApiUrl: getOptionalString('NEXT_PUBLIC_ISSUES_API_URL') ?? 'http://issues-ms.github.local:8091',
    frontUseKeycloak: parseBoolean('NEXT_PUBLIC_USE_KEYCLOAK', false),
    frontUseMockAuth: parseBoolean('NEXT_PUBLIC_USE_MOCK_AUTH', false),
    frontGitHttpUrl: getOptionalString('NEXT_PUBLIC_GIT_HTTP_URL') ?? 'http://repository-ms.github.local:8090',
    frontGitSshHost: getOptionalString('NEXT_PUBLIC_GIT_SSH_HOST') ?? 'repository-ms.github.local',
    frontGitSshPort: parseNumber('NEXT_PUBLIC_GIT_SSH_PORT', 2222),
    filesServerPort: parseNumber('FILES_SERVER_PORT', 8083),
    filesDbName: getOptionalString('FILES_DB_NAME') ?? 'github_files',
    filesDbPort: parseNumber('FILES_DB_PORT', 5432),
    filesDbUsername: getOptionalString('FILES_DB_USERNAME') ?? 'postgres',
    filesDbPassword: getRequiredString('FILES_DB_PASSWORD'),
    filesJwtIssuerUri: getRequiredString('FILES_JWT_ISSUER_URI'),
    filesOauth2Enabled: parseBoolean('FILES_APP_SECURITY_OAUTH2_ENABLED', false),
    dockerhubSecretName: getOptionalString('DOCKERHUB_SECRET_NAME'),
    prServerPort: parseNumber('PR_SERVER_PORT', 8084),
    prSpringProfilesActive: getOptionalString('PR_SPRING_PROFILES_ACTIVE') ?? 'aws',
    prDbName: getOptionalString('PR_DB_NAME') ?? 'githubdb',
    prDbPort: parseNumber('PR_DB_PORT', 5432),
    prDbUsername: getOptionalString('PR_DB_USERNAME') ?? 'postgres',
    prDbPassword: getRequiredString('PR_DB_PASSWORD'),
    prJwtIssuerUri: getRequiredString('JWT_ISSUER_URI'),
    prOauth2Enabled: parseBoolean('APP_SECURITY_OAUTH2_ENABLED', true),
    prRepositoryMsUrl: getOptionalString('APP_SERVICES_REPOSITORY_MS_URL') ?? 'http://repository-ms.github.local:8090',
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
