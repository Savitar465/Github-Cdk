# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An AWS CDK application (TypeScript) that provisions a complete Keycloak authentication platform on AWS ECS (EC2-backed) with a PostgreSQL RDS database behind an Application Load Balancer.

## Commands

```bash
# Build
npm run build          # Compile TypeScript
npm run watch          # Watch mode

# Test
npm run test           # Run Jest tests
npm run test:coverage  # Run tests with coverage

# CDK
npm run synth          # Synthesize CloudFormation (default context)
npm run synth:dev      # Synthesize for dev environment
npm run synth:prod     # Synthesize for prod environment
npm run diff:dev       # Diff dev before deploying
npm run diff:prod      # Diff prod before deploying
npm run deploy:dev     # Deploy to dev (no approval prompt)
npm run deploy:prod    # Deploy to prod (requires approval)
```

Tests use Jest with the CDK assertions library (`aws-cdk-lib/assertions`). Run a single test with:
```bash
npx jest --testNamePattern "your test name"
```

## Architecture

### Construct Hierarchy

`KeycloakStack` (`lib/stacks/keycloak-stack.ts`) wires together four L3 constructs:

1. **GithubVpc** (`lib/constructs/network/vpc-construct.ts`) — 3-tier VPC with public, private-with-egress, and isolated subnets. When `natGateways=0`, ECS tasks land in public subnets to avoid NAT costs.

2. **EcsCluster** (`lib/constructs/cluster/ecs-cluster.ts`) — EC2-backed cluster with an Auto Scaling Group. Returns both the cluster and the ASG so the stack can wire capacity.

3. **GithubDatabase** (`lib/constructs/database/github-database.ts`) — RDS PostgreSQL. Automatically normalizes `t3.micro` → `t4g.micro` for free-tier eligibility. Supports PostgreSQL versions 15.10, 16.4, and 17.2.

4. **KeycloakEcsService** (`lib/constructs/keycloak/keycloak-ecs-service.ts`) — ECS service running Keycloak 26.3.3. Memory is capped at 1400 MiB (fits on t3.small). The container entrypoint runs Keycloak in the background, waits for it to be healthy, then patches the master realm via Keycloak admin API (disables HTTPS enforcement, widens redirect URIs). JVM heap is capped at 768m. Uses a deployment circuit breaker with automatic rollback; `minHealthyPercent=0` allows in-place replacement on small single-instance clusters.

### Configuration (`config/app-config.ts`)

All config is loaded from a `.env` file at startup (copy `.env.example`). The file validates and exports a strongly-typed `AppConfig` object. Validation fails fast at CDK synth time. The `KEYCLOAK_HOSTNAME` value is validated to be a bare hostname — no scheme, path, or port is allowed.

### Key Design Decisions

- **RemovalPolicy.DESTROY** is used throughout for dev-friendly teardowns. Switch to `RETAIN` for production RDS.
- Admin credentials are passed as plaintext ECS environment variables. The README notes this should move to Secrets Manager for production.
- The stack emits three CloudFormation outputs: `ClusterName`, `DbEndpoint`, `KeycloakUrl`.
- CloudWatch log group `/ecs/keycloak` with 1-week retention.
- Health checks target Keycloak's dedicated health port (9000), not the main 8080 port.

### CDK Entry Point

`bin/github-cdk.ts` loads `AppConfig`, instantiates the stack, and applies tags. The `cdk.json` file sets `lookups: false` and carries context flags for VPC/subnet lookups used during synth.
