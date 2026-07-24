"""
Parser for the cerebral /api/chat streaming wire format.

Python port of chunk-web's `processChunk` (src/lib/api/chat.ts). The stream is
chunked text/plain, consumed line-wise. Each line is either:

  - a heartbeat (a line that is exactly one space — the backend's " \\n" keepalive)
  - a sentinel: [SOURCES]{json}, [GROUNDED]{json}, [RELATED]{json},
    [QUESTIONS][...], [MONITOR:suggest]{json}, [ACTION:suggest]{json},
    [CONNECTOR:<id>:<event>]{json?}, [DONE], legacy [IMAGE_*]/[GAMMA_*]
  - an inline image token: __IMAGE_GENERATION_STARTED__, __IMAGE_URL__<url>__FORMAT__<fmt>__, ...
  - answer text (markdown; may contain ```chartdata fences)

The parser is defensive like the web client: malformed sentinel JSON is
recorded as a parse error, never raised. Model output is sentinel-neutralized
server-side with a zero-width space, so any RAW sentinel appearing in the
answer text is a leak — collected into `leaked_sentinels`.
"""

import json
import re
from dataclasses import dataclass, field

ZERO_WIDTH_SPACE = "​"

# Raw sentinel shapes that must never appear in visible answer text.
_LEAK_PATTERN = re.compile(
    r"^\s*("
    r"\[SOURCES\]|\[GROUNDED\]|\[RELATED\]|\[QUESTIONS\]"
    r"|\[MONITOR:suggest\]|\[ACTION:suggest\]|\[CONNECTOR:[a-z_]+:[a-z_]+\]"
    r"|__IMAGE_GENERATION_|__IMAGE_URL__"
    r")"
)

_CONNECTOR_PATTERN = re.compile(r"^\[CONNECTOR:([a-z0-9_-]+):([a-z_]+)\](.*)$", re.S)

_CHARTDATA_PATTERN = re.compile(r"```(?:chartdata|chart)\s*\n(.*?)```", re.S)


@dataclass
class ParsedStream:
    answer_text: str = ""
    sources: list = field(default_factory=list)  # accumulated across [SOURCES] lines
    grounded: list = field(default_factory=list)
    related: list = field(default_factory=list)
    questions: list | None = None
    monitor_suggest: dict | None = None
    action_suggest: dict | None = None
    connector_events: list = field(default_factory=list)  # (connector_id, event, payload)
    image_events: list = field(default_factory=list)  # {"event": ..., "url"?: ..., ...}
    chart_blocks: list = field(default_factory=list)
    heartbeats: int = 0
    parse_errors: list = field(default_factory=list)
    leaked_sentinels: list = field(default_factory=list)

    @property
    def image_url(self) -> str | None:
        for event in self.image_events:
            if event.get("event") == "url" and event.get("url"):
                return event["url"]
        return None

    def connector_events_for(self, connector_id: str) -> list:
        return [e for e in self.connector_events if e[0] == connector_id]


def _parse_json_payload(parsed: ParsedStream, line: str, prefix: str):
    """Parse `[PREFIX]{json}`. Returns the object or None (recording the error)."""
    body = line[len(prefix):].strip()
    if not body:
        return None
    try:
        return json.loads(body)
    except (json.JSONDecodeError, ValueError):
        parsed.parse_errors.append(f"{prefix} payload is not valid JSON: {body[:200]}")
        return None


def _items_of(payload) -> list:
    """[GROUNDED]/[RELATED] payloads are {"items": [...]} (tolerate bare lists)."""
    if isinstance(payload, dict):
        items = payload.get("items", [])
        return items if isinstance(items, list) else []
    if isinstance(payload, list):
        return payload
    return []


def process_line(parsed: ParsedStream, line: str, text_lines: list) -> None:
    """Classify one complete stream line. Mirrors chat.ts processChunk."""
    if line.startswith("data: "):  # tolerated SSE framing, same as the web client
        line = line[6:]

    # Heartbeat / keepalive: the web client drops ANY whitespace-only
    # non-empty line (chat.ts gates on `line.trim()`), not just the canonical
    # " " — mirror that exactly. Empty lines stay paragraph breaks below.
    if line and not line.strip():
        parsed.heartbeats += 1
        return

    # --- inline image tokens (double-underscore contract) ---
    if line.startswith("__IMAGE_GENERATION_STARTED__"):
        parsed.image_events.append({"event": "started"})
        return
    if line.startswith("__PARTIAL_IMAGE_"):
        parsed.image_events.append({"event": "partial"})
        return
    if line.startswith("__IMAGE_URL__"):
        fmt_idx = line.find("__FORMAT__")
        if fmt_idx == -1:
            url = line[len("__IMAGE_URL__"):].rstrip("_").strip()
            fmt = ""
        else:
            url = line[len("__IMAGE_URL__"):fmt_idx].strip()
            fmt = line[fmt_idx + len("__FORMAT__"):].rstrip("_").strip()
        parsed.image_events.append({"event": "url", "url": url, "format": fmt})
        return
    if line.startswith("__IMAGE_GENERATION_COMPLETE__"):
        parsed.image_events.append({"event": "complete"})
        return
    if line.startswith("__IMAGE_GENERATION_ERROR__"):
        error = line[len("__IMAGE_GENERATION_ERROR__"):].rstrip("_").strip()
        parsed.image_events.append({"event": "error", "error": error})
        return
    if line.startswith("__IMAGE_GENERATION_FAILED__"):
        parsed.image_events.append({"event": "failed"})
        return
    if line.startswith("__IMAGE_GENERATION_TIMEOUT_RETRYING__"):
        parsed.image_events.append({"event": "retrying"})
        return
    if line.startswith("__IMAGE_GENERATION_TIMEOUT__"):
        parsed.image_events.append({"event": "timeout"})
        return
    if line.startswith("__IMAGE_GENERATION_ID__") or line.startswith("__REVISED_PROMPT__"):
        return  # metadata, consumed

    # --- legacy bracket image sentinels (parsed for safety, no longer emitted) ---
    if line.startswith("[IMAGE_GENERATING]"):
        parsed.image_events.append({"event": "started"})
        return
    if line.startswith("[IMAGE_STREAMING]"):
        parsed.image_events.append({"event": "partial"})
        return
    if line.startswith("[IMAGE_COMPLETE]"):
        parsed.image_events.append(
            {"event": "url", "url": line[len("[IMAGE_COMPLETE]"):].strip(), "format": ""}
        )
        return
    if line.startswith("[IMAGE_ERROR]"):
        parsed.image_events.append(
            {"event": "error", "error": line[len("[IMAGE_ERROR]"):].strip()}
        )
        return

    # --- structured sentinels ---
    if line.startswith("[SOURCES]"):
        payload = _parse_json_payload(parsed, line, "[SOURCES]")
        if isinstance(payload, list):
            parsed.sources.extend(payload)
        return
    if line.startswith("[GROUNDED]"):
        payload = _parse_json_payload(parsed, line, "[GROUNDED]")
        if payload is not None:
            parsed.grounded.extend(_items_of(payload))
        return
    if line.startswith("[RELATED]"):
        payload = _parse_json_payload(parsed, line, "[RELATED]")
        if payload is not None:
            # Items tagged used_in_answer are grounded via the alternate encoding.
            for item in _items_of(payload):
                if isinstance(item, dict) and item.get("used_in_answer"):
                    parsed.grounded.append(item)
                else:
                    parsed.related.append(item)
        return
    if line.startswith("[QUESTIONS]"):
        payload = _parse_json_payload(parsed, line, "[QUESTIONS]")
        if isinstance(payload, list):
            parsed.questions = payload
        return
    if line.startswith("[MONITOR:suggest]"):
        payload = _parse_json_payload(parsed, line, "[MONITOR:suggest]")
        if isinstance(payload, dict):
            parsed.monitor_suggest = payload
        return
    if line.startswith("[ACTION:suggest]"):
        payload = _parse_json_payload(parsed, line, "[ACTION:suggest]")
        if isinstance(payload, dict):
            parsed.action_suggest = payload
        return
    if line.startswith("[CONNECTOR:"):
        match = _CONNECTOR_PATTERN.match(line)
        if not match:
            parsed.parse_errors.append(f"malformed connector sentinel: {line[:200]}")
            return
        connector_id, event, body = match.group(1), match.group(2), match.group(3).strip()
        payload = None
        if body.startswith("{") or body.startswith("["):
            try:
                payload = json.loads(body)
            except (json.JSONDecodeError, ValueError):
                parsed.parse_errors.append(
                    f"connector {connector_id}:{event} payload is not valid JSON: {body[:200]}"
                )
                return
        elif body:
            payload = body
        parsed.connector_events.append((connector_id, event, payload))
        return

    # Legacy Gamma family — record as connector events for uniformity.
    for legacy_prefix, event in (
        ("[GAMMA_OPTIONS]", "options"),
        ("[GAMMA_GENERATING]", "generating"),
        ("[GAMMA_PROGRESS]", "progress"),
        ("[GAMMA_COMPLETE]", "complete"),
        ("[GAMMA_ERROR]", "error"),
    ):
        if line.startswith(legacy_prefix):
            parsed.connector_events.append(("gamma", event, line[len(legacy_prefix):].strip()))
            return

    if line == "[DONE]":
        return

    # Plain answer text (newline restored to preserve markdown, like the web client).
    text_lines.append(line)


def parse_stream(chunks) -> ParsedStream:
    """Parse an iterable of text chunks (arbitrary split points) into a ParsedStream."""
    parsed = ParsedStream()
    text_lines: list = []
    buffer = ""

    for chunk in chunks:
        if isinstance(chunk, bytes):
            chunk = chunk.decode("utf-8", errors="replace")
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            process_line(parsed, line, text_lines)

    if buffer:  # trailing partial line
        process_line(parsed, buffer, text_lines)

    parsed.answer_text = "\n".join(text_lines)
    _post_process(parsed)
    return parsed


def _post_process(parsed: ParsedStream) -> None:
    """Extract chart fences and scan for leaked raw sentinels in answer text."""
    parsed.chart_blocks = [
        block.strip() for block in _CHARTDATA_PATTERN.findall(parsed.answer_text)
    ]

    for line in parsed.answer_text.split("\n"):
        # Zero-width-space forms ([​SOURCES]) are the backend's intentional
        # neutralization of forged sentinels in model output — not a leak.
        if ZERO_WIDTH_SPACE in line:
            continue
        if _LEAK_PATTERN.match(line):
            parsed.leaked_sentinels.append(line.strip()[:200])
