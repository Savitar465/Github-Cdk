import * as eks from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';

export interface KeycloakManifestsProps {
  /** The EKS cluster to deploy manifests into */
  readonly cluster: eks.ICluster;
  /** Public hostname used in the Ingress rule and TLS certificate */
  readonly keycloakHostname: string;
  /** Keycloak bootstrap admin username */
  readonly keycloakAdminUser: string;
  /** Keycloak bootstrap admin password */
  readonly keycloakAdminPassword: string;
  /** RDS endpoint address (CloudFormation token is accepted) */
  readonly dbHost: string;
  /** Database name used by Keycloak */
  readonly dbName: string;
  /** Database password injected into the Kubernetes Secret */
  readonly dbPassword: string;
  /**
   * Number of StatefulSet replicas.
   * @default 1
   */
  readonly replicas?: number;
}

/**
 * L3 construct that creates all Kubernetes resources needed to run Keycloak:
 *
 *  1. Secret          – `keycloak-db-secret` (username / password)
 *  2. Service         – ClusterIP on port 8080
 *  3. Service         – Headless discovery service for ISPN clustering
 *  4. StatefulSet     – `quay.io/keycloak/keycloak:26.3.3`
 *
 * Note: Ingress is NOT created here. Instead, use Cloudflare Tunnel or ALB.
 *
 * Deployment ordering is enforced via CDK construct dependencies.
 */
export class KeycloakManifests extends Construct {
  constructor(scope: Construct, id: string, props: KeycloakManifestsProps) {
    super(scope, id);

    const {
      cluster,
      keycloakHostname,
      keycloakAdminUser,
      keycloakAdminPassword,
      dbHost,
      dbName,
      dbPassword,
      replicas = 1,
    } = props;

    // ── 1. Secret ─────────────────────────────────────────────────────────────
    const dbSecret = new eks.KubernetesManifest(this, 'DbSecret', {
      cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: 'keycloak-db-secret', labels: { app: 'keycloak' } },
          stringData: { username: 'postgres', password: dbPassword },
        },
      ],
    });

    // ── 2. ClusterIP Service ──────────────────────────────────────────────────
    const svc = new eks.KubernetesManifest(this, 'Service', {
      cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'keycloak', labels: { app: 'keycloak' } },
          spec: {
            type: 'ClusterIP',
            selector: { app: 'keycloak' },
            ports: [{ name: 'http', protocol: 'TCP', port: 8080, targetPort: 'http' }],
          },
        },
      ],
    });

    // ── 3. Headless discovery Service ─────────────────────────────────────────
    const discoverySvc = new eks.KubernetesManifest(this, 'DiscoveryService', {
      cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'keycloak-discovery', labels: { app: 'keycloak' } },
          spec: {
            type: 'ClusterIP',
            clusterIP: 'None',
            selector: { app: 'keycloak' },
          },
        },
      ],
    });

    // ── 4. StatefulSet ────────────────────────────────────────────────────────
    const sts = new eks.KubernetesManifest(this, 'StatefulSet', {
      cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'StatefulSet',
          metadata: { name: 'keycloak', labels: { app: 'keycloak' } },
          spec: {
            serviceName: 'keycloak-discovery',
            replicas,
            selector: { matchLabels: { app: 'keycloak' } },
            template: {
              metadata: { labels: { app: 'keycloak' } },
              spec: {
                containers: [
                  {
                    name: 'keycloak',
                    image: 'quay.io/keycloak/keycloak:26.3.3',
                    args: ['start'],
                    env: [
                      { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', value: keycloakAdminUser },
                      { name: 'KC_BOOTSTRAP_ADMIN_PASSWORD', value: keycloakAdminPassword },
                      // Proxy / networking
                      { name: 'KC_PROXY_HEADERS',  value: 'xforwarded' },
                      { name: 'KC_HTTP_ENABLED',   value: 'true' },
                      { name: 'KC_HOSTNAME_STRICT', value: 'false' },
                      { name: 'KC_HEALTH_ENABLED',  value: 'true' },
                      // Infinispan cache (required for multi-replica clustering)
                      { name: 'KC_CACHE', value: 'ispn' },
                      // Bind JGroups to the Pod's own IP
                      {
                        name: 'POD_IP',
                        valueFrom: { fieldRef: { fieldPath: 'status.podIP' } },
                      },
                      {
                        name: 'JAVA_OPTS_APPEND',
                        value: '-Djgroups.bind.address=$(POD_IP)',
                      },
                      // Database (dbHost is a CloudFormation token resolved at deploy time)
                      { name: 'KC_DB',              value: 'postgres' },
                      { name: 'KC_DB_URL_DATABASE', value: dbName },
                      { name: 'KC_DB_URL_HOST',     value: dbHost },
                      {
                        name: 'KC_DB_USERNAME',
                        valueFrom: {
                          secretKeyRef: { name: 'keycloak-db-secret', key: 'username' },
                        },
                      },
                      {
                        name: 'KC_DB_PASSWORD',
                        valueFrom: {
                          secretKeyRef: { name: 'keycloak-db-secret', key: 'password' },
                        },
                      },
                    ],
                    ports: [{ name: 'http', containerPort: 8080 }],
                    startupProbe: {
                      httpGet: { path: '/health/started', port: 9000 },
                      periodSeconds: 1,
                      failureThreshold: 600,
                    },
                    readinessProbe: {
                      httpGet: { path: '/health/ready', port: 9000 },
                      periodSeconds: 10,
                      failureThreshold: 3,
                    },
                    livenessProbe: {
                      httpGet: { path: '/health/live', port: 9000 },
                      periodSeconds: 10,
                      failureThreshold: 3,
                    },
                    resources: {
                      limits:   { cpu: '1000m', memory: '1500Mi' },
                      requests: { cpu: '250m',  memory: '768Mi' },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    });

    // ── 5. Ingress ────────────────────────────────────────────────────────────
    const ingress = new eks.KubernetesManifest(this, 'Ingress', {
      cluster,
      manifest: [
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: {
            name: 'keycloak',
            annotations: {
              // Requires an nginx ingress controller in the cluster
              'kubernetes.io/ingress.class': 'nginx',
            },
          },
          spec: {
            tls: [
              {
                hosts: [keycloakHostname],
                // Provision this TLS secret externally (e.g. cert-manager)
                secretName: 'keycloak-tls-cert',
              },
            ],
            rules: [
              {
                host: keycloakHostname,
                http: {
                  paths: [
                    {
                      path: '/',
                      pathType: 'Prefix',
                      backend: {
                        service: { name: 'keycloak', port: { number: 8080 } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    // ── Dependency ordering ───────────────────────────────────────────────────
    // StatefulSet waits for the Secret and headless Service to be ready
    sts.node.addDependency(dbSecret);
    sts.node.addDependency(discoverySvc);
    // Ingress waits for the ClusterIP Service to be ready
    ingress.node.addDependency(svc);
  }
}

