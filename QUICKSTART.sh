#!/bin/bash
# Quick Start: Deploy Keycloak on AWS EKS with CDK

set -e

echo "🚀 Starting Keycloak EKS Deployment..."
echo ""

# Step 1: Validate environment
echo "📋 Step 1: Validating environment..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+."
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI."
    exit 1
fi

echo "✓ Node.js $(node -v)"
echo "✓ AWS CLI $(aws --version)"
echo ""

# Step 2: Install dependencies
echo "📦 Step 2: Installing dependencies..."
npm install

echo "✓ Dependencies installed"
echo ""

# Step 3: Build TypeScript
echo "🏗️  Step 3: Building TypeScript..."
npm run build

echo "✓ Build successful"
echo ""

# Step 4: Validate configuration
echo "🔍 Step 4: Validating CDK configuration..."
npx ts-node --prefer-ts-exts bin/github-cdk.ts > /dev/null 2>&1

echo "✓ Configuration valid"
echo ""

# Step 5: Synthesize CloudFormation
echo "📝 Step 5: Synthesizing CloudFormation template..."
npm run synth:prod > /dev/null

TEMPLATE_SIZE=$(stat -f%z cdk.out/KeycloakStack-prod.template.json 2>/dev/null || stat -c%s cdk.out/KeycloakStack-prod.template.json 2>/dev/null || echo "N/A")
echo "✓ Template generated (size: $TEMPLATE_SIZE bytes)"
echo ""

# Step 6: Ready for deployment
echo "✅ All validations passed!"
echo ""
echo "Next steps:"
echo "  1. Review AWS configuration:"
echo "     cat .env | grep AWS_"
echo ""
echo "  2. Deploy to AWS:"
echo "     npm run deploy:prod"
echo ""
echo "  3. Monitor deployment:"
echo "     aws cloudformation describe-stack-events \\"
echo "       --stack-name KeycloakStack-prod \\"
echo "       --region us-east-1"
echo ""
echo "📚 Documentation:"
echo "  - Detailed guide:    cat DEPLOYMENT_GUIDE.md"
echo "  - Fixes summary:     cat FIXES_SUMMARY.md"
echo ""

