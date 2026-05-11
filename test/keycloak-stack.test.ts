import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { KeycloakStack } from '../lib/stacks';
import { getEnvironmentConfig } from '../config/app-config';

describe('KeycloakStack – dev environment', () => {
  let template: Template;
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      AWS_ACCOUNT_ID: '123456789012',
      AWS_REGION: 'us-east-1',
      CDK_STACK_NAME: 'TestKeycloakStack',
      ECS_CLUSTER_NAME: 'keycloak-cluster',
      VPC_MAX_AZS: '2',
      VPC_NAT_GATEWAYS: '1',
      ECS_INSTANCE_TYPE: 't3.small',
      ECS_DESIRED_CAPACITY: '1',
      ECS_MIN_CAPACITY: '1',
      ECS_MAX_CAPACITY: '1',
      KEYCLOAK_HOSTNAME: 'keycloak-dev.savi.io',
      KEYCLOAK_ADMIN_USER: 'admin',
      KEYCLOAK_ADMIN_PASSWORD: 'admin-dev',
      DB_PASSWORD: 'Space465Dev',
      KEYCLOAK_DB_NAME: 'keycloak',
      KEYCLOAK_REPLICAS: '1',
      RDS_PUBLICLY_ACCESSIBLE: 'true',
      RDS_MULTI_AZ: 'false',
      RDS_ENGINE_VERSION: '16.4',
    };

    const app = new cdk.App();
    const config = getEnvironmentConfig();

    const stack = new KeycloakStack(app, 'TestKeycloakStack', {
      // Use a deterministic account/region so ECS constructs resolve properly
      env: { account: '123456789012', region: 'us-east-1' },
      ...config,
    });

    template = Template.fromStack(stack);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── VPC ────────────────────────────────────────────────────────────────────
  it('creates exactly one VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('creates public and private subnets across 2 AZs (4 subnets minimum)', () => {
    // ECS clusters may create additional subnets for load balancing, so we at least check for 4
    const subnetCount = Object.keys(template.toJSON().Resources).filter(
      (key) => template.toJSON().Resources[key].Type === 'AWS::EC2::Subnet'
    ).length;
    expect(subnetCount).toBeGreaterThanOrEqual(4);
  });

  // ── RDS ────────────────────────────────────────────────────────────────────
  it('creates an RDS PostgreSQL instance named keycloak', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBName:        'keycloak',
      Engine:        'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      DBInstanceClass: 'db.t4g.micro',
    });
  });

  it('enables storage encryption on the RDS instance', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
    });
  });

  it('makes the RDS instance publicly accessible for development', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      PubliclyAccessible: true,
    });
  });

  it('creates an RDS subnet group', () => {
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
  });

  // ── Security Group ─────────────────────────────────────────────────────────
  it('creates a security group with a Postgres ingress rule', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ FromPort: 5432, ToPort: 5432, IpProtocol: 'tcp' }),
      ]),
    });
  });

  // ── ECS ────────────────────────────────────────────────────────────────────
  it('creates an ECS cluster named keycloak-cluster', () => {
    template.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'keycloak-cluster',
    });
  });

  it('creates a CloudWatch log group for Keycloak', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/keycloak',
    });
  });

  // ── CloudFormation Outputs ─────────────────────────────────────────────────
  it('exports the ClusterName output', () => {
    template.hasOutput('ClusterName', {});
  });

  it('exports the DbEndpoint output', () => {
    template.hasOutput('DbEndpoint', {});
  });

  it('exports the KeycloakUrl output', () => {
    template.hasOutput('KeycloakUrl', {
      Value: 'http://keycloak-dev.savi.io',
    });
  });
});

describe('Environment config validation', () => {
  it('rejects Keycloak hostnames with a port or scheme', () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      KEYCLOAK_HOSTNAME: 'http://localhost:8080',
      KEYCLOAK_ADMIN_PASSWORD: 'admin-dev',
      DB_PASSWORD: 'Space465Dev',
    };

    expect(() => getEnvironmentConfig()).toThrow(/hostname only/i);

    process.env = originalEnv;
  });
});

