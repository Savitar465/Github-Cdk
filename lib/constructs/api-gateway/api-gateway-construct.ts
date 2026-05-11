import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface ApiGatewayProps {
  readonly vpc: ec2.IVpc;
  /** Cloud Map service registered by the users ECS service. */
  readonly cloudMapService: servicediscovery.IService;
  /** Security group attached to the users Fargate tasks. */
  readonly usersTaskSecurityGroup: ec2.SecurityGroup;
  /** Container port the users service listens on. */
  readonly serverPort: number;
  /** When true the VPC Link ENIs are placed in public subnets (required when natGateways=0). */
  readonly placeVpcLinkInPublicSubnets?: boolean;
}

/**
 * HTTP API Gateway (v2) with a VPC Link that forwards requests to the users
 * microservice via AWS Cloud Map service discovery.
 *
 * Traffic path: Internet → HttpApi → VpcLink → Cloud Map (users.github.local) → ECS tasks
 */
export class GithubApiGateway extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    // ── VPC Link security group ───────────────────────────────────────────────
    const vpcLinkSg = new ec2.SecurityGroup(this, 'VpcLinkSg', {
      vpc: props.vpc,
      description: 'Security group for API Gateway VPC Link (users service)',
      allowAllOutbound: false,
    });

    vpcLinkSg.addEgressRule(
      props.usersTaskSecurityGroup,
      ec2.Port.tcp(props.serverPort),
      'VPC Link to users tasks',
    );

    props.usersTaskSecurityGroup.addIngressRule(
      vpcLinkSg,
      ec2.Port.tcp(props.serverPort),
      'Allow ingress from API Gateway VPC Link',
    );

    // ── VPC Link ──────────────────────────────────────────────────────────────
    const vpcLink = new apigwv2.VpcLink(this, 'VpcLink', {
      vpc: props.vpc,
      vpcLinkName: 'github-api-vpclink',
      securityGroups: [vpcLinkSg],
      subnets: props.placeVpcLinkInPublicSubnets
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ── HTTP API ──────────────────────────────────────────────────────────────
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'github-api',
      description: 'Public HTTP API routing to users microservice via Cloud Map',
    });

    // ── Cloud Map integration (L1) ────────────────────────────────────────────
    // integrationUri accepts a Cloud Map service ARN; API Gateway resolves
    // healthy instances via the SRV records that ECS writes on each task start.
    const integration = new apigwv2.CfnIntegration(this, 'CloudMapIntegration', {
      apiId: this.httpApi.apiId,
      integrationType: 'HTTP_PROXY',
      integrationUri: props.cloudMapService.serviceArn,
      integrationMethod: 'ANY',
      connectionType: 'VPC_LINK',
      connectionId: vpcLink.vpcLinkId,
      payloadFormatVersion: '1.0',
    });

    // ── Default catch-all route ───────────────────────────────────────────────
    new apigwv2.CfnRoute(this, 'DefaultRoute', {
      apiId: this.httpApi.apiId,
      routeKey: '$default',
      target: `integrations/${integration.ref}`,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      description: 'API Gateway HTTP endpoint URL',
      exportName: `${cdk.Stack.of(this).stackName}-ApiEndpoint`,
    });
  }
}