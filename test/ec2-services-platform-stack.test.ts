import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

import { Ec2ServicesPlatformStack } from '../lib/stacks';

describe('Ec2ServicesPlatformStack', () => {
  const app = new cdk.App();
  const stack = new Ec2ServicesPlatformStack(app, 'Ec2ServicesPlatformStackTest', {
    env: { account: '123456789012', region: 'us-east-1' },
    allowedSshCidr: '10.0.0.0/24',
  });

  const template = Template.fromStack(stack);

  it('creates one VPC with public and private subnets across three AZs', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });

  it('creates one public NLB and one private ALB', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 2);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Type: 'network',
      Scheme: 'internet-facing',
    });

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Type: 'application',
      Scheme: 'internal',
    });
  });

  it('wires the NLB target group to the ALB', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'alb',
      Port: 80,
      Protocol: 'TCP',
      Targets: Match.arrayWith([
        Match.objectLike({
          Port: 80,
        }),
      ]),
    });
  });

  it('creates three free-tier sized Ubuntu EC2 instances', () => {
    template.resourceCountIs('AWS::EC2::Instance', 3);
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.micro',
    });
  });

  it('allows SSH and web-related ports in security groups', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 22,
          ToPort: 22,
          IpProtocol: 'tcp',
          CidrIp: '10.0.0.0/24',
        }),
      ]),
    });

    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
        }),
      ]),
    });
  });
});

