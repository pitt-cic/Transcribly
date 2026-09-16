import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import {Construct} from 'constructs';

interface ComponentBoilerplateProps extends cdk.StackProps {
    readonly stackName: string;
    readonly stageName: string;
    readonly developerName?: string;
    readonly tableRemovalPolicy: cdk.RemovalPolicy;
    readonly allowedOrigins?: string[];
}

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: ComponentBoilerplateProps) {
        super(scope, id, props);

        // Create a S3 bucket to store audio and transcripts
        const transcriptionBucket = new s3.Bucket(this, `transcription-bucket-${props?.stackName}`, {
            bucketName: `transcription-bucket-${props?.stackName}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: props?.tableRemovalPolicy,
            autoDeleteObjects: props?.tableRemovalPolicy === cdk.RemovalPolicy.DESTROY,
            cors: [{
                allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
                allowedOrigins: [
                    'http://localhost:5173',
                    'http://localhost:5176',
                    'http://localhost:3000',
                    'https://*.amplifyapp.com', // only kept for testing, should be removed in production
                    ...(props?.allowedOrigins ?? []),
                ],
                allowedHeaders: ['*'],
            }],
        });

        // Transcription dynamodb table to keep track of transcription info
        const transcriptionTable = new dynamodb.Table(this, `TranscriptionTable-${props?.stackName}`, {
            tableName: `TranscriptionTable-${props?.stackName}`,
            partitionKey: {
                name: 'userId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'jobId',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: props?.tableRemovalPolicy,
        });

        // GSI to query by User Pool sub
        transcriptionTable.addGlobalSecondaryIndex({
            indexName: 'subIndex',
            partitionKey: {
                name: 'subject',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'jobId',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // Dead-Letter queue for failed transcription jobs
        const transcriptionDLQ = new sqs.Queue(this, `TranscriptionDLQ-${props?.stackName}`, {
            queueName: `transcription-dlq-${props?.stackName}`
        });

        // Main queue carrying audio-uploaded events from S3 to the started lambda
        const transcriptionQueue = new sqs.Queue(this, `TranscriptionQueue-${props?.stackName}`, {
            queueName: `transcription-queue-${props?.stackName}`,
            visibilityTimeout: cdk.Duration.seconds(90),
            deadLetterQueue: {
                queue: transcriptionDLQ,
                maxReceiveCount: 3,
            },
        });

        // Sends an event to the queue and filters on 'audio/'
        transcriptionBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3n.SqsDestination(transcriptionQueue),
            { prefix: 'audio/' },
        );

        // Lambda that consumes audio-uploaded events from SQS and starts Transcribe jobs
        const transcriptionStarter = new lambda.Function(this, `TranscriptionStarter-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'handler.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../backend/lambda/transcription_starter'),
                {
                    bundling: {
                        image: lambda.Runtime.PYTHON_3_13.bundlingImage,
                        platform: 'linux/arm64',
                        command: [
                            'bash', '-c',
                            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
                        ],
                    },
                }
            ),
            functionName: `transcription_starter-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName
            },
        });

        // Trigger the lambda for every message in the transcription queue
        transcriptionStarter.addEventSource(
            new lambdaEvents.SqsEventSource(transcriptionQueue)
        );

        // Grant the starter lambda permissions to read/write to the dynamodb table and read from the s3 bucket
        transcriptionTable.grantWriteData(transcriptionStarter);
        transcriptionBucket.grantRead(transcriptionStarter, 'audio/*');
        
        // Lets lambda call the transcribe api and tag the job with the userId
        transcriptionStarter.addToRolePolicy(new iam.PolicyStatement({
            actions: ['transcribe:StartTranscriptionJob', 'transcribe:TagResource'],
            resources: ['*'],
        }));

        // Transcribe's bucket validation check
        transcriptionStarter.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:GetBucketAcl', 's3:GetBucketLocation'],
            resources: [transcriptionBucket.bucketArn],
        }));

        // Transcribe writes the result JSON
        transcriptionStarter.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [`${transcriptionBucket.bucketArn}/transcript/*`],
        }));

        // Lambda that runs when Transcribe finishes a job and updates dynamodb + s3
        const transcriptionCompleter = new lambda.Function(this, `TranscriptionCompleter-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'handler.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../backend/lambda/transcription_completer'),
                {
                    bundling: {
                        image: lambda.Runtime.PYTHON_3_13.bundlingImage,
                        platform: 'linux/arm64',
                        command: [
                            'bash', '-c',
                            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
                        ],
                    },
                }
            ),
            functionName: `transcription_completer-${props?.stackName}`,
            timeout: cdk.Duration.seconds(360),
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName,
                REDACTER_FUNCTION_NAME: `transcription_redacter-${props?.stackName}`,
            },
        });

        // Grant the completer lambda permissions to read/write to the dynamodb table and s3 bucket
        transcriptionBucket.grantReadWrite(transcriptionCompleter, 'transcript/*');
        transcriptionTable.grantReadWriteData(transcriptionCompleter);

        // Let the completer read the userId tag from the Transcribe job
        transcriptionCompleter.addToRolePolicy(new iam.PolicyStatement({
            actions: ['transcribe:ListTagsForResource'],
            resources: ['*'],
        }));

        // Fires whenever a Transcribe job reached COMPLETED or FAILED
        new events.Rule(this, `TranscribeJobStateRule-${props?.stackName}`, {
            eventPattern: {
                source: ['aws.transcribe'],
                detailType: ['Transcribe Job State Change'],
                detail: {
                    TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
                },
            },
            targets: [new targets.LambdaFunction(transcriptionCompleter)],
        });

        // Lambda that reads raw.json, applies PHI redaction, writes redacted.json
        const transcriptionRedacter = new lambda.Function(this, `TranscriptionRedacter-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'handler.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../backend/lambda/deidentification'),
                {
                    bundling: {
                        image: lambda.Runtime.PYTHON_3_13.bundlingImage,
                        platform: 'linux/arm64',
                        command: [
                            'bash', '-c',
                            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
                        ],
                    },
                }
            ),
            functionName: `transcription_redacter-${props?.stackName}`,
            timeout: cdk.Duration.seconds(300),
            memorySize: 512,
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName,
            },
        });

        transcriptionBucket.grantRead(transcriptionRedacter, 'transcript/*');
        transcriptionBucket.grantPut(transcriptionRedacter, 'transcript/*');
        transcriptionTable.grantWriteData(transcriptionRedacter);
        transcriptionRedacter.grantInvoke(transcriptionCompleter);

        // Allow the redacter to call Bedrock (Claude) for PHI detection
        transcriptionRedacter.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: [
                'arn:aws:bedrock:*::foundation-model/*anthropic.claude-sonnet-4-5-20250929-v1:0',
                'arn:aws:bedrock:*:*:inference-profile/*anthropic.claude-sonnet-4-5-20250929-v1:0',
            ],
        }));

        // Cognito User Pool for authentication
        const userPool = new cognito.UserPool(this, `UserPool-${props?.stackName}`, {
            userPoolName: `transcription-user-pool-${props?.stackName}`,
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireUppercase: true,
                requireLowercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            mfa: cognito.Mfa.OFF,
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: props?.tableRemovalPolicy,
        });

        // User Pool Client
        const userPoolClient = new cognito.UserPoolClient(this, `UserPoolClient-${props?.stackName}`, {
            userPool,
            userPoolClientName: `transcription-client-${props?.stackName}`,
            authFlows: {
                userSrp: true,
                userPassword: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
                callbackUrls: ['http://localhost:5173/', 'http://localhost:3000/'],
                logoutUrls: ['http://localhost:5173/', 'http://localhost:3000/'],
            },
            preventUserExistenceErrors: true,
        });

        // API Gateway for the frontend to call the backend
        const api = new apigateway.RestApi(this, `TranscriptionApi-${props?.stackName}`, {
            restApiName: `transcription-api-${props?.stackName}`,
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });

        // Add CORS headers to error responses (401, 403, 500, etc.)
        api.addGatewayResponse('Unauthorized', {
            type: apigateway.ResponseType.UNAUTHORIZED,
            statusCode: '401',
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });

        api.addGatewayResponse('AccessDenied', {
            type: apigateway.ResponseType.ACCESS_DENIED,
            statusCode: '403',
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });

        api.addGatewayResponse('Default4XX', {
            type: apigateway.ResponseType.DEFAULT_4XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });

        api.addGatewayResponse('Default5XX', {
            type: apigateway.ResponseType.DEFAULT_5XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });

        // Cognito Authorizer for API Gateway
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
            this,
            `ApiAuthorizer-${props?.stackName}`,
            { cognitoUserPools: [userPool] },
        );

        // Lambda code asset for transcripts
        const transcriptsAsset = lambda.Code.fromAsset(
            path.join(__dirname, '../../backend/lambda/transcripts'),
            {
                bundling: {
                    image: lambda.Runtime.PYTHON_3_13.bundlingImage,
                    platform: 'linux/arm64',
                    command: [
                        'bash', '-c',
                        'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
                    ],
                },
            }
        );

        // Lambda to list all transcripts for the authenticated user
        const listTranscripts = new lambda.Function(this, `ListTranscripts-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'list.handler',
            code: transcriptsAsset,
            functionName: `list_transcripts-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: { TABLE_NAME: transcriptionTable.tableName },
        });
        transcriptionTable.grantReadData(listTranscripts);

        // Lambda to get a specific transcript for the authenticated user
        const getTranscript = new lambda.Function(this, `GetTranscript-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'get.handler',
            code: transcriptsAsset,
            functionName: `get_transcript-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: { TABLE_NAME: transcriptionTable.tableName },
        });
        transcriptionTable.grantReadData(getTranscript);

        // Lambda to update a specific transcript for the authenticated user
        const updateTranscript = new lambda.Function(this, `UpdateTranscript-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'update.handler',
            code: transcriptsAsset,
            functionName: `update_transcript-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName,
            },
        });
        transcriptionTable.grantReadWriteData(updateTranscript);
        transcriptionBucket.grantPut(updateTranscript, 'edited/*');

        // Lambda to delete a specific transcript for the authenticated user
        const deleteTranscript = new lambda.Function(this, `DeleteTranscript-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'delete.handler',
            code: transcriptsAsset,
            functionName: `delete_transcript-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName,
            },
        });
        transcriptionTable.grantReadWriteData(deleteTranscript);
        transcriptionBucket.grantDelete(deleteTranscript, 'audio/*');
        transcriptionBucket.grantDelete(deleteTranscript, 'transcript/*');
        transcriptionBucket.grantDelete(deleteTranscript, 'edited/*');

        // Lambda to update the metadata of a specific transcript for the authenticated user
        const updateMetadata = new lambda.Function(this, `UpdateMetadata-${props?.stackName}`, {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'metadata.handler',
            code: transcriptsAsset,
            functionName: `update_metadata-${props?.stackName}`,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: transcriptionTable.tableName,
                BUCKET_NAME: transcriptionBucket.bucketName,  
            },
        });
        transcriptionTable.grantReadWriteData(updateMetadata);

        // GET /transcripts - returns all transcripts for the authenticated user
        const transcriptsResource = api.root.addResource('transcripts');
        transcriptsResource.addMethod(
            'GET',
            new apigateway.LambdaIntegration(listTranscripts),
            { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
        );

        // GET /transcripts/{jobId} - returns a specific transcript for the authenticated user
        const transcriptByIdResource = transcriptsResource.addResource('{jobId}');
        transcriptByIdResource.addMethod(
            'GET',
            new apigateway.LambdaIntegration(getTranscript),
            { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
        );

        // PUT /transcripts/{jobId} - updates a specific transcript for the authenticated user
        transcriptByIdResource.addMethod(
            'PUT',
            new apigateway.LambdaIntegration(updateTranscript),
            { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
        );

        // DELETE /transcripts/{jobId} - deletes a specific transcript for the authenticated user
        transcriptByIdResource.addMethod(
            'DELETE',
            new apigateway.LambdaIntegration(deleteTranscript),
            { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
        );

        // PATCH /transcripts/{jobId}/metadata - updates the metadata of a specific transcript for the authenticated user
        transcriptByIdResource.addMethod(
            'PATCH',
            new apigateway.LambdaIntegration(updateMetadata),
            { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
        );

        // Identity Pool for temporary AWS credentials
        const identityPool = new cognito.CfnIdentityPool(this, `IdentityPool-${props?.stackName}`, {
            identityPoolName: `transcription-identity-pool-${props?.stackName}`,
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [{
                clientId: userPoolClient.userPoolClientId,
                providerName: userPool.userPoolProviderName,
            }],
        });

        // IAM role authenticating users and scoping each user to their own S3 folder
        const authenticatedRole = new iam.Role(this, `AuthenticatedRole-${props?.stackName}`, {
            assumedBy: new iam.FederatedPrincipal(
                'cognito-identity.amazonaws.com',
                {
                    StringEquals: {
                        'cognito-identity.amazonaws.com:aud': identityPool.ref,
                    },
                    'ForAnyValue:StringLike': {
                        'cognito-identity.amazonaws.com:amr': 'authenticated',
                    },
                },
                'sts:AssumeRoleWithWebIdentity',
            ),
        });

        // Upload: PutObject only on the user's own audio/ prefix
        authenticatedRole.addToPolicy(new iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [
                `${transcriptionBucket.bucketArn}/audio/\${cognito-identity.amazonaws.com:sub}/*`,
            ],
        }));

        // Read: GetObject on the user's own audio/, transcript/, and edited/
        authenticatedRole.addToPolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [
                `${transcriptionBucket.bucketArn}/audio/\${cognito-identity.amazonaws.com:sub}/*`,
                `${transcriptionBucket.bucketArn}/transcript/\${cognito-identity.amazonaws.com:sub}/*`,
                `${transcriptionBucket.bucketArn}/edited/\${cognito-identity.amazonaws.com:sub}/*`,
            ],
        }));

        // Attach the role to the Identity Pool's authenticated identities
        new cognito.CfnIdentityPoolRoleAttachment(this, `IdentityPoolRoles-${props?.stackName}`, {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn,
            },
        });

        // Amplify App (ready for Git connection)
        const transcriptionApp = new amplify.CfnApp(this, `TranscriptionApp-${props?.stackName}`, {
            name: `transcription-app-${props?.stackName}`,
            environmentVariables: [
                {name: 'VITE_USER_POOL_ID', value: userPool.userPoolId},
                {name: 'VITE_USER_POOL_CLIENT_ID', value: userPoolClient.userPoolClientId},
                {name: 'VITE_IDENTITY_POOL_ID', value: identityPool.ref},
                {name: 'VITE_S3_BUCKET_NAME', value: transcriptionBucket.bucketName},
                {name: 'VITE_API_URL', value: api.url},
                {name: 'VITE_AWS_REGION', value: this.region},
            ],
            buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*`,
            customRules: [
                {
                    source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>',
                    target: '/index.html',
                    status: '200',
                },
            ],
        });

        new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
        new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
        new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
        new cdk.CfnOutput(this, 'CognitoRegion', { value: this.region });
        new cdk.CfnOutput(this, 'BucketName', { value: transcriptionBucket.bucketName });
        new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.url });
        new cdk.CfnOutput(this, 'AmplifyAppId', { value: transcriptionApp.attrAppId });
    }
}
