"""Invoked after transcription is complete, ties together PHI detection and redaction, writes redacted transcript to S3, updates DynamoDB."""

import json
import os
import re
import boto3
import asyncio
from datetime import datetime, timezone
from formatter import RedactionFormatter
from redactor import PIIEntity, redact_segment
from agent import detect_phi_in_text

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
BUCKET = os.environ['BUCKET_NAME']
TABLE = os.environ['TABLE_NAME']


def detect_phi(segments: list[dict]) -> list[PIIEntity]:
    """Flatten segments → text, run detection, convert pydantic → dataclass PIIEntity."""

    text = '\n'.join(s.get('text', '') for s in segments if s.get('text'))
    if not text.strip():
        return []
    response = asyncio.run(detect_phi_in_text(text))
    return [PIIEntity(type=e.type, value=e.value) for e in response.pii_entities]


def handler(event: dict, context) -> dict:
    """
    Expected event payload (sent by transcription_completer via synchronous invoke):
    {
        "userId":      "us-east-1:xxxxxxxx-...",
        "jobId":       "1234567890-abc123",
        "rawKey":      "transcript/{userId}/{jobId}/raw.json",
        "redactedKey": "transcript/{userId}/{jobId}/redacted.json"
    }
    """
    user_id = event['userId']
    job_id = event['jobId']
    raw_key = event['rawKey']
    redacted_key = event['redactedKey']

    # Read the parsed transcript written by completer
    obj = s3.get_object(Bucket=BUCKET, Key=raw_key)
    transcript = json.loads(obj['Body'].read())

    # Detect PHI across all segments 
    entities = detect_phi(transcript['segments'])

    # Redact every segment
    formatter = RedactionFormatter()
    redacted_segments = [
        redact_segment(seg, entities, formatter)
        for seg in transcript['segments']
    ]

    # HIPAA safety check: verify every detected entity was actually redacted
    redaction_incomplete = False
    unmapped_entities = []
    if entities:
        all_redacted_text = ' '.join(seg['text'] for seg in redacted_segments)
        for e in entities:
            clean_value = e.value.strip()
            if clean_value and re.search(r'\b' + re.escape(clean_value) + r'\b', all_redacted_text, re.IGNORECASE):
                unmapped_entities.append({'type': e.type, 'value': e.value})

        if unmapped_entities:
            redaction_incomplete = True
            type_counts = {}
            for u in unmapped_entities:
                type_counts[u['type']] = type_counts.get(u['type'], 0) + 1
            print(f'[redacter] WARNING Job {job_id}: {len(unmapped_entities)} entities not redacted: {type_counts}')

    # Build the redacted document 
    redacted_doc = {
        **transcript,
        'segments': redacted_segments,
        'redactedAt': datetime.now(timezone.utc).isoformat(),
    }
    if redaction_incomplete:
        redacted_doc['redactionIncomplete'] = True

    # Write redacted.json
    s3.put_object(
        Bucket=BUCKET,
        Key=redacted_key,
        Body=json.dumps(redacted_doc, indent=2),
        ContentType='application/json',
    )

    # Update DynamoDB
    redaction_status = 'NEEDS_REVIEW' if redaction_incomplete else 'COMPLETE'
    table = dynamodb.Table(TABLE)
    table.update_item(
        Key={'userId': user_id, 'jobId': job_id},
        UpdateExpression='''SET 
            transcript_key = :transcript_key, 
            unredacted_key = :unredacted_key, 
            redaction_status = :redaction_status
        ''',
        ExpressionAttributeValues={
            ':transcript_key': redacted_key,
            ':unredacted_key': raw_key,
            ':redaction_status': redaction_status,
        },
    )

    print(f'[redacter] Job {job_id}: wrote {redacted_key}, status={redaction_status}')
    return {'status': 'ok', 'redactedKey': redacted_key, 'redactionStatus': redaction_status}
