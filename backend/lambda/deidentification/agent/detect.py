"""PHI detection entrypoint."""

from __future__ import annotations
from .agent import pii_agent
from .model import AgentResponse, CompactAgentResponse, expand_compact_response


async def detect_phi_in_text(text: str) -> AgentResponse:
    """Detect PHI in flattened transcript text.

    Args:
        text: The combined transcript text to analyze.

    Returns:
        AgentResponse with a flat list of detected PIIEntity.
    """

    # If the text is empty or whitespace, return an empty AgentResponse
    if not text or not text.strip():
        return AgentResponse(pii_entities=[])

    # Use the PHI detection agent to analyze the text and return the response
    prompt = f"Document text to analyze:\n<document>\n{text}\n</document>"
    result = await pii_agent.run(prompt)
    compact: CompactAgentResponse = result.output
    return expand_compact_response(compact)