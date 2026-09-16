import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient, GetIdCommand } from '@aws-sdk/client-cognito-identity';
import { cognitoConfig, s3Config } from '../config/cognito';
import { getCurrentSession } from './authService';

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
}

let cachedIdentityId: string | null = null;

const getIdentityId = async (): Promise<string> => {
  if (cachedIdentityId) {
    return cachedIdentityId;
  }

  const session = await getCurrentSession();
  const idToken = session.getIdToken().getJwtToken();

  const identityClient = new CognitoIdentityClient({ region: cognitoConfig.region });
  const response = await identityClient.send(
    new GetIdCommand({
      IdentityPoolId: cognitoConfig.identityPoolId,
      Logins: {
        [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: idToken,
      },
    })
  );

  if (!response.IdentityId) {
    throw new Error('Failed to get Identity ID');
  }

  cachedIdentityId = response.IdentityId;
  return cachedIdentityId;
};

const getS3Client = async (): Promise<S3Client> => {
  const session = await getCurrentSession();
  const idToken = session.getIdToken().getJwtToken();

  return new S3Client({
    region: s3Config.region,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: cognitoConfig.region },
      identityPoolId: cognitoConfig.identityPoolId,
      logins: {
        [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: idToken,
      },
    }),
  });
};

export const clearS3Client = () => {
  cachedIdentityId = null;
};

export const getUserIdentityId = async (): Promise<string> => {
  return await getIdentityId();
};

const generateJobId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

export const uploadAudioFile = async (
  file: File,
  deidentify: boolean = false,
  onProgress?: (progress: number) => void
): Promise<{ key: string; jobId: string }> => {
  try {
    const client = await getS3Client();
    const identityId = await getIdentityId();

    // Get user's Cognito subject (sub) from the session
    const session = await getCurrentSession();
    const userSub = session.getIdToken().payload['sub'] as string;

    const jobId = generateJobId();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `audio/${identityId}/${jobId}/${sanitizedFileName}`;

    const fileBuffer = await file.arrayBuffer();

    const command = new PutObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
      Body: new Uint8Array(fileBuffer),
      ContentType: file.type || 'audio/mpeg',
      Metadata: {
        'sub': userSub,  // Must match what Lambda expects (no dash)
        'jobid': jobId,
        'filename': file.name,
        'deidentify': deidentify ? 'true' : 'false',
      },
    });

    await client.send(command);

    if (onProgress) {
      onProgress(100);
    }

    return { key, jobId };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export interface UploadResult {
  fileName: string;
  key: string;
  jobId: string;
}

export const uploadMultipleAudioFiles = async (
  files: File[],
  deidentify: boolean = false,
  onFileProgress?: (fileName: string, progress: number) => void,
  onFileComplete?: (fileName: string, key: string, jobId: string) => void,
  onFileError?: (fileName: string, error: string) => void
): Promise<{ successful: UploadResult[]; failed: string[] }> => {
  const results = {
    successful: [] as UploadResult[],
    failed: [] as string[],
  };

  for (const file of files) {
    try {
      const { key, jobId } = await uploadAudioFile(
        file,
        deidentify,
        (progress) => onFileProgress?.(file.name, progress)
      );
      results.successful.push({ fileName: file.name, key, jobId });
      onFileComplete?.(file.name, key, jobId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.failed.push(file.name);
      onFileError?.(file.name, errorMessage);
    }
  }

  return results;
};
