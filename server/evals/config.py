"""
Configuration for the AI chat eval suite.

All values come from environment variables on the cerebral-analytics app.
The suite targets PRODUCTION cerebral — every write it performs is scoped to
the dedicated eval account, and the upload case cleans up after itself.
"""

import os

# Production cerebral. cerebral-dev is out of date and cannot run this suite.
DEFAULT_TARGET_URL = "https://cerebral-12658c15cdb1.herokuapp.com"

# ---- research coverage ----
#
# The report types the dashboard can toggle per run. These strings are exactly
# what a client sends as `reportType` on /api/chat, so they double as the case
# tags in cases.py. They live here (not in cases.py) because the web dyno
# validates the incoming selection and must not import the heavy evals package
# — analytics_api.py already imports this module and nothing else.
RESEARCH_TYPE_QUICK = "outline_report"
RESEARCH_TYPE_DEEP = "deep"
RESEARCH_TYPE_DETAILED = "detailed_report"

SELECTABLE_RESEARCH_TYPES = (
    RESEARCH_TYPE_QUICK,
    RESEARCH_TYPE_DEEP,
    RESEARCH_TYPE_DETAILED,
)

# Deep is on by default: it is the pipeline that silently broke for weeks
# because the suite only ever exercised the quick outline (2026-08-10). The
# detailed report is opt-in — it adds ~6 min to an already long run and its
# failure mode (silent degradation to a standard report) is cheaper to catch.
DEFAULT_RESEARCH_TYPES = (RESEARCH_TYPE_QUICK, RESEARCH_TYPE_DEEP)


def normalize_research_types(raw) -> list:
    """Coerce a caller-supplied research selection into a valid ordered list.

    None (field absent) means "use the defaults". An explicitly empty list is
    honoured — it runs the suite with every research case skipped. Unknown
    entries are dropped so a newer dashboard can never wedge the runner.
    """
    if raw is None:
        return list(DEFAULT_RESEARCH_TYPES)
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple, set)):
        return list(DEFAULT_RESEARCH_TYPES)
    requested = {str(item) for item in raw}
    return [name for name in SELECTABLE_RESEARCH_TYPES if name in requested]


def target_url() -> str:
    return os.environ.get("EVAL_TARGET_URL", DEFAULT_TARGET_URL).rstrip("/")


def firebase_web_api_key() -> str:
    return os.environ.get("FIREBASE_WEB_API_KEY", "")


def eval_email() -> str:
    return os.environ.get("EVAL_FIREBASE_EMAIL", "")


def eval_password() -> str:
    return os.environ.get("EVAL_FIREBASE_PASSWORD", "")


def firebase_storage_bucket() -> str:
    # Same bucket the web client uses (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).
    return os.environ.get("FIREBASE_STORAGE_BUCKET", "")


def openai_api_key() -> str:
    return os.environ.get("OPENAI_API_KEY", "")


def judge_model() -> str:
    return os.environ.get("EVAL_JUDGE_MODEL", "gpt-5-mini")


def evals_enabled() -> bool:
    return os.environ.get("EVAL_ENABLED", "true").lower() not in ("0", "false", "no")


def max_runs_per_day() -> int:
    try:
        return int(os.environ.get("EVAL_MAX_RUNS_PER_DAY", "6"))
    except ValueError:
        return 6


def daily_schedule_enabled() -> bool:
    return os.environ.get("EVAL_DAILY_SCHEDULE_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )


def is_configured() -> tuple[bool, str]:
    """Check the env vars needed to run the suite. Returns (ok, problem)."""
    missing = [
        name
        for name, value in (
            ("EVAL_FIREBASE_EMAIL", eval_email()),
            ("EVAL_FIREBASE_PASSWORD", eval_password()),
            ("FIREBASE_WEB_API_KEY", firebase_web_api_key()),
        )
        if not value
    ]
    if missing:
        return False, f"missing env vars: {', '.join(missing)}"
    return True, ""
