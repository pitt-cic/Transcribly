import json
import os
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')   
TABLE = os.environ['TABLE_NAME']
BUCKET = os.environ.get('BUCKET_NAME')

INTERNAL_FIELDS = {'userId', 'subject', 'unredacted_key'}

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,PUT',
}


# Helps with serializing Decimal objects to JSON needed for DynamoDB items
def public_item(item):
    return {k: v for k, v in item.items() if k not in INTERNAL_FIELDS}


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


# Helper function to format a response with CORS headers and JSON body
def response(status, body):
    return {
        'statusCode': status,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, default=decimal_default),
    }


# Helper function to get the user sub from the Cognito authorizer claims
def get_user_sub(event):
    return event['requestContext']['authorizer']['claims']['sub']
