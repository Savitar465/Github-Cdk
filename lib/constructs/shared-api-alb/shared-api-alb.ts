import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface ApiServiceEntry {
  /** Short name used for resource IDs (e.g. 'users', 'pullrequest'). */
  readonly name: string;
  readonly service: ecs.FargateService;
  readonly port: number;
  readonly taskSecurityGroup: ec2.SecurityGroup;
  /** Health check path. @default '/actuator/health' */
  readonly healthCheckPath?: string;
}

export interface SharedApiAlbProps {
  readonly vpc: ec2.IVpc;
  readonly services: ApiServiceEntry[];
  /** When true ALB is placed in public subnets. @default true */
  readonly placeInPublicSubnets?: boolean;
}

/**
 * Single internet-facing ALB that exposes multiple microservices,
 * one listener per service port.
 *
 * Traffic path:  Browser → ALB:<port> → Fargate tasks:<port>
 *
 * Frontend env vars use the ALB DNS with the service port:
 *   NEXT_PUBLIC_USERS_API_URL=http://<alb-dns>:8081
 *   NEXT_PUBLIC_PR_API_URL=http://<alb-dns>:8084/api
 *   etc.
 */
export class SharedApiAlb extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: SharedApiAlbProps) {
    super(scope, id);

    const { vpc, services, placeInPublicSubnets = true } = props;

    // ── ALB security group ────────────────────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'Security group for shared API ALB',
      allowAllOutbound: false,
    });

    // ── ALB ───────────────────────────────────────────────────────────────────
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: placeInPublicSubnets
        ? { subnetType: ec2.SubnetType.PUBLIC }
        : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ── One listener + target group per service ───────────────────────────────
    for (const svc of services) {
      // Internet → ALB on this port
      albSg.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(svc.port),
        `Inbound ${svc.name}`,
      );

      // ALB → task on this port
      albSg.addEgressRule(
        svc.taskSecurityGroup,
        ec2.Port.tcp(svc.port),
        `ALB to ${svc.name}`,
      );

      svc.taskSecurityGroup.addIngressRule(
        albSg,
        ec2.Port.tcp(svc.port),
        `Allow from shared ALB`,
      );

      const targetGroup = new elbv2.ApplicationTargetGroup(this, `${svc.name}Tg`, {
        vpc,
        port: svc.port,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [svc.service],
        healthCheck: {
          path: svc.healthCheckPath ?? '/actuator/health',
          healthyHttpCodes: '200-399',
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      });

      this.loadBalancer.addListener(`${svc.name}Listener`, {
        port: svc.port,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultTargetGroups: [targetGroup],
      });
    }
  }
}
