import { CognitoUserPool } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: import.meta.env.VITE_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
};

export const userPool = new CognitoUserPool(poolData);

export const cognitoConfig = {
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  userPoolId: poolData.UserPoolId,
  clientId: poolData.ClientId,
  identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID || '',
};

export const s3Config = {
  bucketName: import.meta.env.VITE_S3_BUCKET_NAME || '',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
};
