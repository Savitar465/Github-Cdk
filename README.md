# CDK Platform Stack

This CDK app provisions a Keycloak platform on AWS with:

- Amazon ECS cluster and service
- Keycloak running as a containerized ECS workload
- Amazon RDS PostgreSQL database for Keycloak
- Application Load Balancer for public ingress

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
- `DB_PASSWORD`

Main sizing variables (all read from `.env`):

- `ECS_INSTANCE_TYPE`, `ECS_DESIRED_CAPACITY`, `ECS_MIN_CAPACITY`, `ECS_MAX_CAPACITY`
- `RDS_INSTANCE_TYPE`, `RDS_ALLOCATED_STORAGE_GB`, `RDS_ENGINE_VERSION`, `RDS_MULTI_AZ`
- `VPC_NAT_GATEWAYS` (default `1` so ECS tasks can reach CloudWatch Logs and external registries)


## Commands

- `npm run build` compile TypeScript
- `npm run test` run unit tests
- `npx cdk synth` synthesize CloudFormation template
- `npx cdk deploy` deploy the stack

## Notes

- This stack uses `RemovalPolicy.DESTROY` for easier development teardown.
- `t4g.micro` + single-AZ + 20GiB are set as dev/free-plan-friendly defaults for RDS PostgreSQL.
- ECS cluster capacity is sized with EC2 instances and can be adjusted with the ECS sizing variables above.
  so `cdk synth` works end-to-end; use External Secrets or a runtime secret fetch
  pattern for production to avoid storing plaintext values in templates.
- Before production use, switch data resources (S3/RDS) to `RETAIN`, harden networking,
  and expose services using an ingress strategy that matches your security model.
