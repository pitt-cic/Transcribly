import json
import os
from datetime import datetime, timezone
from urllib.parse import unquote_plus
import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource('dynamodb')
transcribe = boto3.client('transcribe')
s3 = boto3.client('s3')
TABLE = os.environ['TABLE_NAME']
BUCKET = os.environ['BUCKET_NAME']


# Maps the uploaded file's extension to the MediaFormat string Transcribe wants.
EXT_TO_FORMAT = {
    'mp3': 'mp3', 'mp4': 'mp4', 'm4a': 'mp4', 'wav': 'wav',
    'flac': 'flac', 'ogg': 'ogg', 'webm': 'webm', 'amr': 'amr',
}


def handler(event, context):
    table = dynamodb.Table(TABLE)

    for record in event['Records']:
        s3_event = json.loads(record['body']) # SQS message can contain multiple s3 object event

        for s3_record in s3_event.get('Records', []):
            bucket = s3_record['s3']['bucket']['name']
            key = unquote_plus(s3_record['s3']['object']['key'])

            # Key: audio/{userId}/{jobId}/{filename}
            parts = key.split('/')
            if len(parts) < 4 or parts[0] != 'audio':
                print(f'Unexpected key: {key}')
                continue

            user_id, job_id, file_name = parts[1], parts[2], parts[3]
            
            # Reject files transcribe can't handle before calling the API
            ext = file_name.rsplit('.', 1)[-1].lower()
            media_format = EXT_TO_FORMAT.get(ext)
            if not media_format:
                print(f'Unsupported format "{ext}" for {key}')
                continue

            job_name = job_id

            # Transcribe
            try:
                transcribe.start_transcription_job(
                    TranscriptionJobName = job_name,
                    LanguageCode = 'en-US',
                    MediaFormat = media_format,
                    Media = {'MediaFileUri': f's3://{bucket}/{key}'},
                    OutputBucketName = BUCKET,
                    OutputKey = f'transcript/{user_id}/{job_id}/raw.json',
                    Settings = {
                        'ShowSpeakerLabels': True,
                        'MaxSpeakerLabels': 15,
                    },
                    Tags=[{'Key': 'userId', 'Value': user_id}],
                )
            except ClientError as e:
                # Rejects duplicate job names
                if e.response['Error']['Code'] == 'ConflictException':
                    print(f'Job {job_name} already exists, skipping')
                else:
                    raise
                    
            now = datetime.now(timezone.utc).isoformat()

            head = s3.head_object(Bucket=bucket, Key=key)
            metadata = head.get('Metadata', {})
            sub = metadata.get('sub', user_id)
            deidentify = metadata.get('deidentify', 'false').lower() == 'true'

            # update dynamodb and status
            table.update_item(
                Key={'userId': user_id, 'jobId': job_id },
                UpdateExpression = '''SET
                    transcription_status = :status,
                    audio_key = :audio_key,
                    filename = :filename,
                    title = if_not_exists(title, :title),
                    starred = if_not_exists(starred, :starred),
                    uploaded_at = if_not_exists(uploaded_at, :uploaded_at),
                    subject = :subject,
                    deidentify = :deidentify
                ''',
                ExpressionAttributeValues = {
                    ':status': 'TRANSCRIBING',
                    ':audio_key': key,
                    ':filename': file_name,
                    ':title': file_name,
                    ':starred': False,
                    ':subject': sub,
                    ':uploaded_at': now,
                    ':deidentify': deidentify,
                },
            )
