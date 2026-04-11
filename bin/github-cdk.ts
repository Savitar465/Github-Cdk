#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { getEnvironmentConfig } from '../config/app-config';
import {
  ApiLambdaDynamodbStack,
  Ec2ServicesPlatformStack,
  HelloLambdaStack,
  KeycloakStack,
  S3DynamoSyncStack
} from '../lib/stacks';

const app = new cdk.App();
const config = getEnvironmentConfig();
const { stackName, ...environmentConfig } = config;

const env = (environmentConfig.account || environmentConfig.region)
  ? { account: environmentConfig.account, region: environmentConfig.region }
  : undefined;

// new KeycloakStack(app, stackName, {
//   env: stackEnv,
//   ...environmentConfig,
// });

// new HelloLambdaStack(app, 'HelloLambdaStack', {
//   env,
// });

// new ApiLambdaDynamodbStack(app, 'ApiLambdaDynamodbStack', {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//     region: process.env.CDK_DEFAULT_REGION,
//   },
// });

// new S3DynamoSyncStack(app, 'S3DynamoSyncStack', {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//     region: process.env.CDK_DEFAULT_REGION,
//   },
// });

new Ec2ServicesPlatformStack(app, 'Ec2ServicesPlatformStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  allowedSshCidr: process.env.ALLOWED_SSH_CIDR ?? '0.0.0.0/0',
  keyName: process.env.EC2_KEY_NAME,
});

