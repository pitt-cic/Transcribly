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

    # Delete all S3 objects for this job
    for key in (job.get('audio_key'), job.get('transcript_key'),
                job.get('unredacted_key'), job.get('edited_key')):
        if key:
            s3.delete_object(Bucket=BUCKET, Key=key)

    # Delete the DynamoDB row.
    table.delete_item(Key={'userId': user_id, 'jobId': job_id})

    return response(200, {'deleted': job_id})
