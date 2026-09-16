import json
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key
from helper import dynamodb, s3, BUCKET, TABLE, response, get_user_sub


def handler(event, context):
    table = dynamodb.Table(TABLE)
    sub = get_user_sub(event)
    job_id = event['pathParameters']['jobId']

    # Find the job via GSI 
    result = table.query(
        IndexName='subIndex',
        KeyConditionExpression=Key('subject').eq(sub) & Key('jobId').eq(job_id),
    )

    items = result.get('Items', [])
    if not items:
        return response(404, {'error': 'Job not found'})

    job = items[0]
    user_id = job['userId']

    if job.get('transcription_status') != 'COMPLETED':
        return response(409, {'error': 'Transcript is not ready to edit'})

    # Parse the edited transcript JSON from the body
    try:
        body = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return response(400, {'error': 'Invalid JSON body'})

    segments = body.get('segments')
    if segments is None:
        return response(400, {'error': 'segments is required'})

    # Store the edited version in the same format as the original transcript
    edited_key = f'edited/{user_id}/{job_id}/transcript.json'

    edited_doc = {
        'jobId': job_id,
        'userId': user_id,
        'completedAt': datetime.now(timezone.utc).isoformat(),
        'editedAt': datetime.now(timezone.utc).isoformat(),
        'segments': segments,
    }

    s3.put_object(
        Bucket=BUCKET,
        Key=edited_key,
        Body=json.dumps(edited_doc).encode('utf-8'),
        ContentType='application/json',
    )

    now = datetime.now(timezone.utc).isoformat()

    # Mark on the row that an edited version exists
    table.update_item(
        Key={'userId': user_id, 'jobId': job_id},
        UpdateExpression='''SET 
            edited_key = :edited_key, 
            edited_at = :edited_at
        ''',
        ExpressionAttributeValues={
            ':edited_key': edited_key,
            ':edited_at': now
        },
    )

    return response(200, {'editedKey': edited_key, 'editedAt': now})