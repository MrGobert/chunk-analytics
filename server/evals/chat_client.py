"""
Black-box HTTP client for the cerebral chat API.

Speaks the same wire protocol as the chunk-web client:
  POST /api/chat            -> 200 text/plain stream | 202 task JSON | error
  GET  /api/task_status/<id>        (image tasks)
  GET  /api/research_result/<id>?format=json
"""

import logging
import time
import uuid
from dataclasses import dataclass, field

import httpx

from evals.auth import EvalIdentity
from evals.stream_parser import ParsedStream, parse_stream

# Per-chunk read timeout. Heartbeats arrive at least every 15s on the steady
# path, so 90s of silence means the stream is genuinely dead.
STREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=10.0)

DEFAULT_MODEL = "gpt-5.6-sol"


@dataclass
class ChatResult:
    kind: str  # "stream" | "task" | "error"
    status_code: int = 0
    parsed: ParsedStream | None = None
    task_json: dict | None = None
    error_body: str = ""
    ttfb_ms: int = 0
    total_ms: int = 0
    reasoning_effort: str = ""
    raw_capped: str = field(default="", repr=False)  # first ~20KB of raw stream, for debugging


def default_chat_body(uid: str, run_id: str, case_id: str) -> dict:
    """The baseline request body every case starts from (mirrors the web client)."""
    return {
        "uid": uid,
        "user_input": "",
        "previous_messages": [],
        "model_name": DEFAULT_MODEL,
        "search_mode": "ASSISTANT",
        "platform": "web",  # capability gates fail closed without platform
        "user_language": "english",
        "isSubscribed": True,  # informational; the backend verifies via RevenueCat
        "canGenerateImage": False,
        "memoryEnabled": False,  # never trigger memory extraction from evals
        "hasImage": False,
        "imageURLs": [],
        "context": "",
        "is_collection_chat": False,
        "tag": [],
        "filter_type": "",
        "document_ids": [],
        "enabled_connectors": [],
        "previous_connector_results": [],
        "conversation_id": f"eval-{run_id}-{case_id}",
        "request_id": str(uuid.uuid4()),
        "peak_message_count": 0,
    }


class ChatClient:
    def __init__(self, base_url: str, identity: EvalIdentity | None):
        """identity=None sends unauthenticated requests (the guest path)."""
        self.base_url = base_url.rstrip("/")
        self.identity = identity

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.identity is not None:
            headers["Authorization"] = f"Bearer {self.identity.token()}"
        return headers

    def chat(self, body: dict, timeout_s: int = 120) -> ChatResult:
        """POST /api/chat and consume the response, retrying once on 401."""
        result = self._chat_once(body, timeout_s)
        if result.kind == "error" and result.status_code == 401 and self.identity:
            self.identity.force_refresh()
            result = self._chat_once(body, timeout_s)
        return result

    def _chat_once(self, body: dict, timeout_s: int) -> ChatResult:
        started = time.monotonic()
        try:
            with httpx.Client(timeout=STREAM_TIMEOUT) as client:
                with client.stream(
                    "POST",
                    f"{self.base_url}/api/chat",
                    json=body,
                    headers=self._headers(),
                ) as response:
                    return self._consume(response, started, timeout_s)
        except httpx.HTTPError as exc:
            return ChatResult(
                kind="error",
                error_body=f"transport error: {exc}",
                total_ms=int((time.monotonic() - started) * 1000),
            )

    def _consume(self, response: httpx.Response, started: float, timeout_s: int) -> ChatResult:
        content_type = response.headers.get("content-type", "")

        if response.status_code == 202 or "application/json" in content_type:
            response.read()
            total_ms = int((time.monotonic() - started) * 1000)
            try:
                payload = response.json()
            except ValueError:
                return ChatResult(
                    kind="error",
                    status_code=response.status_code,
                    error_body=response.text[:1000],
                    total_ms=total_ms,
                )
            if response.status_code >= 400:
                return ChatResult(
                    kind="error",
                    status_code=response.status_code,
                    error_body=response.text[:1000],
                    total_ms=total_ms,
                )
            return ChatResult(
                kind="task",
                status_code=response.status_code,
                task_json=payload,
                total_ms=total_ms,
            )

        if response.status_code >= 400:
            response.read()
            return ChatResult(
                kind="error",
                status_code=response.status_code,
                error_body=response.text[:1000],
                total_ms=int((time.monotonic() - started) * 1000),
            )

        # Streaming path: collect chunks, tracking TTFB (first non-heartbeat byte)
        # and enforcing the case's wall-clock deadline on top of the per-chunk
        # read timeout.
        chunks: list = []
        raw_parts: list = []
        raw_size = 0
        ttfb_ms = 0
        deadline = started + timeout_s
        timed_out = False
        for chunk in response.iter_text():
            if not chunk:
                continue
            chunks.append(chunk)
            if raw_size < 20_000:
                raw_parts.append(chunk[: 20_000 - raw_size])
                raw_size += len(chunk)
            if ttfb_ms == 0 and chunk.strip():
                ttfb_ms = int((time.monotonic() - started) * 1000)
            if time.monotonic() > deadline:
                timed_out = True
                logging.warning("[EVALS] stream exceeded wall clock; truncating")
                break

        parsed = parse_stream(chunks)
        if timed_out:
            parsed.parse_errors.append(f"stream exceeded {timeout_s}s wall clock; truncated")
        return ChatResult(
            kind="stream",
            status_code=response.status_code,
            parsed=parsed,
            ttfb_ms=ttfb_ms,
            total_ms=int((time.monotonic() - started) * 1000),
            reasoning_effort=response.headers.get("x-reasoning-effort", ""),
            raw_capped="".join(raw_parts),
        )

    # ---- task polling ----

    def poll_task_status(self, task_id: str, timeout_s: int = 300, interval_s: float = 2.0) -> dict:
        """Poll /api/task_status/<id> until SUCCESS/FAILURE or timeout.

        Returns the final JSON, or {"state": "TIMEOUT"} / {"state": "ERROR", ...}.
        """
        deadline = time.monotonic() + timeout_s
        last: dict = {}
        while time.monotonic() < deadline:
            try:
                response = httpx.get(
                    f"{self.base_url}/api/task_status/{task_id}",
                    headers=self._headers(),
                    timeout=15.0,
                )
                if response.status_code == 200:
                    last = response.json()
                    state = str(last.get("state") or last.get("status") or "").upper()
                    if state in ("SUCCESS", "FAILURE"):
                        return last
                elif response.status_code >= 500:
                    logging.warning(f"[EVALS] task_status {task_id} -> {response.status_code}")
            except (httpx.HTTPError, ValueError) as exc:
                logging.warning(f"[EVALS] task_status poll error: {exc}")
            time.sleep(interval_s)
        return {"state": "TIMEOUT", "last": last}

    def poll_research_result(self, task_id: str, timeout_s: int = 420, interval_s: float = 5.0) -> dict:
        """Poll /api/research_result/<id>?format=json until the report is ready.

        202 = not ready yet; 200 = {"report", "sources", ...}. A 5xx is only
        terminal when it carries cerebral's Celery-FAILURE body ("Research
        task failed", main.py); any other 5xx is transient infrastructure — a
        router error or web-dyno restart mid-deploy — and polling continues
        until the deadline.
        """
        deadline = time.monotonic() + timeout_s
        last: dict = {}
        while time.monotonic() < deadline:
            try:
                response = httpx.get(
                    f"{self.base_url}/api/research_result/{task_id}",
                    params={"format": "json"},
                    headers=self._headers(),
                    timeout=30.0,
                )
                if response.status_code == 200:
                    return response.json()
                if response.status_code == 202:
                    try:
                        last = response.json()
                    except ValueError:
                        pass
                elif response.status_code >= 500:
                    try:
                        body = response.json()
                    except ValueError:
                        body = {}
                    if isinstance(body, dict) and body.get("error") == "Research task failed":
                        return {"state": "FAILURE", "status_code": response.status_code,
                                "body": response.text[:500]}
                    logging.warning(
                        f"[EVALS] research_result transient {response.status_code}: "
                        f"{response.text[:200]}"
                    )
            except (httpx.HTTPError, ValueError) as exc:
                logging.warning(f"[EVALS] research_result poll error: {exc}")
            time.sleep(interval_s)
        return {"state": "TIMEOUT", "last": last}
