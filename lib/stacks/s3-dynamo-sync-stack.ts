import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import * as path from 'path';

export class S3DynamoSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const filesBucket = new s3.Bucket(this, 'FilesBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const filesMetadataTable = new dynamodb.Table(this, 'FilesMetadataTable', {
      partitionKey: { name: 'bucketName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'objectKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const onObjectCreatedFunction = new lambda.Function(this, 'OnObjectCreatedFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: filesMetadataTable.tableName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 's3-object-created-to-dynamodb')),
      description: 'Inserts file metadata into DynamoDB when an object is created in S3',
    });

    const onObjectRemovedFunction = new lambda.Function(this, 'OnObjectRemovedFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: filesMetadataTable.tableName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 's3-object-removed-from-dynamodb')),
      description: 'Deletes file metadata from DynamoDB when an object is removed from S3',
    });

    filesMetadataTable.grantReadWriteData(onObjectCreatedFunction);
    filesMetadataTable.grantWriteData(onObjectRemovedFunction);

    filesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(onObjectCreatedFunction),
    );

    filesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.LambdaDestination(onObjectRemovedFunction),
    );

    new cdk.CfnOutput(this, 'SyncBucketName', {
      value: filesBucket.bucketName,
      description: 'S3 bucket for file upload events',
    });

    new cdk.CfnOutput(this, 'SyncTableName', {
      value: filesMetadataTable.tableName,
      description: 'DynamoDB table with S3 object metadata',
    });
  }
}

