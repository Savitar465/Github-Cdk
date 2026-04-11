#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { getEnvironmentConfig } from '../config/app-config';
import { KeycloakStack } from '../lib/stacks';

const app = new cdk.App();
const config = getEnvironmentConfig();
const { stackName, ...environmentConfig } = config;

const stackEnv = (environmentConfig.account || environmentConfig.region)
  ? { account: environmentConfig.account, region: environmentConfig.region }
  : undefined;

new KeycloakStack(app, stackName, {
  env: stackEnv,
  ...environmentConfig,
});
