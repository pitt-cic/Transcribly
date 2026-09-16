"""Agent wiring for the Bedrock-hosted model using BedrockConverseModel."""

from __future__ import annotations

import os
import boto3
from botocore.config import Config
from pydantic_ai import Agent, ToolOutput
from pydantic_ai.models.bedrock import BedrockConverseModel, BedrockModelSettings
from pydantic_ai.providers.bedrock import BedrockProvider
from .model import CompactAgentResponse
from .prompt import SYSTEM_PROMPT

# Initialize boto3 session and Bedrock client
# Disable boto3 retries - let worker-level retry handle throttling with proper backoff
session = boto3.Session(region_name=os.environ["AWS_REGION"])
bedrock_config = Config(retries={"max_attempts": 0})
bedrock_client = session.client("bedrock-runtime", config=bedrock_config)

# Get model ID from environment variable
DEFAULT_MODEL_ID = os.getenv(
    "BEDROCK_MODEL_ID",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
)

# Add model settings for caching
bedrock_settings = BedrockModelSettings(
    bedrock_cache_instructions=True, # Cache system prompt
    bedrock_cache_tool_definitions=True, # Cache output schema
)

# Initialize BedrockConverseModel
bedrock_model = BedrockConverseModel(
    DEFAULT_MODEL_ID,
    provider=BedrockProvider(bedrock_client=bedrock_client),
)

pii_agent = Agent[None, CompactAgentResponse](
    model=bedrock_model,
    instructions=SYSTEM_PROMPT,
    output_type=ToolOutput(CompactAgentResponse),
    model_settings=bedrock_settings,
)