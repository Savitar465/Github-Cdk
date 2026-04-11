import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import { Construct } from 'constructs';

export interface Ec2ServicesPlatformStackProps extends cdk.StackProps {
  /** CIDR allowed to SSH into the EC2 instances. */
  readonly allowedSshCidr?: string;
  /** Optional EC2 key pair name for SSH access. */
  readonly keyName?: string;
}

export class Ec2ServicesPlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Ec2ServicesPlatformStackProps = {}) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'ServicesVpc', {
      maxAzs: 3,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const allowedSshCidr = props.allowedSshCidr ?? '0.0.0.0/0';

    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Allows web traffic from the NLB to the private ALB',
      allowAllOutbound: true,
    });

    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2ServicesSecurityGroup', {
      vpc,
      description: 'Allows SSH remote access and web traffic from ALB to service instances',
      allowAllOutbound: true,
    });

    // In this NLB -> ALB topology, ALB ingress may carry client source IPs.
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP to private ALB');
    ec2SecurityGroup.addIngressRule(ec2.Peer.ipv4(allowedSshCidr), ec2.Port.tcp(22), 'Allow remote SSH');
    ec2SecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow public web access');
    ec2SecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow HTTP from ALB to instances');

    const ubuntuAmi = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
      { os: ec2.OperatingSystemType.LINUX },
    );

    const keycloakInstance = this.createServiceInstance({
      vpc,
      id: 'KeycloakInstance',
      instanceName: 'keycloak-ec2',
      availabilityZone: vpc.availabilityZones[0],
      machineImage: ubuntuAmi,
      securityGroup: ec2SecurityGroup,
      keyName: props.keyName,
      userDataLines: [
        'apt-get update -y',
        'apt-get install -y docker.io',
        'systemctl enable docker',
        'systemctl start docker',
        'docker run -d --restart unless-stopped --name keycloak -p 80:8080 quay.io/keycloak/keycloak:latest start-dev',
      ],
    });

    const sonarqubeInstance = this.createServiceInstance({
      vpc,
      id: 'SonarQubeInstance',
      instanceName: 'sonarqube-ec2',
      availabilityZone: vpc.availabilityZones[1],
      machineImage: ubuntuAmi,
      securityGroup: ec2SecurityGroup,
      keyName: props.keyName,
      userDataLines: [
        'apt-get update -y',
        'apt-get install -y docker.io',
        'systemctl enable docker',
        'systemctl start docker',
        'docker run -d --restart unless-stopped --name sonarqube -p 80:9000 sonarqube:lts-community',
      ],
    });

    const rabbitMqInstance = this.createServiceInstance({
      vpc,
      id: 'RabbitMqInstance',
      instanceName: 'rabbitmq-ec2',
      availabilityZone: vpc.availabilityZones[2],
      machineImage: ubuntuAmi,
      securityGroup: ec2SecurityGroup,
      keyName: props.keyName,
      userDataLines: [
        'apt-get update -y',
        'apt-get install -y docker.io',
        'systemctl enable docker',
        'systemctl start docker',
        'docker run -d --restart unless-stopped --name rabbitmq -p 5672:5672 -p 80:15672 rabbitmq:3-management',
      ],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'PrivateAlb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: albSecurityGroup,
    });

    const albListener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'Platform ALB is up',
      }),
    });

    const keycloakTargetGroup = new elbv2.ApplicationTargetGroup(this, 'KeycloakTargetGroup', {
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-499',
      },
      targets: [new targets.InstanceTarget(keycloakInstance, 80)],
    });

    const sonarqubeTargetGroup = new elbv2.ApplicationTargetGroup(this, 'SonarqubeTargetGroup', {
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-499',
      },
      targets: [new targets.InstanceTarget(sonarqubeInstance, 80)],
    });

    const rabbitMqTargetGroup = new elbv2.ApplicationTargetGroup(this, 'RabbitMqTargetGroup', {
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-499',
      },
      targets: [new targets.InstanceTarget(rabbitMqInstance, 80)],
    });

    albListener.addTargetGroups('KeycloakPathRule', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/keycloak*'])],
      targetGroups: [keycloakTargetGroup],
    });

    albListener.addTargetGroups('SonarqubePathRule', {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/sonarqube*'])],
      targetGroups: [sonarqubeTargetGroup],
    });

    albListener.addTargetGroups('RabbitMqPathRule', {
      priority: 30,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/rabbitmq*'])],
      targetGroups: [rabbitMqTargetGroup],
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, 'PublicNlb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      crossZoneEnabled: true,
    });

    nlb.addListener('PublicHttpListener', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [
        new elbv2.NetworkTargetGroup(this, 'NlbToAlbTargetGroup', {
          vpc,
          port: 80,
          protocol: elbv2.Protocol.TCP,
          targetType: elbv2.TargetType.ALB,
          targets: [new targets.AlbListenerTarget(albListener)],
          healthCheck: {
            path: '/',
            protocol: elbv2.Protocol.HTTP,
          },
        }),
      ],
    });

    new cdk.CfnOutput(this, 'PublicNlbDns', {
      value: nlb.loadBalancerDnsName,
      description: 'Public DNS name for the Network Load Balancer',
    });

    new cdk.CfnOutput(this, 'PrivateAlbDns', {
      value: alb.loadBalancerDnsName,
      description: 'Private DNS name for the internal Application Load Balancer',
    });

    new cdk.CfnOutput(this, 'SshAllowedCidr', {
      value: allowedSshCidr,
      description: 'CIDR allowed to SSH to service instances',
    });
  }

  private createServiceInstance(params: {
    vpc: ec2.IVpc;
    id: string;
    instanceName: string;
    availabilityZone: string;
    machineImage: ec2.IMachineImage;
    securityGroup: ec2.ISecurityGroup;
    keyName?: string;
    userDataLines: string[];
  }): ec2.Instance {
    const subnet = params.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      availabilityZones: [params.availabilityZone],
    }).subnets[0];

    const keyPair = params.keyName
      ? ec2.KeyPair.fromKeyPairName(this, `${params.id}KeyPair`, params.keyName)
      : undefined;

    const instance = new ec2.Instance(this, params.id, {
      vpc: params.vpc,
      vpcSubnets: { subnets: [subnet] },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: params.machineImage,
      securityGroup: params.securityGroup,
      keyPair,
    });

    cdk.Tags.of(instance).add('Name', params.instanceName);
    instance.userData.addCommands(...params.userDataLines);

    return instance;
  }
}




