import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class HelloLambdaStack extends cdk.Stack {
  public readonly helloFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.helloFunction = new lambda.Function(this, 'HelloFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
          const name = body.name || event.name;

          const message = name ? \`Hello \${name}\` : 'Hello World!!';

          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          };
        };
      `),
      description: 'Lambda that returns Hello World!! or Hello {name}',
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      value: this.helloFunction.functionName,
      description: 'Hello Lambda function name',
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: this.helloFunction.functionArn,
      description: 'Hello Lambda function ARN',
    });
  }
}
