from boto3.dynamodb.conditions import Key
from helper import dynamodb, TABLE, response, get_user_sub, public_item


def handler(event, context):
    table = dynamodb.Table(TABLE)
    sub = get_user_sub(event)
    job_id = event['pathParameters']['jobId']

    # Query GSI by subject + jobId 
    result = table.query(
        IndexName='subIndex',
        KeyConditionExpression=Key('subject').eq(sub) & Key('jobId').eq(job_id),
    )

    items = result.get('Items', [])
    if not items:
        return response(404, {'error': 'Job not found'})

    return response(200, {'job': public_item(items[0])})
