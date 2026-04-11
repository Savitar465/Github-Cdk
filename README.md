# CDK Platform Stack

This CDK app provisions a Keycloak platform on AWS with:

- Amazon EKS cluster and managed node group
- Keycloak on Kubernetes manifests
- Amazon RDS PostgreSQL database for Keycloak

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

Main sizing variables (all read from `.env`):

- `EKS_NODE_INSTANCE_TYPE`, `EKS_NODE_DESIRED_SIZE`, `EKS_NODE_MIN_SIZE`, `EKS_NODE_MAX_SIZE`
- `RDS_INSTANCE_TYPE`, `RDS_ALLOCATED_STORAGE_GB`, `RDS_ENGINE_VERSION`, `RDS_MULTI_AZ`
- `VPC_NAT_GATEWAYS` (default `0` to avoid NAT Gateway hourly charges)

## Commands

- `npm run build` compile TypeScript
- `npm run test` run unit tests
- `npx cdk synth` synthesize CloudFormation template
- `npx cdk deploy` deploy the stack

### S3 + DynamoDB sync stack

- `npm run synth:sync` synthesize the S3-to-Dynamo sync stack
- `npm run diff:sync` show infrastructure diff
- `npm run deploy:sync` deploy the S3-to-Dynamo sync stack

Behavior:

- Uploading a file to the stack bucket inserts file metadata into DynamoDB.
- Deleting a file from the bucket removes its metadata item from DynamoDB.

## Notes

- This stack uses `RemovalPolicy.DESTROY` for easier development teardown.
- `db.t3.micro` + single-AZ + 20GiB are set as dev/free-tier-friendly defaults for RDS PostgreSQL.
- EKS control plane may still incur hourly charges depending on your account/free-tier eligibility.
- This sample unwraps Secrets Manager values into Kubernetes manifests/Helm values
  so `cdk synth` works end-to-end; use External Secrets or a runtime secret fetch
  pattern for production to avoid storing plaintext values in templates.
- Before production use, switch data resources (S3/RDS) to `RETAIN`, harden networking,
  and expose services using an ingress strategy that matches your security model.
