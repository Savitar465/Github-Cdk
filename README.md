# CDK Platform Stack

This CDK app provisions a Keycloak platform on AWS with:

- Amazon EKS cluster and managed node group
- Keycloak on Kubernetes manifests
- Amazon RDS PostgreSQL database for Keycloak
- Cloudflare Tunnel option to publish Keycloak without a public AWS load balancer

## Architecture highlights

- Keycloak is configured to use external PostgreSQL (RDS), not in-cluster Postgres.
- All runtime and deployment values are loaded from `.env`.

## Configuration

Copy `.env.example` to `.env` and set values for your environment:

```bash
cp .env.example .env
```

Required secrets:

- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `CLOUDFLARE_TUNNEL_TOKEN` (when `KEYCLOAK_EXPOSURE=cloudflare-tunnel`)

Exposure mode:

- `KEYCLOAK_EXPOSURE=cloudflare-tunnel` (recommended for this project)
- `KEYCLOAK_EXPOSURE=ingress` (requires an ingress controller + TLS secret)

Main sizing variables (all read from `.env`):

- `EKS_NODE_INSTANCE_TYPE`, `EKS_NODE_DESIRED_SIZE`, `EKS_NODE_MIN_SIZE`, `EKS_NODE_MAX_SIZE`
- `RDS_INSTANCE_TYPE`, `RDS_ALLOCATED_STORAGE_GB`, `RDS_ENGINE_VERSION`, `RDS_MULTI_AZ`
- `VPC_NAT_GATEWAYS` (default `0` to avoid NAT Gateway hourly charges)

## Cloudflare Tunnel setup

1. In Cloudflare Zero Trust, create a tunnel and copy the token.
2. In Cloudflare DNS, create a record for your hostname (for example `keycloak.savitar.online`) routed through the tunnel.
3. Set these variables in `.env`:

   - `KEYCLOAK_HOSTNAME=keycloak.savitar.online`
   - `KEYCLOAK_EXPOSURE=cloudflare-tunnel`
   - `CLOUDFLARE_TUNNEL_TOKEN=<token from Zero Trust>`

The stack deploys a `cloudflared` Deployment in Kubernetes; traffic flows from Cloudflare edge to your in-cluster `keycloak` service.

## mkcert TLS (ingress mode)

`mkcert` is intended for local trust, not public internet trust. Use this for dev/lab environments only.

1. Generate certs (example host):

   - `mkcert keycloak.savitar.online`

2. Base64 encode files and place them in `.env`:

   - `MKCERT_TLS_CERT_B64=<base64 of certificate PEM>`
   - `MKCERT_TLS_KEY_B64=<base64 of private key PEM>`
   - `KEYCLOAK_EXPOSURE=ingress`

When set, CDK creates the Kubernetes TLS secret `keycloak-tls-cert` and attaches it to the Keycloak ingress.

## Commands

- `npm run build` compile TypeScript
- `npm run test` run unit tests
- `npx cdk synth` synthesize CloudFormation template
- `npx cdk deploy` deploy the stack

## Notes

- This stack uses `RemovalPolicy.DESTROY` for easier development teardown.
- `db.t3.micro` + single-AZ + 20GiB are set as dev/free-tier-friendly defaults for RDS PostgreSQL.
- EKS control plane may still incur hourly charges depending on your account/free-tier eligibility.
- This sample unwraps Secrets Manager values into Kubernetes manifests/Helm values
  so `cdk synth` works end-to-end; use External Secrets or a runtime secret fetch
  pattern for production to avoid storing plaintext values in templates.
- Before production use, switch data resources (S3/RDS) to `RETAIN`, harden networking,
  and expose services using an ingress strategy that matches your security model.
