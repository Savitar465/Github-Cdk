import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiLambdaDynamodbStack } from '../lib/stacks';

describe('ApiLambdaDynamodbStack', () => {
  const app = new cdk.App();
  const stack = new ApiLambdaDynamodbStack(app, 'ApiLambdaDynamodbStackTest');
  const template = Template.fromStack(stack);

  it('creates one DynamoDB table with on-demand billing', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        {
          AttributeName: 'id',
          KeyType: 'HASH',
        },
      ],
    });
  });

  it('creates a Lambda function with table name env var', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
        },
      },
    });
  });

  it('creates an API Gateway REST API with deploy stage v1', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'v1',
    });
  });

  it('creates methods for CRUD and health endpoints', () => {
    template.resourceCountIs('AWS::ApiGateway::Method', 6);
  });
});

