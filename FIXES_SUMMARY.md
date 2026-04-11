# EKS Cluster Configuration Fixes Summary

## Problems Fixed

### 1. **Type Mismatch: TS2740/TS2322**
**Issue**: `lib/stacks/keycloak-stack.ts` imported `aws-eks` but `KubeCluster` construct used `aws-eks-v2`, causing incompatible `IKubectlProvider` types.

**Fix**:
- Changed `lib/stacks/keycloak-stack.ts` to import from `aws-cdk-lib/aws-eks-v2`
- Changed `lib/constructs/keycloak/keycloak-manifests.ts` to import from `aws-cdk-lib/aws-eks-v2`
- Changed `cluster` property type from `eks.Cluster` to `eks.ICluster` in `KeycloakStack`

**Files Modified**:
- `lib/stacks/keycloak-stack.ts` ✓
- `lib/constructs/keycloak/keycloak-manifests.ts` ✓

---

### 2. **Subnet Configuration Error**
**Issue**: VPC was configured with only `PUBLIC` and `PRIVATE_ISOLATED` subnets. EKS Auto Mode requires `PRIVATE_WITH_EGRESS` subnets to access the internet for pulling images and reaching AWS API endpoints.

**Error Message**:
```
There are no 'Private' subnet groups in this VPC. 
Available types: Isolated, Deprecated_Isolated, Public
```

**Fix**:
- Modified `lib/constructs/network/vpc-construct.ts` to create **3-tier subnet configuration**:
  - **Public Subnets**: Internet-facing, with Internet Gateway (for NAT Gateway)
  - **Private Subnets with Egress**: For EKS nodes with NAT Gateway access
  - **Isolated Subnets**: For RDS database (no internet access)

**File Modified**:
- `lib/constructs/network/vpc-construct.ts` ✓

---

### 3. **NAT Gateway Not Configured**
**Issue**: `.env` had `VPC_NAT_GATEWAYS=0`, which prevents EKS nodes from reaching the internet even though they were in private subnets.

**Fix**:
- Updated `.env` to `VPC_NAT_GATEWAYS=1`
- Updated default in `vpc-construct.ts` from `0` to `1`

**File Modified**:
- `.env` ✓

---

### 4. **Missing kubectl Provider**
**Issue**: EKS Auto Mode doesn't automatically create a kubectl provider. Keycloak manifests and NGINX Helm chart require kubectl access via Lambda provider.

**Error Message**:
```
Kubectl Provider is not defined in this cluster. 
Define it when creating the cluster
```

**Fix**:
- Added `@aws-cdk/lambda-layer-kubectl-v35` dependency
- Configured `kubectlProviderOptions` in the EKS Cluster creation
- Made NGINX Helm chart installation conditional (only if `kubectlProvider` exists)

**Files Modified**:
- `lib/constructs/cluster/eks-cluster.ts` ✓
- `package.json` ✓ (added dependency)

---

### 5. **TLS Certificate Configuration**
**Issue**: App config expected base64-encoded TLS certificates, but `.env` referenced file paths.

**Fix**:
- Enhanced `config/app-config.ts` with `readFileAsBase64()` function
- Now supports both formats:
  - Direct base64: `MKCERT_TLS_CERT_B64=LS0tLS1CRUdJTi...`
  - File paths: `MKCERT_TLS_CERT_PATH=./tls/cert.pem`

**File Modified**:
- `config/app-config.ts` ✓

---

## Changes Summary

### Modified Files (5)
| File | Change | Status |
|------|--------|--------|
| `lib/stacks/keycloak-stack.ts` | Import from aws-eks-v2; cluster type to ICluster | ✓ Fixed |
| `lib/constructs/keycloak/keycloak-manifests.ts` | Import from aws-eks-v2 | ✓ Fixed |
| `lib/constructs/network/vpc-construct.ts` | Add PRIVATE_WITH_EGRESS subnets; ensure NAT=1 | ✓ Fixed |
| `lib/constructs/cluster/eks-cluster.ts` | Add kubectlProviderOptions; conditional Helm install | ✓ Fixed |
| `config/app-config.ts` | Add TLS file path support | ✓ Enhanced |

### Added/Modified Configuration
| File | Change | Status |
|------|--------|--------|
| `package.json` | Added `@aws-cdk/lambda-layer-kubectl-v35` | ✓ Added |
| `.env` | VPC_NAT_GATEWAYS: 0 → 1 | ✓ Fixed |
| `DEPLOYMENT_GUIDE.md` | New deployment guide | ✓ Created |

---

## Architecture Changes

### Before
```
VPC (10.0.0.0/16)
├── Public Subnets (IGW)
└── Private Isolated Subnets (No Internet)
    ├── EKS nodes ❌ (can't reach AWS APIs)
    └── RDS ✓
```

### After
```
VPC (10.0.0.0/16)
├── Public Subnets (IGW)
│   └── NAT Gateway
├── Private Subnets (NAT Egress) ✓
│   └── EKS nodes ✓ (can reach AWS APIs)
└── Private Isolated Subnets (No Internet) ✓
    └── RDS ✓
```

---

## Testing & Validation

### Build ✓
```bash
npm run build
# Output: TypeScript compilation successful
```

### Synth ✓
```bash
npm run synth:prod
# Output: CloudFormation template generated successfully
```

### Runtime Validation ✓
```bash
npx ts-node --prefer-ts-exts bin/github-cdk.ts
# Output: No errors, configuration valid
```

---

## Deployment Readiness

✅ **Type Safety**: No TypeScript errors
✅ **VPC Configuration**: Proper 3-tier subnet architecture
✅ **EKS Setup**: Auto Mode with kubectl provider configured
✅ **Kubernetes Manifests**: Ready for deployment (Secret, Service, StatefulSet)
✅ **TLS Support**: File paths and base64 both supported
✅ **NAT Gateway**: Configured for EKS internet access

---

## Next Steps

1. **Generate TLS certificates** (if using mkcert):
   ```bash
   mkcert keycloak.savitar.online
   mkdir -p tls
   cp keycloak.savitar.online.pem tls/
   cp keycloak.savitar.online-key.pem tls/
   ```

2. **Deploy to AWS**:
   ```bash
   npm run deploy:prod
   ```

3. **Monitor stack creation**:
   ```bash
   aws cloudformation describe-stacks --stack-name KeycloakStack-prod --region us-east-1
   ```

4. **Configure kubectl**:
   ```bash
   aws eks update-kubeconfig --name github-eks --region us-east-1
   ```

---

## Known Limitations & Considerations

1. **Auto Mode Limitations**:
   - Limited node pool customization
   - Cannot use custom AMIs
   - Auto-scaling managed by AWS

2. **Free Tier**:
   - EKS control plane: Free
   - EKS Auto Mode nodes: Small hourly cost
   - RDS db.t3.micro: Free for 12 months (then ~$35/month)

3. **HA Considerations**:
   - Current setup: 1 Keycloak replica
   - Recommended for prod: 3+ replicas with Multi-AZ RDS
   - Cost implications: ~3x infrastructure cost

---

## References

- [AWS CDK EKS v2 Module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-eks-v2-readme.html)
- [EKS Auto Mode Documentation](https://docs.aws.amazon.com/eks/latest/userguide/eks-auto-mode.html)
- [VPC Subnet Types](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-ec2-readme.html#vpc-endpoint-services)
- [Keycloak Kubernetes Operator](https://www.keycloak.org/operator/kubernetes)

