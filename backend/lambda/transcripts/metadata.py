import json
from boto3.dynamodb.conditions import Key
from helper import dynamodb, TABLE, response, get_user_sub


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

    user_id = items[0]['userId']

    # Parse the new title from the request body
    try:
        body = json.loads(event.get('body') or '{}')
    except json.JSONDecodeError:
        return response(400, {'error': 'Invalid JSON body'})

    updates = []
    values = {}

    # Update the starred status if provided
    if 'starred' in body:
        updates.append('starred = :starred')
        values[':starred'] = bool(body['starred'])

    # Update the title if provided
    if 'title' in body:
        new_title = (body.get('title') or '').strip()
        if not new_title:
            return response(400, {'error': 'title cannot be empty'})
        updates.append('title = :title')
        values[':title'] = new_title

    # If no valid fields to update, return an error
    if not updates:
        return response(400, {'error': 'No valid fields to update'})
    
    # Update the title in DynamoDB
    table.update_item(
        Key={'userId': user_id, 'jobId': job_id},
        UpdateExpression='SET ' + ', '.join(updates),
        ExpressionAttributeValues=values,
    )

    # Return what was updated
    updated = {k.lstrip(':'): v for k, v in values.items()}
    return response(200, updated)