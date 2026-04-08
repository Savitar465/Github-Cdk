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
      EKS_CLUSTER_NAME: 'keycloak-cluster',
      VPC_MAX_AZS: '2',
      VPC_NAT_GATEWAYS: '1',
      KEYCLOAK_HOSTNAME: 'keycloak-dev.savi.io',
      KEYCLOAK_EXPOSURE: 'ingress',
      KEYCLOAK_ADMIN_USER: 'admin',
      KEYCLOAK_ADMIN_PASSWORD: 'admin-dev',
      KEYCLOAK_DB_PASSWORD: 'Space465Dev',
      KEYCLOAK_DB_NAME: 'keycloak',
      KEYCLOAK_REPLICAS: '1',
      RDS_MULTI_AZ: 'false',
      RDS_ENGINE_VERSION: '16.4',
    };

    const app = new cdk.App();
    const config = getEnvironmentConfig();

    const stack = new KeycloakStack(app, 'TestKeycloakStack', {
      // Use a deterministic account/region so EKS constructs resolve properly
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

  it('creates public and private subnets across 2 AZs (4 subnets total)', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  // ── RDS ────────────────────────────────────────────────────────────────────
  it('creates an RDS PostgreSQL instance named keycloak', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBName:        'keycloak',
      Engine:        'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
    });
  });

  it('enables storage encryption on the RDS instance', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
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

  // ── EKS ────────────────────────────────────────────────────────────────────
  it('creates an EKS cluster named keycloak-cluster', () => {
    template.hasResourceProperties('Custom::AWSCDK-EKS-Cluster', {
      Config: Match.objectLike({ name: 'keycloak-cluster' }),
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
      Value: 'https://keycloak-dev.savi.io',
    });
  });
});

