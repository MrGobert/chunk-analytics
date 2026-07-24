"""
Configuration for the AI chat eval suite.

All values come from environment variables on the cerebral-analytics app.
The suite targets PRODUCTION cerebral — every write it performs is scoped to
the dedicated eval account, and the upload case cleans up after itself.
"""

import os

# Production cerebral. cerebral-dev is out of date and cannot run this suite.
DEFAULT_TARGET_URL = "https://cerebral-12658c15cdb1.herokuapp.com"


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
