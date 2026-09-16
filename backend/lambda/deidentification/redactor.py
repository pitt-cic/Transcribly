"""Takes the detection output from the agent and redacts the transcript segments accordingly."""

import re
import string
from dataclasses import dataclass
from formatter import RedactionFormatter

TRAILING_PUNCT = ''.join(string.punctuation)


@dataclass
class PIIEntity:
    type: str   # ex "person_name", "date", "phone_number"
    value: str  # ex "John Smith", "March 3rd", "555-0100"


def strip_trailing_punct(word: str) -> str:
    """Returns a copy of word with trailing punctuation removed."""

    return word.rstrip(TRAILING_PUNCT)


def build_spans(normalized: list[str]) -> tuple[str, list[tuple[int, int]]]:
    """Builds the joined text and each word's char range"""

    spans = []
    parts = []
    pos = 0
    for i, w in enumerate(normalized):
        if i > 0:
            parts.append(' ')
            pos += 1
        spans.append((pos, pos + len(w)))
        parts.append(w)
        pos += len(w)
    return ''.join(parts), spans


def word_at_char(pos: int, spans: list[tuple[int, int]]) -> int | None:
    """Returns the index of the word whose span contains char position"""

    for i, (s, e) in enumerate(spans):
        if s <= pos < e:
            return i
    return None


def redact_segment(
    segment: dict,
    entities: list[PIIEntity],
    formatter: RedactionFormatter,
) -> dict:
    """
    Returns a new segment dict with PHI replaced by stable labels.
    The original segment dict is not mutated.

    Multi-word entities (e.g. "John Smith" spanning two word entries) are
    collapsed into a single word entry with redacted=True and timing spanning
    from the first to the last matched word.

    Handles punctuation attached to word entries (e.g. "John," in words but
    "John Smith" in the entity value) by matching against a normalized copy
    of the text, then splicing into the original words list.
    """
    words = segment['words']
    if not words or not entities:
        return {**segment}

    normalized = [strip_trailing_punct(w['word']) for w in words]
    normalized_joined, spans = build_spans(normalized)

    # Collect replacements: (first_word_idx, last_word_idx, replacement_entry)
    replacements: list[tuple[int, int, dict]] = []
    used_chars: set[int] = set()

    # Longest entities first — prevents a shorter sub-entity from consuming characters that a longer entity should own
    for entity in sorted(entities, key=lambda e: len(e.value), reverse=True):
        # Strip surrounding whitespace so leading/trailing spaces don't break \b anchoring
        clean_value = entity.value.strip()
        if not clean_value:
            continue
        pattern = r'\b' + re.escape(clean_value) + r'\b'
        for m in re.finditer(pattern, normalized_joined, re.IGNORECASE):
            start_char = m.start()
            end_char = m.end() - 1

            # Check the full matched span for overlap, not just the start char
            if any(c in used_chars for c in range(start_char, end_char + 1)):
                continue

            first_idx = word_at_char(start_char, spans)
            last_idx = word_at_char(end_char, spans)

            # Skip if match landed in a space (shouldn't happen with \b patterns)
            if first_idx is None or last_idx is None:
                continue

            label = formatter.label_for(entity.type, entity.value)
            replacements.append((first_idx, last_idx, {
                'word': label,
                'start': words[first_idx]['start'],
                'end': words[last_idx]['end'],
                'confidence': 1.0,
                'redacted': True,
            }))
            used_chars.update(range(start_char, end_char + 1))

    if not replacements:
        return {**segment}

    # Apply highest-index-first so earlier splices don't shift remaining indices
    new_words = list(words)
    for first, last, replacement in sorted(replacements, key=lambda r: r[0], reverse=True):
        new_words[first:last + 1] = [replacement]

    new_text = ' '.join(w['word'] for w in new_words)
    return {**segment, 'text': new_text, 'words': new_words}
