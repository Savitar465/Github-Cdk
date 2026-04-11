#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { HelloLambdaStack } from '../lib/stacks';

const app = new cdk.App();

const env = process.env.AWS_ACCOUNT_ID && process.env.AWS_REGION
  ? { account: process.env.AWS_ACCOUNT_ID, region: process.env.AWS_REGION }
  : undefined;

new HelloLambdaStack(app, 'HelloLambdaStack', {
  env,
});
