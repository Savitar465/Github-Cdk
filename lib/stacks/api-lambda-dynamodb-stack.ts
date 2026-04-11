import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import * as path from 'path';

export class ApiLambdaDynamodbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'RepositoriesTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const filesBucket = new s3.Bucket(this, 'GithubBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const crudFunction = new lambda.Function(this, 'RepositoriesCrudFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        FILES_BUCKET_NAME: filesBucket.bucketName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 'repositories-crud')),
      description: 'Lambda CRUD API for GitHub-like repositories in DynamoDB',
    });

    const s3DeleteCleanupFunction = new lambda.Function(this, 'S3DeleteCleanupFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 'repository-s3-delete-cleanup')),
      description: 'Deletes repository item from DynamoDB when its file is deleted from S3',
    });

    table.grantReadWriteData(crudFunction);
    filesBucket.grantReadWrite(crudFunction);
    table.grantWriteData(s3DeleteCleanupFunction);

    filesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.LambdaDestination(s3DeleteCleanupFunction),
    );

    const api = new apigateway.RestApi(this, 'RepositoriesApi', {
      restApiName: 'GithubRepositoriesApi',
      deployOptions: {
        stageName: 'v1',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(crudFunction);

    const repositories = api.root.addResource('repositories');
    repositories.addMethod('POST', lambdaIntegration);
    repositories.addMethod('GET', lambdaIntegration);

    const repositoryById = repositories.addResource('{id}');
    repositoryById.addMethod('GET', lambdaIntegration);
    repositoryById.addMethod('PUT', lambdaIntegration);
    repositoryById.addMethod('DELETE', lambdaIntegration);

    const health = api.root.addResource('health');
    health.addMethod('GET', lambdaIntegration);

    new cdk.CfnOutput(this, 'DynamoTableName', {
      value: table.tableName,
      description: 'DynamoDB table for repository data',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base URL for the API',
    });

    new cdk.CfnOutput(this, 'FilesBucketName', {
      value: filesBucket.bucketName,
      description: 'S3 bucket for repository profile images',
    });
  }
}


