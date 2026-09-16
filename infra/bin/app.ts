#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import {InfraStack} from '../lib/infra-stack';

const app = new cdk.App();

// Determine the dynamic values cast as strings
const devName = app.node.tryGetContext('devName') as string | undefined;
const stageName = app.node.tryGetContext('stageName') as string;

if ((!devName && stageName != 'prod') || !stageName) {
    throw new Error('Please provide devName and stageName: cdk deploy -c devName=yourname -c stageName=dev|beta|prod');
}

const isProd = stageName === 'prod';
const stackName = isProd
    ? `transcription-stack-${stageName}`
    : `transcription-stack-${devName}-${stageName}`;

// Removal policy based on the stage
const removalPolicy = isProd
    ? cdk.RemovalPolicy.RETAIN
    : cdk.RemovalPolicy.DESTROY

// Pass everything explicityly via custom Props
new InfraStack(app, stackName, {
    stackName,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'Transcribes audio files',
    developerName: isProd ? undefined : devName,
    stageName: stageName,
    tableRemovalPolicy: removalPolicy,
});
