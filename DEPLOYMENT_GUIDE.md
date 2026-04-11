# EKS Keycloak Deployment Guide

## Overview
This CDK stack deploys a complete Keycloak infrastructure on AWS EKS with:
- **EKS Cluster**: Using Auto Mode (managed compute) on Kubernetes v1.35
- **VPC**: 3-tier subnet configuration (Public, Private with NAT, Isolated)
- **RDS PostgreSQL**: Aurora-compatible database
- **Keycloak**: Deployed as StatefulSet with clustering via Infinispan
- **Ingress**: NGINX Ingress Controller (optional, if kubectl provider available)
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
│ Private Subnets (10.0.1.0/24)   │  EKS Nodes
│ - EKS Auto Mode Nodes            │  (Auto Mode)
│ - NAT Egress to Internet          │
├─────────────────────────────────┤
│ Isolated Subnets (10.0.2.0/24)  │  RDS
│ - RDS PostgreSQL                 │  Database
└─────────────────────────────────┘
```

### EKS Configuration
- **Mode**: Auto Mode (managed by AWS)
- **Kubernetes Version**: 1.35
- **Compute**: Managed node pools (system + general-purpose)
- **Networking**: VPC native with security groups
- **Access Control**: IAM-based (via access entries)

## Prerequisites

### AWS Account Requirements
- **Free Tier Eligible**:
  - RDS: `db.t3.micro` (12 months free)
  - EC2: NAT Gateway (partial free)
  - EKS: Control plane (always free)
  
- **Minimal Cost Services**:
  - EKS Auto Mode compute nodes
  - NAT Gateway data transfer
  - Load Balancer (if using Ingress)

### Local Requirements
- Node.js 20+ and npm
- AWS CLI configured with credentials
- `kubectl` for debugging (optional)

## Environment Configuration

### Setup .env File

Copy `.env.example` to `.env` and update with your values:

```bash
# AWS
AWS_ACCOUNT_ID=your-account-id
AWS_REGION=us-east-1

# Stack
CDK_STACK_NAME=KeycloakStack-prod
EKS_CLUSTER_NAME=github-eks

# Network
VPC_MAX_AZS=2
VPC_NAT_GATEWAYS=1  # Important: must be ≥ 1 for EKS nodes

# EKS Nodes
EKS_NODE_INSTANCE_TYPE=t3.small
EKS_NODE_DESIRED_SIZE=1
EKS_NODE_MIN_SIZE=1
EKS_NODE_MAX_SIZE=3

# Keycloak
KEYCLOAK_HOSTNAME=keycloak.example.com
KEYCLOAK_EXPOSURE=ingress           # or cloudflare-tunnel
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<secure-password>
KEYCLOAK_REPLICAS=1

# TLS Certificates (Optional)
# Either provide base64-encoded values OR file paths:
MKCERT_TLS_CERT_PATH=./tls/keycloak.example.com.pem
MKCERT_TLS_KEY_PATH=./tls/keycloak.example.com-key.pem

# Cloudflare (required if KEYCLOAK_EXPOSURE=cloudflare-tunnel)
CLOUDFLARE_TUNNEL_TOKEN=<tunnel-token>

# Database
KEYCLOAK_DB_NAME=githubdb
KEYCLOAK_DB_PASSWORD=<secure-password>
RDS_INSTANCE_TYPE=db.t3.micro
RDS_ALLOCATED_STORAGE_GB=20
RDS_ENGINE_VERSION=17.2
RDS_MULTI_AZ=false
```

### Important Notes
1. **VPC_NAT_GATEWAYS must be ≥ 1**: EKS Auto Mode nodes require Internet egress via NAT
2. **Free Tier DB Instance**: Use `db.t3.micro` (NOT `db.t3.small` or larger)
3. **Keycloak Exposure Options**:
   - `ingress`: Exposes via LoadBalancer (requires Ingress controller)
   - `cloudflare-tunnel`: Uses Cloudflare tunnel for secure access

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

# Check EKS cluster
aws eks describe-cluster --name github-eks --region us-east-1
```

## Post-Deployment

### Update kubeconfig
```bash
aws eks update-kubeconfig \
  --name github-eks \
  --region us-east-1
```

### Verify Keycloak Deployment
```bash
# Check pods
kubectl get pods -n default

# Check services
kubectl get svc keycloak

# View logs
kubectl logs -f statefulset/keycloak
```

### Access Keycloak
- **Ingress**: `https://keycloak.example.com`
- **Cloudflare Tunnel**: Automatically routed via tunnel

## Troubleshooting

### EKS Cluster Not Creating
**Error**: "No 'Private' subnet groups"
- **Cause**: VPC configured with Isolated subnets only
- **Fix**: Ensure `subnetConfiguration` includes `PRIVATE_WITH_EGRESS` type

**Error**: "NAT Gateway needed but VPC_NAT_GATEWAYS=0"
- **Fix**: Set `VPC_NAT_GATEWAYS=1` in `.env`

### RDS Creation Fails
**Error**: "Instance size not available for free tier"
- **Cause**: Using instance type larger than `db.t3.micro`
- **Fix**: Set `RDS_INSTANCE_TYPE=db.t3.micro`

**Error**: "Invalid rule description"
- **Cause**: Security group rule description exceeds 256 chars
- **Fix**: Ensure descriptions are concise

### Keycloak Pod Stuck in Pending
**Cause**: Insufficient capacity or resource constraints
**Debug**:
```bash
kubectl describe pod keycloak-0
kubectl get nodes
```

## Cost Estimation (Free Tier + Minimal)

| Service | Free Tier | Cost/Month |
|---------|-----------|-----------|
| EKS Control | ✓ | $0 |
| EKS Auto Mode Nodes | - | $0.05-0.10/hour |
| RDS db.t3.micro | ✓ (12mo) | $0 or $35 |
| NAT Gateway | - | $0.045/hour |
| Load Balancer | - | $0.16/hour |
| **Total** | | ~$50-100 |

## Security Recommendations

1. **Secrets Management**: Use AWS Secrets Manager instead of environment variables
2. **IAM Roles**: Grant minimal permissions to EKS nodes
3. **Network**: Restrict security group ingress to required IPs only
4. **TLS**: Always use TLS certificates (mkcert, Let's Encrypt, or self-signed)
5. **Backup**: Enable RDS automated backups
6. **Monitoring**: Enable CloudWatch logs for EKS control plane

## Cleanup

To delete all resources:
```bash
npm run cdk destroy --context env=prod
```

⚠️ **Warning**: This will delete:
- EKS cluster
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

- [AWS EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/eks-auto-mode.html)
- [Keycloak Kubernetes Deployment](https://www.keycloak.org/operator/kubernetes)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Cloudflare Tunnel Setup](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

