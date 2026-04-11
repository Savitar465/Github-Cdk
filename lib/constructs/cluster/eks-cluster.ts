import * as eks from 'aws-cdk-lib/aws-eks-v2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
// Import the kubectl layer for the EKS cluster
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';

export interface KubeClusterProps {
    readonly vpc: ec2.IVpc;
    readonly clusterName: string;
    readonly nodeInstanceType: string;
    readonly desiredSize: number;
    readonly minSize: number;
    readonly maxSize: number;
    readonly adminRoleArns: string[];
}

/**
 * Reusable EKS construct sized for small development environments.
 */
export class KubeCluster extends Construct {
    public readonly cluster: eks.Cluster;

    constructor(scope: Construct, id: string, props: KubeClusterProps) {
        super(scope, id);

        this.cluster = new eks.Cluster(this, "EksAutoCluster", {
            vpc: props.vpc,
            clusterName: props.clusterName,
            version: eks.KubernetesVersion.V1_35,
            defaultCapacityType: eks.DefaultCapacityType.AUTOMODE,
            kubectlProviderOptions: {
                kubectlLayer: new KubectlV35Layer(this, 'KubectlLayer'),
            },
        });

        // Grant cluster-admin access to explicitly configured IAM principals.
        props.adminRoleArns.forEach((principalArn, index) => {
            this.cluster.grantClusterAdmin(`AdminAccess${index + 1}`, principalArn);
        });

        // ── Install NGINX Ingress Controller ───────────────────────────────────
        // Only install if kubectl provider is available (not required for Auto Mode with managed add-ons)
        if (this.cluster.kubectlProvider) {
            this.cluster.addHelmChart('NginxIngress', {
                chart: 'ingress-nginx',
                repository: 'https://kubernetes.github.io/ingress-nginx',
                namespace: 'ingress-nginx',
                createNamespace: true,
                release: 'nginx-ingress',
                values: {
                    controller: {
                        service: {
                            type: 'LoadBalancer',
                            externalTrafficPolicy: 'Local',
                        },
                        resources: {
                            requests: {
                                cpu: '100m',
                                memory: '90Mi',
                            },
                            limits: {
                                cpu: '200m',
                                memory: '256Mi',
                            },
                        },
                        nodeSelector: {},
                        tolerations: [],
                    },
                },
            });
        }
    }
}

