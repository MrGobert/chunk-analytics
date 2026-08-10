"""
Celery tasks for the AI chat eval suite.

The suite runs against production cerebral as the dedicated eval account.
Because Celery has task_ignore_result=True globally, all status/results are
persisted to Firestore (eval_runs/{run_id}) — never AsyncResult.

Tasks:
1. run_eval_suite       - executes the full suite for a run_id (dashboard-triggered)
2. seed_eval_account    - one-time idempotent fixture seeding
3. dispatch_scheduled_eval - beat-called daily dispatcher, env-gated (off by default)
"""

import logging
import uuid
from datetime import datetime, timezone

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded

logging.basicConfig(level=logging.INFO)

LOCK_KEY = "eval_suite:lock"
LOCK_TTL = 3900  # matches the task hard time limit
DAILY_COUNT_KEY = "eval_suite:runs:{day}"


def _get_redis():
    try:
        from redis_setup import redis_client

        if redis_client and redis_client.ping():
            return redis_client
    except Exception as exc:
        logging.warning(f"[EVAL_TASKS] Redis unavailable: {exc}")
    return None


def _run_ref(run_id: str):
    from firebase_setup import db

    return db.collection("eval_runs").document(run_id)


def _mark_run_error(run_id: str, message: str):
    try:
        _run_ref(run_id).set(
            {
                "status": "error",
                "summary": {"error": message},
                "finished_at": datetime.now(timezone.utc),
            },
            merge=True,
        )
    except Exception as exc:
        logging.error(f"[EVAL_TASKS] failed to mark run {run_id} error: {exc}")


def _daily_budget_ok(redis) -> bool:
    from evals import config

    if redis is None:
        return True  # degrade open — the Redis lock is the primary guard
    try:
        key = DAILY_COUNT_KEY.format(day=datetime.now(timezone.utc).strftime("%Y%m%d"))
        count = redis.incr(key)
        redis.expire(key, 48 * 3600)
        return int(count) <= config.max_runs_per_day()
    except Exception as exc:
        logging.warning(f"[EVAL_TASKS] daily budget check failed: {exc}")
        return True


# Budget: the non-research cases run ~15 min; a deep research case can poll for
# up to 20 min (cerebral kills generate_report at 1050s) and a detailed one for
# up to 15. Both research toggles on is therefore ~50 min worst case, so the
# soft limit is 60 min and the hard limit 65 — LOCK_TTL and
# analytics_api.EVAL_RUN_STALE_MINUTES are coupled to it.
@shared_task(
    bind=True,
    name="run_eval_suite",
    ignore_result=True,
    soft_time_limit=3600,
    time_limit=3900,
)
def run_eval_suite_task(self, run_id: str, trigger: str = "manual", research_types=None):
    """Execute the eval suite for an already-created eval_runs/{run_id} doc.

    research_types is the dashboard's per-run research coverage selection
    (None = defaults). Kept as a keyword arg so messages queued by an older
    dispatcher stay valid.
    """
    from evals import config
    from evals.runner import run_suite

    if not config.evals_enabled():
        _mark_run_error(run_id, "evals disabled (EVAL_ENABLED=false)")
        return

    redis = _get_redis()
    lock_acquired = False
    if redis is not None:
        try:
            lock_acquired = bool(redis.set(LOCK_KEY, run_id, nx=True, ex=LOCK_TTL))
        except Exception as exc:
            logging.warning(f"[EVAL_TASKS] lock acquire failed: {exc}")
            lock_acquired = True  # degrade open, Firestore status still guards the UI
        if not lock_acquired:
            _mark_run_error(run_id, "another eval run is already in progress")
            return
    if not _daily_budget_ok(redis):
        _mark_run_error(
            run_id,
            f"daily eval run budget reached (EVAL_MAX_RUNS_PER_DAY={config.max_runs_per_day()})",
        )
        if redis is not None and lock_acquired:
            try:
                redis.delete(LOCK_KEY)
            except Exception:
                pass
        return

    try:
        run_suite(run_id, trigger=trigger, research_types=research_types)
    except SoftTimeLimitExceeded:
        logging.error(f"[EVAL_TASKS] run {run_id} hit the soft time limit")
        try:
            _run_ref(run_id).set(
                {"status": "timeout", "finished_at": datetime.now(timezone.utc)},
                merge=True,
            )
        except Exception:
            pass
    except Exception as exc:
        logging.error(f"[EVAL_TASKS] run {run_id} crashed: {exc}", exc_info=True)
        _mark_run_error(run_id, f"run crashed: {exc}")
    finally:
        if redis is not None and lock_acquired:
            try:
                redis.delete(LOCK_KEY)
            except Exception:
                pass


@shared_task(
    bind=True,
    name="seed_eval_account",
    ignore_result=True,
    soft_time_limit=480,
    time_limit=600,
)
def seed_eval_account_task(self, force: bool = False):
    """Idempotently seed the eval account fixtures (document + note)."""
    from evals.seed import seed

    try:
        outcome = seed(force=force)
        logging.info(f"[EVAL_TASKS] seed complete: {outcome}")
    except Exception as exc:
        logging.error(f"[EVAL_TASKS] seeding failed: {exc}", exc_info=True)


@shared_task(
    bind=True,
    name="dispatch_scheduled_eval",
    ignore_result=True,
    soft_time_limit=60,
    time_limit=90,
)
def dispatch_scheduled_eval(self):
    """Beat entrypoint — creates a run doc and chains the suite when enabled.

    Registered in beat unconditionally; gated at runtime by
    EVAL_DAILY_SCHEDULE_ENABLED so the schedule can ship disabled.
    """
    from evals import config

    if not (config.evals_enabled() and config.daily_schedule_enabled()):
        return

    run_id = (
        f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    )
    try:
        _run_ref(run_id).set(
            {
                "status": "queued",
                "trigger": "scheduled",
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception as exc:
        logging.error(f"[EVAL_TASKS] scheduled run doc create failed: {exc}")
        return
    run_eval_suite_task.delay(run_id, "scheduled")
