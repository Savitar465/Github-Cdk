import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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

    const crudFunction = new lambda.Function(this, 'RepositoriesCrudFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', 'repositories-crud')),
      description: 'Lambda CRUD API for GitHub-like repositories in DynamoDB',
    });

    table.grantReadWriteData(crudFunction);

    const api = new apigateway.RestApi(this, 'RepositoriesApi', {
      restApiName: 'GithubRepositoriesApi',
      deployOptions: {
        stageName: 'v1',
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
  }
}


