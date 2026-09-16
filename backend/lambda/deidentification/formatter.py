"""Turns a PHI value into a stable label, so the same value always gets the same tag"""

class RedactionFormatter:
    def __init__(self):
        self._map: dict[tuple[str, str], str] = {}
        self._counters: dict[str, int] = {}

    def label_for(self, entity_type: str, entity_value: str) -> str:
        key = (entity_type, entity_value)
        if key not in self._map:
            count = self._counters.get(entity_type, 0) + 1
            self._counters[entity_type] = count
            self._map[key] = f"[{entity_type.upper()}_{count}]"
        return self._map[key]
