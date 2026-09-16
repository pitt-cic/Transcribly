import json
import os
from datetime import datetime, timezone
import boto3

s3 = boto3.client('s3')
transcribe = boto3.client('transcribe')
dynamodb = boto3.resource('dynamodb')
lam = boto3.client('lambda')
BUCKET = os.environ['BUCKET_NAME']
TABLE = os.environ['TABLE_NAME']
REDACTER_FUNCTION_NAME = os.environ['REDACTER_FUNCTION_NAME']

def handler(event, context):
    table = dynamodb.Table(TABLE)
    job_name = event['detail']['TranscriptionJobName']
    status = event['detail']['TranscriptionJobStatus']

    job_id = job_name
    region = os.environ['AWS_REGION']
    account_id = context.invoked_function_arn.split(':')[4]
    job_arn = f'arn:aws:transcribe:{region}:{account_id}:transcription-job/{job_name}'
    user_id = next(
        t['Value'] for t in
        transcribe.list_tags_for_resource(ResourceArn=job_arn)['Tags']
        if t['Key'] == 'userId'
    )
    now = datetime.now(timezone.utc).isoformat()

    # Transcription failed
    if status == 'FAILED':
        error_msg = event['detail'].get('FailureReason', 'Unknown error')
        table.update_item(
            Key={'userId': user_id, 'jobId': job_id},
            UpdateExpression='''SET
                transcription_status = :status,
                failed_at = :failed_at,
                error_msg = :error_msg
            ''',
            ExpressionAttributeValues={
                ':status': 'FAILED',
                ':failed_at': now,
                ':error_msg': error_msg,
            },
        )
        print(f'Job {job_name} failed: {error_msg}')
        return

    # Transcription success 
    transcript_key = f'transcript/{user_id}/{job_id}/raw.json'
    response = s3.get_object(Bucket=BUCKET, Key=transcript_key)
    raw = json.loads(response['Body'].read())
    results = raw['results']

    # Diarization - build a map of each word's start_time → speaker label
    time_to_speaker = {}
    speaker_labels = results.get('speaker_labels', {})
    for segment in speaker_labels.get('segments', []):
        speaker = segment['speaker_label']
        for item in segment.get('items', []):
            time_to_speaker[item['start_time']] = speaker
    
    # Walk through the items (words + punctuation) and group them into continuous speaker turns
    segments = []
    current_speaker = None
    current_words = []

    for item in results.get('items', []):

        # Punctuation has no start time, attach it to the current segment
        if item['type'] == 'punctuation':
            if current_words:
                current_words[-1]['word'] += item['alternatives'][0]['content']
            continue

        word = item['alternatives'][0]['content']
        start = item['start_time']
        end = item['end_time']
        speaker = time_to_speaker.get(start, current_speaker or 'spk_0')

        # New speaker — save the previous segment and start a new one
        if speaker != current_speaker:
            if current_words:
                segments.append({
                    'speaker': current_speaker,
                    'start': current_words[0]['start'],
                    'end': current_words[-1]['end'],
                    'text': ' '.join(w['word'] for w in current_words),
                    'words': current_words,
                })
            current_speaker = speaker
            current_words = []

        current_words.append({
            'word': word, 
            'start': start, 
            'end': end,
            'confidence': float(item['alternatives'][0]['confidence'])
        })

    # Flush the last segment
    if current_words:
        segments.append({
            'speaker': current_speaker,
            'start': current_words[0]['start'],
            'end': current_words[-1]['end'],
            'text': ' '.join(w['word'] for w in current_words),
            'words': current_words,
        })

    # Summary stats for dynamoDB
    speaker_count = len({s['speaker'] for s in segments})
    word_count = sum(len(s['text'].split()) for s in segments)
    duration = float(segments[-1]['end']) if segments else 0

    # Overwite raw.json with clean parsed format
    parsed = {
        'jobId': job_id,
        'userId': user_id,
        'completedAt': now,
        'speakerCount': speaker_count,
        'wordCount': word_count,
        'durationSec': duration,
        'segments': segments,
    }

    s3.put_object(
        Bucket=BUCKET,
        Key=transcript_key,
        Body=json.dumps(parsed, indent=2),
        ContentType='application/json',
    )

    # Update DynamoDB — status flips to COMPLETED with summary stats.
    table.update_item(
        Key={'userId': user_id, 'jobId': job_id},
        UpdateExpression='''SET
            transcription_status = :status,
            completed_at = :completed_at,
            transcript_key = :transcript_key, 
            speaker_count = :speaker_count, 
            word_count = :word_count, 
            duration_sec = :duration_sec
        ''',
        ExpressionAttributeValues={
            ':status': 'COMPLETED',
            ':completed_at': now,
            ':transcript_key': transcript_key,
            ':speaker_count': speaker_count,
            ':word_count': word_count,
            ':duration_sec': str(duration),
        },
    )
    print(f'Job {job_name} completed: {speaker_count} speakers, {word_count} words')

    # Check if this job requested PHI redaction
    item = table.get_item(Key={'userId': user_id, 'jobId': job_id}).get('Item', {})
    deidentify = item.get('deidentify', False)

    if deidentify:
        # Synchronously invoke the redacter so transcript_key in DynamoDB already
        # points to the redacted file before this function returns.
        redacted_key = f'transcript/{user_id}/{job_id}/redacted.json'
        resp = lam.invoke(
            FunctionName=REDACTER_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps({
                'userId': user_id,
                'jobId': job_id,
                'rawKey': transcript_key,
                'redactedKey': redacted_key,
            }).encode(),
        )
        # Read payload immediately — StreamingBody is not seekable and must be consumed once
        resp_payload = json.loads(resp['Payload'].read())
        if 'FunctionError' in resp:
            raise RuntimeError(f'Redacter failed: {resp_payload}')
    else:
        table.update_item(
            Key={'userId': user_id, 'jobId': job_id},
            UpdateExpression='SET redaction_status = :status',
            ExpressionAttributeValues={':status': 'SKIPPED'},
        )
        print(f'Job {job_name}: PHI redaction skipped by user preference')