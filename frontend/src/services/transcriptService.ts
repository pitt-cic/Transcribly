import { api } from './apiClient';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { cognitoConfig, s3Config } from '../config/cognito';
import { getCurrentSession } from './authService';

export interface TranscriptJob {
  jobId: string;
  filename?: string;
  title?: string;
  starred?: boolean;
  transcription_status: 'IN_PROGRESS' | 'TRANSCRIBING' | 'COMPLETED' | 'FAILED';
  uploaded_at: string;
  completed_at?: string;
  failed_at?: string;
  error_msg?: string;
  speaker_count?: number;
  word_count?: number;
  duration_sec?: string;
  transcript_key?: string; // S3 key to the transcript JSON
  audio_key?: string; // S3 key to the audio file
  edited_key?: string;
  edited_at?: string;
  redaction_status?: string;
}

class TranscriptionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionFailedError';
  }
}

export interface Word {
  word: string;
  start: string;
  end: string;
  confidence: number;
}

export interface RawSegment {
  speaker: string;
  start: string;
  end: string;
  text: string;
  words: Word[];
}

export interface RawTranscriptData {
  jobId: string;
  userId: string;
  completedAt: string;
  speakerCount: number;
  wordCount: number;
  durationSec: number;
  segments: RawSegment[];
}

/**
 * Get a specific transcript job by jobId
 */
export const getTranscriptJob = async (jobId: string): Promise<TranscriptJob> => {
  const response = await api.get(`/transcripts/${jobId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Transcript not found');
    }
    throw new Error(`Failed to fetch transcript job: ${response.statusText}`);
  }

  const data = await response.json();
  return data.job;
};

/**
 * Poll for transcript job completion
 * Returns the completed job or throws if it fails
 */
export const pollForTranscriptCompletion = async (
  jobId: string,
  onProgress?: (status: string) => void,
  maxAttempts: number = 120, // 10 minutes with 5s intervals
  intervalMs: number = 5000
): Promise<TranscriptJob> => {
  let attempts = 0;

  console.log(`[Polling] Starting to poll for jobId: ${jobId}`);

  while (attempts < maxAttempts) {
    try {
      console.log(`[Polling] Attempt ${attempts + 1}/${maxAttempts} for jobId: ${jobId}`);
      const job = await getTranscriptJob(jobId);

      console.log(`[Polling] Job status: ${job.transcription_status}`, job);
      onProgress?.(job.transcription_status);

      if (job.transcription_status === 'COMPLETED') {
        console.log(`[Polling] ✅ Transcription COMPLETED for jobId: ${jobId}`);
        return job;
      }

      if (job.transcription_status === 'FAILED') {
        console.error(`[Polling] ❌ Transcription FAILED for jobId: ${jobId}`, job.error_msg);
        throw new TranscriptionFailedError(job.error_msg || 'Transcription failed');
      }

      // Still in progress, wait and try again
      console.log(`[Polling] Status is ${job.transcription_status}, waiting ${intervalMs}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    } catch (error) {
      // If transcription explicitly failed, throw immediately
      if (error instanceof TranscriptionFailedError) {
        throw error;
      }

      // 404 "Transcript not found" is expected in early stages - keep retrying
      // The Lambda may not have created the DynamoDB entry yet
      if (error instanceof Error && error.message.includes('Transcript not found')) {
        console.log(`Job ${jobId} not found yet, waiting for Lambda to process... (attempt ${attempts + 1})`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
        continue;
      }

      // Network error or other issue - wait and retry
      console.warn(`Polling attempt ${attempts + 1} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }
  }

  throw new Error('Transcription timeout: Job did not complete in time');
};

/**
 * Fetch the actual transcript data from S3
 */
export const fetchTranscriptFromS3 = async (_jobId: string, transcriptKey?: string): Promise<RawTranscriptData> => {
  try {
    const session = await getCurrentSession();
    const idToken = session.getIdToken().getJwtToken();

    const s3Client = new S3Client({
      region: s3Config.region,
      credentials: fromCognitoIdentityPool({
        clientConfig: { region: cognitoConfig.region },
        identityPoolId: cognitoConfig.identityPoolId,
        logins: {
          [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: idToken,
        },
      }),
    });

    // Use transcriptKey from API response if available, otherwise construct it
    // The API should provide the full key, but fallback to constructing it
    let key = transcriptKey;
    if (!key) {
      // Get identityId to construct the path
      // Actually, we should get the transcript_key from the completed job response
      throw new Error('transcript_key not provided from API');
    }

    const command = new GetObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No transcript data returned from S3');
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString();
    const transcriptData: RawTranscriptData = JSON.parse(bodyString);

    return transcriptData;
  } catch (error) {
    console.error('Error fetching transcript from S3:', error);
    throw new Error(`Failed to fetch transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Paginated transcripts response
 */
export interface PaginatedTranscriptsResponse {
  transcripts: TranscriptJob[];
  nextToken?: string;
  hasMore: boolean;
}

/**
 * List transcripts with pagination support
 */
export const listTranscriptsPaginated = async (
  limit: number = 20,
  nextToken?: string
): Promise<PaginatedTranscriptsResponse> => {
  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  if (nextToken) {
    params.append('nextToken', nextToken);
  }

  const response = await api.get(`/transcripts?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch transcripts: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    transcripts: data.transcripts || [],
    nextToken: data.nextToken,
    hasMore: data.hasMore || false,
  };
};

/**
 * List all transcripts for the authenticated user (legacy)
 */
export const listTranscripts = async (): Promise<TranscriptJob[]> => {
  const response = await api.get('/transcripts');

  if (!response.ok) {
    throw new Error(`Failed to fetch transcripts: ${response.statusText}`);
  }

  const data = await response.json();
  return data.transcripts;
};

/**
 * Delete a transcript and all associated S3 objects
 */
export const deleteTranscript = async (jobId: string): Promise<{ deleted: string }> => {
  const response = await api.delete(`/transcripts/${jobId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Transcript not found');
    }
    if (response.status === 403) {
      throw new Error('Permission denied. The backend may not be deployed or you need to sign in again.');
    }

    // Try to get error details from response
    try {
      const error = await response.json();
      throw new Error(error.message || error.error || `Failed to delete transcript: ${response.statusText}`);
    } catch {
      throw new Error(`Failed to delete transcript: ${response.statusText}`);
    }
  }

  const data = await response.json();
  return data;
};

/**
 * Update transcript title
 */
export const updateTranscriptTitle = async (jobId: string, title: string): Promise<{ title: string }> => {
  const response = await api.patch(`/transcripts/${jobId}`, { title });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Transcript not found');
    }
    if (response.status === 403) {
      throw new Error('Permission denied. The backend may not be deployed or you need to sign in again.');
    }
    if (response.status === 400) {
      try {
        const error = await response.json();
        throw new Error(error.error || 'Invalid title');
      } catch {
        throw new Error('Invalid title');
      }
    }
    throw new Error(`Failed to update title: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

/**
 * Update transcript starred status
 */
export const updateTranscriptStarred = async (jobId: string, starred: boolean): Promise<{ starred: boolean }> => {
  const response = await api.patch(`/transcripts/${jobId}`, { starred });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Transcript not found');
    }
    if (response.status === 403) {
      throw new Error('Permission denied. The backend may not be deployed or you need to sign in again.');
    }
    throw new Error(`Failed to update starred status: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

/**
 * Save edited transcript segments (in original transcript format with word-level data)
 */
export const updateTranscriptSegments = async (
  jobId: string,
  segments: Array<{
    speaker: string;
    start: string;
    end: string;
    text: string;
    words: Word[];
  }>
): Promise<{ editedKey: string; editedAt: string }> => {
  const response = await api.put(`/transcripts/${jobId}`, { segments });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Transcript not found');
    }
    if (response.status === 403) {
      throw new Error('Permission denied. The backend may not be deployed or you need to sign in again.');
    }
    if (response.status === 409) {
      throw new Error('Transcript is not ready to edit');
    }
    if (response.status === 400) {
      try {
        const error = await response.json();
        throw new Error(error.error || 'Invalid segment data');
      } catch {
        throw new Error('Invalid segment data');
      }
    }
    throw new Error(`Failed to save transcript: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

/**
 * Fetch audio file from S3 and return a blob URL
 */
export const fetchAudioFromS3 = async (audioKey: string): Promise<string> => {
  try {
    const session = await getCurrentSession();
    const idToken = session.getIdToken().getJwtToken();

    const s3Client = new S3Client({
      region: s3Config.region,
      credentials: fromCognitoIdentityPool({
        clientConfig: { region: cognitoConfig.region },
        identityPoolId: cognitoConfig.identityPoolId,
        logins: {
          [`cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`]: idToken,
        },
      }),
    });

    const command = new GetObjectCommand({
      Bucket: s3Config.bucketName,
      Key: audioKey,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No audio data returned from S3');
    }

    // Convert stream to blob
    const blob = await response.Body.transformToByteArray();
    const audioBlob = new Blob([blob], { type: 'audio/mpeg' });

    // Create a blob URL
    const blobUrl = URL.createObjectURL(audioBlob);
    return blobUrl;
  } catch (error) {
    console.error('Error fetching audio from S3:', error);
    throw new Error(`Failed to fetch audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
