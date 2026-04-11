import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { S3DynamoSyncStack } from '../lib/stacks';

describe('S3DynamoSyncStack', () => {
  const app = new cdk.App();
  const stack = new S3DynamoSyncStack(app, 'S3DynamoSyncStackTest');
  const template = Template.fromStack(stack);

  it('creates one S3 bucket', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('creates one DynamoDB table with composite key', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'bucketName', KeyType: 'HASH' }),
        Match.objectLike({ AttributeName: 'objectKey', KeyType: 'RANGE' }),
      ]),
    });
  });

  it('creates created and removed event Lambda functions with table env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: 'Inserts file metadata into DynamoDB when an object is created in S3',
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
        },
      },
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: 'Deletes file metadata from DynamoDB when an object is removed from S3',
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
        },
      },
    });
  });
});

