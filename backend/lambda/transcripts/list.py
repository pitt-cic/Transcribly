from boto3.dynamodb.conditions import Key
from helper import dynamodb, TABLE, response, get_user_sub, public_item
import json
import base64


def handler(event, context):
    table = dynamodb.Table(TABLE)
    sub = get_user_sub(event)

    # Get pagination parameters from query string
    query_params = event.get('queryStringParameters') or {}

    # Parse limit parameter (default 15, cap at 100)
    try:
        page_size = int(query_params.get('limit', 15))
        page_size = min(max(1, page_size), 100)  # Ensure between 1 and 100
    except (ValueError, TypeError):
        page_size = 15

    # Parse nextToken parameter
    next_token = query_params.get('nextToken')

    # Build query parameters
    query_kwargs = {
        'IndexName': 'subIndex',
        'KeyConditionExpression': Key('subject').eq(sub),
        'Limit': page_size,
    }

    # If nextToken provided, decode and use as ExclusiveStartKey
    if next_token:
        try:
            start_key = json.loads(base64.b64decode(next_token).decode('utf-8'))
            query_kwargs['ExclusiveStartKey'] = start_key
        except Exception as e:
            return response(400, {'error': 'Invalid nextToken parameter'})

    # Query DynamoDB
    result = table.query(**query_kwargs)

    items = result.get('Items', [])

    # Build response (no sorting here - client will sort all items)
    response_body = {
        'transcripts': [public_item(i) for i in items],
        'hasMore': 'LastEvaluatedKey' in result,
    }

    # Encode LastEvaluatedKey as nextToken if present
    if 'LastEvaluatedKey' in result:
        next_token_encoded = base64.b64encode(
            json.dumps(result['LastEvaluatedKey']).encode('utf-8')
        ).decode('utf-8')
        response_body['nextToken'] = next_token_encoded

    return response(200, response_body)
