import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import * as path from 'node:path';

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

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    websiteBucket.grantPublicAccess();

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
    });

    const rewriteApiPathFunction = new cloudfront.Function(this, 'RewriteApiPathFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/api/') === 0) {
    request.uri = request.uri.substring(4);
  }
  return request;
}
      `),
    });

    const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3StaticWebsiteOrigin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'api/*': {
          origin: new origins.HttpOrigin(
            `${api.restApiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com`,
            {
              originPath: `/${api.deploymentStage.stageName}`,
            },
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: rewriteApiPathFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'WebsiteDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'website'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
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

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket for the static website',
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: `https://${distribution.domainName}`,
      description: 'CloudFront URL for the static website',
    });
  }
}


