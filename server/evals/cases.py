"""
The eval case definitions — the exact features and actions the suite tests.

Hard assertions fail a case; soft assertions only warn (used for behavior that
depends on LLM routing). The judge is always soft: a low score warns.
Two virtual cases (sentinel_leakage, latency_budget) are computed across all
executed cases by the runner and are not defined here.
"""

from dataclasses import dataclass, field

from evals import assertions as A
from evals.judge import JudgeSpec

# Facts planted by seed.py — documents_only can only answer from the seeded doc.
SEED_DOC_NAME = "eval-fixture-meridian.txt"
SEED_FACT_QUESTION = "When does the Meridian-7 launch window open? Check my documents."
SEED_FACT_TOKEN = "March 3"

SEED_DOC_CONTENT = """Project Meridian-7 — Internal Fixture Document (Eval Suite)

This document exists solely for automated evaluation of document search.

Key facts:
- The Meridian-7 launch window opens on March 3, 2027.
- The mission director is Dr. Imara Chen.
- The launch site is Pad 39-C.
- The primary payload is the Halcyon relay satellite.

The unique codename for this fixture is MERIDIAN-SEVEN-FIXTURE.
"""


@dataclass
class Turn:
    user_input: str
    overrides: dict = field(default_factory=dict)


@dataclass
class EvalCase:
    id: str
    name: str
    category: str
    turns: list
    # "stream" | "image" | "research" | "guest" | "document_upload"
    kind: str = "stream"
    hard: list = field(default_factory=list)
    soft: list = field(default_factory=list)
    judge: JudgeSpec | None = None
    timeout_s: int = 120
    retry_flaky: bool = False
    requires: tuple = ()


def _dynamic_token_assertion() -> A.Assertion:
    """Answer must contain the run-unique token planted in the uploaded doc."""

    def check(execution: A.CaseExecution):
        token = execution.extra.get("expected_token", "")
        if not token:
            return False, "no expected token recorded (upload failed earlier)"
        passed = token.lower() in execution.answer.lower()
        return passed, f"token '{token}' {'found' if passed else 'NOT found'} in answer"

    return A.Assertion("answer_contains_uploaded_token", check)


def _upload_indexed_assertion() -> A.Assertion:
    def check(execution: A.CaseExecution):
        indexing = execution.extra.get("indexing") or {}
        status = indexing.get("status", "not-run")
        return (
            status == "completed",
            f"indexing status={status} waited={indexing.get('waited_s', '?')}s",
        )

    return A.Assertion("upload_indexed", check)


def _upload_cleanup_assertion() -> A.Assertion:
    def check(execution: A.CaseExecution):
        cleanup = execution.extra.get("cleanup")
        if cleanup is None:
            return False, "cleanup did not run"
        passed = bool(cleanup.get("qdrant")) and bool(cleanup.get("firestore"))
        return passed, f"cleanup: {cleanup}"

    return A.Assertion("upload_cleanup", check)


ALL_CASES: list = [
    EvalCase(
        id="assistant_basic",
        name="Assistant chat (plain streaming)",
        category="chat",
        turns=[Turn("Explain the difference between TCP and UDP in two short paragraphs.")],
        hard=[A.stream_ok(), A.answer_min_length(200)],
        judge=JudgeSpec(min_score=6),
    ),
    EvalCase(
        id="multiturn_recall",
        name="Multi-turn context recall",
        category="chat",
        turns=[
            Turn("Remember this for later in our conversation: my project codename is ZEPHYR-42."),
            Turn("What is my project codename? Reply with just the codename."),
        ],
        hard=[A.stream_ok(), A.answer_contains(["ZEPHYR"])],
    ),
    EvalCase(
        id="web_search",
        name="Web Search mode",
        category="search",
        turns=[
            Turn(
                "What are the most significant AI developments this week?",
                {"search_mode": "WEB SEARCH"},
            )
        ],
        hard=[A.stream_ok(), A.sources_min(1)],
        soft=[A.sources_min(2)],
        judge=JudgeSpec(min_score=6),
        timeout_s=180,
    ),
    EvalCase(
        id="documents_only",
        name="Documents Only mode (seeded doc retrieval)",
        category="search",
        turns=[Turn(SEED_FACT_QUESTION, {"search_mode": "DOCUMENTS ONLY"})],
        hard=[A.stream_ok(), A.answer_contains([SEED_FACT_TOKEN])],
        soft=[A.grounded_nonempty()],
        requires=("seeded_docs",),
        timeout_s=180,
    ),
    EvalCase(
        id="document_upload_search",
        name="Document upload → indexing → retrieval",
        category="documents",
        # user_input is templated by the runner with the run-unique nonce/token.
        turns=[Turn("", {"search_mode": "DOCUMENTS ONLY"})],
        kind="document_upload",
        hard=[
            _upload_indexed_assertion(),
            A.stream_ok(),
            _dynamic_token_assertion(),
        ],
        soft=[_upload_cleanup_assertion()],
        timeout_s=420,
    ),
    EvalCase(
        id="all_mode",
        name="All mode (web + documents)",
        category="search",
        turns=[
            Turn(
                "Combining what's in my documents about Meridian-7 with current web results, "
                "what should I know about satellite launch schedules?",
                {"search_mode": "ALL"},
            )
        ],
        hard=[A.stream_ok(), A.sources_min(1)],
        soft=[A.grounded_nonempty()],
        judge=JudgeSpec(min_score=5),
        timeout_s=180,
    ),
    EvalCase(
        id="youtube_mode",
        name="YouTube search mode",
        category="search",
        turns=[
            Turn("Find videos about learning piano for beginners.", {"search_mode": "YOUTUBE"})
        ],
        hard=[A.stream_ok(), A.sources_domain_contains(["youtube.com", "youtu.be"])],
        retry_flaky=True,
        timeout_s=180,
    ),
    EvalCase(
        id="auto_routing",
        name="Auto mode (Decision Agent routing)",
        category="search",
        turns=[
            Turn("What is the current price range of the NVIDIA RTX 5090?", {"search_mode": "AUTO"})
        ],
        hard=[A.stream_ok(), A.answer_min_length(50)],
        soft=[A.sources_min(1)],
        retry_flaky=True,
        timeout_s=180,
    ),
    EvalCase(
        id="image_generation",
        name="Image generation",
        category="image",
        turns=[
            Turn(
                "Generate an image of a lighthouse at dusk, painted in soft watercolors.",
                {"canGenerateImage": True, "model_name": "gpt-5.6-sol"},
            )
        ],
        kind="image",
        hard=[A.image_delivered(), A.image_url_fetches()],
        timeout_s=300,
    ),
    EvalCase(
        id="followup_questions",
        name="Follow-up question chips",
        category="sentinels",
        turns=[Turn("Tell me about the history of espresso and how it spread worldwide.")],
        hard=[A.stream_ok(), A.questions_well_formed()],
        retry_flaky=True,
    ),
    EvalCase(
        id="action_suggest",
        name="Action suggestion card",
        category="sentinels",
        turns=[
            Turn(
                "Write me a concise study guide for the AWS Solutions Architect Associate exam."
            )
        ],
        hard=[A.stream_ok()],
        soft=[A.action_suggest_present()],
        timeout_s=180,
    ),
    EvalCase(
        id="monitor_suggest",
        name="Automation (monitor) suggestion card",
        category="sentinels",
        turns=[
            Turn(
                "I want to keep track of price drops on the RTX 5090 over the next few months.",
                {"search_mode": "WEB SEARCH"},
            )
        ],
        hard=[A.stream_ok()],
        soft=[A.monitor_suggest_present()],
        timeout_s=180,
    ),
    EvalCase(
        id="chartdata",
        name="Inline chart rendering (chartdata fence)",
        category="sentinels",
        turns=[
            Turn(
                "Show me a bar chart comparing the populations of the 5 largest US cities."
            )
        ],
        hard=[A.stream_ok(), A.chartdata_valid()],
        retry_flaky=True,
        timeout_s=180,
    ),
    EvalCase(
        id="clarification",
        name="Router clarification path",
        category="chat",
        turns=[Turn("What's the best one?")],
        hard=[A.stream_ok()],
        judge=JudgeSpec(
            min_score=6,
            extra_criteria=(
                "The prompt is deliberately ambiguous with no context. The ideal answer asks "
                "a clarifying question instead of guessing. Score 8-10 if it asks for "
                "clarification, 4-7 if it hedges reasonably, 0-3 if it confidently guesses."
            ),
        ),
    ),
    EvalCase(
        id="premium_model",
        name="Premium model (Claude Opus, Pro entitlement)",
        category="chat",
        turns=[
            Turn(
                "In one paragraph, what makes a good unit test?",
                {"model_name": "claude-opus-4-8"},
            )
        ],
        hard=[A.stream_ok(), A.answer_min_length(50)],
        judge=JudgeSpec(min_score=5),
    ),
    EvalCase(
        id="guest_chat",
        name="Guest (unauthenticated) chat",
        category="guest",
        turns=[Turn("What is the capital of Australia?")],
        kind="guest",
        hard=[A.stream_ok(), A.answer_min_length(1)],
        # The dyno egress IP is shared, so the guest IP quota may already be
        # consumed — rate-limit prose is a warn, not a failure.
        soft=[A.not_rate_limited()],
    ),
    EvalCase(
        id="research_quick",
        name="Research report (quick outline, end-to-end)",
        category="research",
        turns=[
            Turn(
                "The history and impact of the transistor",
                {"search_mode": "RESEARCH", "reportType": "outline_report"},
            )
        ],
        kind="research",
        hard=[A.research_report_min_length(500)],
        soft=[A.research_sources_nonempty()],
        judge=JudgeSpec(min_score=6),
        timeout_s=480,
    ),
    EvalCase(
        id="notion_connector",
        name="Notion connector lifecycle",
        category="connector",
        turns=[
            Turn(
                "Search my Notion workspace for the page titled 'Eval Fixture' and tell me "
                "what it contains.",
                {
                    "enabled_connectors": ["notion"],
                    "invoked_connector": "notion",
                },
            )
        ],
        hard=[
            A.stream_ok(),
            A.connector_event_present("notion"),
            A.connector_terminal_ok("notion"),
        ],
        requires=("notion",),
        timeout_s=240,
    ),
    EvalCase(
        id="error_handling",
        name="Unknown model id normalization (never 400s)",
        category="chat",
        turns=[
            Turn("Say hello in exactly five words.", {"model_name": "not-a-real-model"})
        ],
        hard=[A.stream_ok(), A.answer_min_length(1)],
    ),
]


def get_case(case_id: str) -> EvalCase | None:
    for case in ALL_CASES:
        if case.id == case_id:
            return case
    return None
