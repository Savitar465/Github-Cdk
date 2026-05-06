# ECS Keycloak Deployment Guide

## Overview
This CDK stack deploys a complete Keycloak infrastructure on AWS ECS with:
- **ECS Cluster**: Using EC2-backed capacity
- **VPC**: 3-tier subnet configuration (Public, Private with NAT, Isolated)
- **RDS PostgreSQL**: Aurora-compatible database (public for dev, private for production)
- **Keycloak**: Deployed as an ECS service
- **Ingress**: Application Load Balancer (optional)
- **Exposure**: Ingress or Cloudflare Tunnel

## Architecture

### Network Topology
```
┌─────────────────────────────────┐
│          VPC (10.0.0.0/16)      │
├─────────────────────────────────┤
│  Public Subnets (10.0.0.0/24)   │  NAT Gateway
│  - Internet Gateway              │  │
│  - Load Balancer                 │  ▼
├─────────────────────────────────┤
│ Private Subnets (10.0.1.0/24)   │  ECS Tasks
│ - ECS Service                    │  (EC2-backed)
│ - NAT Egress to Internet          │
├─────────────────────────────────┤
│ Isolated Subnets (10.0.2.0/24)  │  RDS
│ - RDS PostgreSQL                 │  Database
└─────────────────────────────────┘
```

### ECS Configuration
- **Mode**: ECS cluster with EC2 capacity
- **Compute**: Task definition + service
- **Networking**: VPC native with security groups
- **Access Control**: IAM roles for tasks and service

## Prerequisites

### AWS Account Requirements
- **Free Tier Eligible**:
  - RDS: `t4g.micro` (12 months free)
  - EC2: NAT Gateway (partial free)
    - ECS: Control plane (always free)
  
- **Minimal Cost Services**:
    - ECS EC2 capacity
  - NAT Gateway data transfer
  - Load Balancer (if using Ingress)

### Local Requirements
- Node.js 20+ and npm
- AWS CLI configured with credentials
- AWS ECS / CloudWatch tooling for debugging (optional)

## Environment Configuration

### Setup .env File

Copy `.env.example` to `.env` and update with your values:

```bash
# AWS
AWS_ACCOUNT_ID=your-account-id
AWS_REGION=us-east-1

# Stack
CDK_STACK_NAME=KeycloakStack-prod
ECS_CLUSTER_NAME=github-ecs

# Network
VPC_MAX_AZS=2
VPC_NAT_GATEWAYS=1  # Set to 0 for cost savings if you don't need NAT access

# ECS Capacity
ECS_INSTANCE_TYPE=t3.small
ECS_DESIRED_CAPACITY=1
ECS_MIN_CAPACITY=1
ECS_MAX_CAPACITY=3

# Keycloak
KEYCLOAK_HOSTNAME=keycloak.example.com  # hostname only; do not include http:// or :port
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<secure-password>
KEYCLOAK_REPLICAS=1

# Database
KEYCLOAK_DB_NAME=githubdb
KEYCLOAK_DB_PASSWORD=<secure-password>
RDS_INSTANCE_TYPE=t4g.micro
RDS_ALLOCATED_STORAGE_GB=20
RDS_ENGINE_VERSION=17.2
RDS_PUBLICLY_ACCESSIBLE=true
RDS_MULTI_AZ=false
```

### Important Notes
1. **VPC_NAT_GATEWAYS must be ≥ 1**: ECS tasks may require Internet egress via NAT for package pulls and external APIs
2. **Free Tier DB Instance**: Use `t4g.micro` (NOT `t3.small` or larger)
3. **Keycloak Exposure**:
   - Keycloak is exposed via an Application Load Balancer

## Deployment

### 1. Validate Configuration
```bash
npm run build
npx ts-node --prefer-ts-exts bin/github-cdk.ts
```

### 2. Synthesize CloudFormation
```bash
npm run synth:prod
```

### 3. Deploy Stack
```bash
npm run deploy:prod
```

### 4. Monitor Deployment
```bash
# Watch CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name KeycloakStack-prod \
  --region us-east-1

# Check ECS cluster
aws ecs describe-clusters --clusters github-ecs --region us-east-1
```

## Post-Deployment

### Verify Keycloak Deployment
```bash
# Describe the ECS service
aws ecs describe-services --cluster github-ecs --services keycloak --region us-east-1

# View logs
aws logs tail /ecs/keycloak --follow --region us-east-1
```

### Access Keycloak
- **Ingress**: `http://keycloak.example.com`

## Troubleshooting

### ECS Cluster Not Creating
**Error**: "No 'Private' subnet groups"
- **Cause**: VPC configured with Isolated subnets only
- **Fix**: Ensure `subnetConfiguration` includes `PRIVATE_WITH_EGRESS` type

**Error**: "NAT Gateway needed but VPC_NAT_GATEWAYS=0"
- **Fix**: Set `VPC_NAT_GATEWAYS=1` in `.env`

### RDS Creation Fails
**Error**: "Instance size not available for free tier"
- **Cause**: Using instance type larger than `t4g.micro`
- **Fix**: Set `RDS_INSTANCE_TYPE=t4g.micro`

**Error**: "Invalid rule description"
- **Cause**: Security group rule description exceeds 256 chars
- **Fix**: Ensure descriptions are concise

### Keycloak Service Not Starting
**Cause**: Insufficient capacity or resource constraints
**Debug**:
```bash
aws ecs describe-services --cluster github-ecs --services keycloak --region us-east-1
aws logs tail /ecs/keycloak --follow --region us-east-1
```

## Cost Estimation (Free Tier + Minimal)

| Service | Free Tier | Cost/Month |
|---------|-----------|-----------|
| ECS Control | ✓ | $0 |
| ECS EC2 Capacity | - | $0.05-0.10/hour |
| RDS t4g.micro | ✓ (12mo) | $0 or $35 |
| NAT Gateway | - | $0.045/hour |
| Load Balancer | - | $0.16/hour |
| **Total** | | ~$50-100 |

## Security Recommendations

1. **Secrets Management**: Use AWS Secrets Manager instead of environment variables
2. **IAM Roles**: Grant minimal permissions to ECS task roles
3. **Network**: Restrict security group ingress to required IPs only
4. **Backup**: Enable RDS automated backups
5. **Monitoring**: Enable CloudWatch logs for ECS services

## Cleanup

To delete all resources:
```bash
npm run cdk destroy --context env=prod
```

⚠️ **Warning**: This will delete:
- ECS cluster
- RDS database (check retention settings)
- VPC and subnets
- Elastic IPs and NAT gateways

## Next Steps

1. Configure DNS (Route53 or Cloudflare)
2. Set up backup strategy for RDS
3. Configure Keycloak realm and users
4. Integrate with your application
5. Set up monitoring and alerts
6. Plan high availability (Multi-AZ, replicas)

## References

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Keycloak Kubernetes Deployment](https://www.keycloak.org/operator/kubernetes)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)

