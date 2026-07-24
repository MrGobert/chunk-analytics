"""
Assertion library for eval cases.

Each assertion is a named callable over a CaseExecution, returning
(passed, detail). Severity (hard vs soft) is decided by which list the case
places the assertion in — hard failures fail the case, soft failures warn.
"""

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from evals.chat_client import ChatResult

RATE_LIMIT_PATTERN = re.compile(r"daily (search|image generation) limit reached", re.I)


@dataclass
class CaseExecution:
    """Everything an assertion can look at after a case's turns have run."""

    results: list = field(default_factory=list)  # ChatResult per turn
    research: dict | None = None  # polled research_result JSON
    image_task: dict | None = None  # polled task_status JSON (image task path)
    extra: dict = field(default_factory=dict)

    @property
    def result(self) -> ChatResult | None:
        return self.results[-1] if self.results else None

    @property
    def parsed(self):
        result = self.result
        return result.parsed if result and result.parsed else None

    @property
    def answer(self) -> str:
        parsed = self.parsed
        return parsed.answer_text.strip() if parsed else ""

    @property
    def image_url(self) -> str | None:
        parsed = self.parsed
        if parsed and parsed.image_url:
            return parsed.image_url
        if self.image_task:
            image = (self.image_task.get("result") or {}).get("image") or {}
            if image.get("url"):
                return image["url"]
        return None


@dataclass
class Assertion:
    name: str
    fn: object  # Callable[[CaseExecution], tuple[bool, str]]

    def evaluate(self, execution: CaseExecution) -> tuple[bool, str]:
        try:
            return self.fn(execution)
        except Exception as exc:  # an assertion crash is a failure, not a run crash
            return False, f"assertion raised: {exc}"


def _valid_http_urls(sources: list) -> list:
    urls = []
    for source in sources:
        url = source.get("url", "") if isinstance(source, dict) else ""
        try:
            parts = urlparse(url)
            if parts.scheme in ("http", "https") and parts.netloc:
                urls.append(url)
        except ValueError:
            continue
    return urls


# ---- stream / answer ----


def stream_ok() -> Assertion:
    def check(execution: CaseExecution):
        result = execution.result
        if result is None:
            return False, "no response recorded"
        if result.kind == "error":
            return False, f"HTTP {result.status_code}: {result.error_body[:300]}"
        if result.kind == "stream" and result.parsed:
            wall = [e for e in result.parsed.parse_errors if "wall clock" in e]
            if wall:
                return False, wall[0]
        return True, f"kind={result.kind} status={result.status_code}"

    return Assertion("stream_ok", check)


def answer_min_length(min_chars: int) -> Assertion:
    def check(execution: CaseExecution):
        length = len(execution.answer)
        return length >= min_chars, f"answer length {length} (expected >= {min_chars})"

    return Assertion(f"answer_min_length({min_chars})", check)


def answer_contains(tokens: list, any_of: bool = True) -> Assertion:
    def check(execution: CaseExecution):
        answer = execution.answer.lower()
        hits = [token for token in tokens if token.lower() in answer]
        passed = bool(hits) if any_of else len(hits) == len(tokens)
        return passed, f"matched {hits or 'none'} of {tokens}"

    return Assertion(f"answer_contains({tokens})", check)


def not_rate_limited() -> Assertion:
    def check(execution: CaseExecution):
        if RATE_LIMIT_PATTERN.search(execution.answer):
            return False, f"rate-limit prose returned: {execution.answer[:150]}"
        return True, "no rate-limit prose"

    return Assertion("not_rate_limited", check)


# ---- sources / grounding ----


def sources_min(min_count: int) -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        urls = _valid_http_urls(parsed.sources) if parsed else []
        return (
            len(urls) >= min_count,
            f"{len(urls)} valid source URLs (expected >= {min_count})",
        )

    return Assertion(f"sources_min({min_count})", check)


def sources_domain_contains(substrings: list, min_count: int = 1) -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        urls = _valid_http_urls(parsed.sources) if parsed else []
        hits = [u for u in urls if any(s in u for s in substrings)]
        return (
            len(hits) >= min_count,
            f"{len(hits)}/{len(urls)} sources match {substrings}",
        )

    return Assertion(f"sources_domain_contains({substrings})", check)


def grounded_nonempty() -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        count = len(parsed.grounded) if parsed else 0
        return count > 0, f"{count} grounded items"

    return Assertion("grounded_nonempty", check)


# ---- structured sentinels ----


def questions_well_formed(max_count: int = 3) -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        questions = parsed.questions if parsed else None
        if not questions:
            return False, "[QUESTIONS] not emitted"
        if not all(isinstance(q, str) and q.strip() for q in questions):
            return False, f"non-string entries: {questions}"
        if len(questions) > max_count:
            return False, f"{len(questions)} questions (expected <= {max_count})"
        return True, f"{len(questions)} questions"

    return Assertion("questions_well_formed", check)


def monitor_suggest_present() -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        suggestion = parsed.monitor_suggest if parsed else None
        if not suggestion:
            return False, "[MONITOR:suggest] not emitted"
        query = str(suggestion.get("query", "")).strip()
        if not query:
            return False, f"missing query: {suggestion}"
        return True, f"kind={suggestion.get('kind', 'research')} query={query[:80]}"

    return Assertion("monitor_suggest_present", check)


def action_suggest_present() -> Assertion:
    VALID_KINDS = ("artifact", "note", "research", "collection")

    def check(execution: CaseExecution):
        parsed = execution.parsed
        suggestion = parsed.action_suggest if parsed else None
        if not suggestion:
            return False, "[ACTION:suggest] not emitted"
        kind = suggestion.get("kind")
        if kind not in VALID_KINDS:
            return False, f"invalid kind: {kind}"
        return True, f"kind={kind}"

    return Assertion("action_suggest_present", check)


def chartdata_valid(min_blocks: int = 1) -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        blocks = parsed.chart_blocks if parsed else []
        if len(blocks) < min_blocks:
            return False, f"{len(blocks)} chartdata fences (expected >= {min_blocks})"
        for block in blocks:
            try:
                json.loads(block)
            except (json.JSONDecodeError, ValueError) as exc:
                return False, f"chartdata fence is not valid JSON: {exc}"
        return True, f"{len(blocks)} valid chartdata fences"

    return Assertion("chartdata_valid", check)


def no_leaked_sentinels() -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        leaks = parsed.leaked_sentinels if parsed else []
        return not leaks, f"leaked: {leaks[:3]}" if leaks else "no leaks"

    return Assertion("no_leaked_sentinels", check)


# ---- image generation ----


def image_delivered() -> Assertion:
    def check(execution: CaseExecution):
        url = execution.image_url
        if url:
            return True, f"image URL delivered: {url[:120]}"
        parsed = execution.parsed
        events = [e.get("event") for e in parsed.image_events] if parsed else []
        task_state = (execution.image_task or {}).get("state", "")
        return False, f"no image URL (stream events={events}, task_state={task_state})"

    return Assertion("image_delivered", check)


def image_url_fetches() -> Assertion:
    def check(execution: CaseExecution):
        url = execution.image_url
        if not url:
            return False, "no image URL to fetch"
        response = httpx.get(url, timeout=15.0, follow_redirects=True)
        content_type = response.headers.get("content-type", "")
        passed = response.status_code == 200 and content_type.startswith("image/")
        return passed, f"GET {response.status_code} content-type={content_type}"

    return Assertion("image_url_fetches", check)


# ---- connectors ----


def connector_event_present(connector_id: str) -> Assertion:
    def check(execution: CaseExecution):
        parsed = execution.parsed
        events = parsed.connector_events_for(connector_id) if parsed else []
        names = [event for (_, event, _) in events]
        return bool(events), f"events: {names or 'none'}"

    return Assertion(f"connector_event_present({connector_id})", check)


def connector_terminal_ok(connector_id: str, ok_events: tuple = ("complete", "sources")) -> Assertion:
    BAD = ("error", "subscription_required", "needs_input")

    def check(execution: CaseExecution):
        parsed = execution.parsed
        events = parsed.connector_events_for(connector_id) if parsed else []
        names = [event for (_, event, _) in events]
        if not names:
            return False, "no connector events"
        if any(name in BAD for name in names):
            return False, f"bad event in lifecycle: {names}"
        if not any(name in ok_events for name in names):
            return False, f"no terminal ok event (saw {names})"
        return True, f"lifecycle: {names}"

    return Assertion(f"connector_terminal_ok({connector_id})", check)


# ---- research ----


def research_report_min_length(min_chars: int = 500) -> Assertion:
    def check(execution: CaseExecution):
        research = execution.research or {}
        state = research.get("state", "")
        if state in ("TIMEOUT", "FAILURE"):
            return False, f"research task ended {state}: {str(research)[:200]}"
        report = str(research.get("report", ""))
        return (
            len(report) >= min_chars,
            f"report length {len(report)} (expected >= {min_chars})",
        )

    return Assertion("research_report_min_length", check)


def research_sources_nonempty() -> Assertion:
    def check(execution: CaseExecution):
        sources = (execution.research or {}).get("sources") or []
        return bool(sources), f"{len(sources)} research sources"

    return Assertion("research_sources_nonempty", check)
