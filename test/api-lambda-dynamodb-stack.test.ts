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
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: 'Lambda CRUD API for GitHub-like repositories in DynamoDB',
      Runtime: 'nodejs20.x',
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
          FILES_BUCKET_NAME: Match.anyValue(),
        },
      },
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: 'Deletes repository item from DynamoDB when its file is deleted from S3',
      Runtime: 'nodejs20.x',
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
        },
      },
    });
  });

  it('creates an S3 bucket for repository files', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  it('creates a CloudFront distribution for the static website', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
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

