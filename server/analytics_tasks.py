"""
Celery tasks for analytics pre-computation.
Runs on the existing Celery worker - no new processes needed.

Tasks:
1. compute_analytics_snapshot_task - Every 15 min, caches revenue/funnel/churn/health data
2. snapshot_daily_mrr_task - Daily at 23:55 UTC, snapshots MRR for trend chart
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from celery import shared_task

logging.basicConfig(level=logging.INFO)

# Redis cache TTL (20 minutes - slightly longer than 15-min schedule)
CACHE_TTL = 1200

# History is also persisted to Firestore, but a longer Redis TTL keeps charts
# intact if one daily beat run is delayed or skipped.
HISTORY_TTL = 8 * 24 * 60 * 60


def _get_redis():
    """Get Redis client, return None if unavailable."""
    try:
        from redis_setup import redis_client
        if redis_client and redis_client.ping():
            return redis_client
    except Exception as e:
        logging.warning(f"[ANALYTICS_TASKS] Redis unavailable: {e}")
    return None


def _cache_result(redis, key, data, ttl):
    """Cache a result to Redis. Silently fails."""
    if not redis:
        return
    try:
        redis.setex(key, ttl, json.dumps(data, default=str))
        logging.info(f"[ANALYTICS_TASKS] Cached {key} (TTL={ttl}s)")
    except Exception as e:
        logging.warning(f"[ANALYTICS_TASKS] Failed to cache {key}: {e}")


def _load_history(redis, key, doc_id):
    """(history, recorded): a chart's daily points, and whether they came
    from Firestore's analytics_cache/{doc_id}, the record.

    Redis only speeds the dashboard up: its copy expires and the plan keeps
    nothing across a restart, so an empty key must never shorten the record.
    Its copy is read only when Firestore can't be, and then the caller must
    not overwrite the record.
    """
    try:
        from firebase_setup import db

        snap = db.collection("analytics_cache").document(doc_id).get()
        history = ((snap.to_dict() or {}).get("history") or []) if snap.exists else []
        return [p for p in history if isinstance(p, dict)], True
    except Exception as e:
        logging.warning(f"[ANALYTICS_TASKS] Failed to read {doc_id} from Firestore: {e}")

    history = []
    if redis:
        try:
            existing = redis.get(key)
            history = json.loads(existing) if existing else []
        except Exception:
            history = []
    return [p for p in history if isinstance(p, dict)], False


def _save_history(redis, key, doc_id, history, recorded):
    """Write a chart history to Redis, and to Firestore unless its copy there
    couldn't be read."""
    _cache_result(redis, key, history, HISTORY_TTL)
    if not recorded:
        logging.warning(f"[ANALYTICS_TASKS] Not overwriting {doc_id} in Firestore: it couldn't be read")
        return
    try:
        from firebase_setup import db

        db.collection("analytics_cache").document(doc_id).set({
            "history": history,
            "_updated_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        logging.warning(f"[ANALYTICS_TASKS] Failed to persist {doc_id} to Firestore: {e}")


@shared_task(
    bind=True,
    name="compute_analytics_snapshot",
    ignore_result=True,
    soft_time_limit=120,
    time_limit=180,
)
def compute_analytics_snapshot_task(self):
    """
    Periodic task: Pre-compute expensive analytics and cache results.

    Computes:
    - Revenue summary (subscriber counts, MRR estimate)
    - Subscriber funnel counts
    - Churn metrics
    - Customer health scores

    Results stored in Redis (analytics_cache:* keys, 20-min TTL).

    Schedule: Every 15 minutes via Celery Beat
    """
    logging.info("[ANALYTICS_TASKS] Starting analytics snapshot computation")

    redis = _get_redis()
    if not redis:
        logging.warning("[ANALYTICS_TASKS] Redis unavailable, skipping snapshot")
        return

    try:
        # Import compute functions from analytics_api
        from analytics_api import (
            _compute_churn_intelligence,
            _compute_customer_health,
            _compute_revenue_summary,
            _compute_subscriber_funnel,
        )

        # Compute and cache each dataset for common day ranges
        for days in [7, 30, 90]:
            try:
                revenue = _compute_revenue_summary(days)
                _cache_result(redis, f"analytics_cache:revenue_summary:{days}", revenue, CACHE_TTL)
            except Exception as e:
                logging.error(f"[ANALYTICS_TASKS] revenue_summary({days}d) failed: {e}")

            try:
                funnel = _compute_subscriber_funnel(days)
                _cache_result(redis, f"analytics_cache:subscriber_funnel:{days}", funnel, CACHE_TTL)
            except Exception as e:
                logging.error(f"[ANALYTICS_TASKS] subscriber_funnel({days}d) failed: {e}")

            try:
                churn = _compute_churn_intelligence(days)
                _cache_result(redis, f"analytics_cache:churn_intelligence:{days}", churn, CACHE_TTL)
            except Exception as e:
                logging.error(f"[ANALYTICS_TASKS] churn_intelligence({days}d) failed: {e}")

        # Customer health (no days parameter)
        try:
            health = _compute_customer_health()
            _cache_result(redis, "analytics_cache:customer_health", health, CACHE_TTL)
        except Exception as e:
            logging.error(f"[ANALYTICS_TASKS] customer_health failed: {e}")

        logging.info("[ANALYTICS_TASKS] Analytics snapshot completed successfully")

    except Exception as e:
        logging.error(f"[ANALYTICS_TASKS] Snapshot task failed: {e}", exc_info=True)


@shared_task(
    bind=True,
    name="snapshot_daily_mrr",
    ignore_result=True,
    soft_time_limit=60,
    time_limit=90,
)
def snapshot_daily_mrr_task(self):
    """
    Daily task: Snapshot today's MRR into the mrrTrend chart's history
    (Firestore, cached in Redis). Keeps 366 days of history.

    Schedule: Daily at 23:55 UTC via Celery Beat
    """
    logging.info("[ANALYTICS_TASKS] Starting daily MRR snapshot")

    try:
        from analytics_api import _compute_revenue_summary

        # Compute today's revenue data (30-day window for MRR)
        revenue = _compute_revenue_summary(30)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        mrr_point = {"date": today, "mrr": revenue.get("mrr", 0)}

        redis = _get_redis()
        history, recorded = _load_history(redis, "analytics_cache:mrr_history", "mrr_history")

        # Append or update today's entry and retain the dashboard's 12-month scope.
        history = [p for p in history if p.get("date") != today]
        history.append(mrr_point)
        history = sorted(history, key=lambda p: p.get("date", ""))[-366:]

        _save_history(redis, "analytics_cache:mrr_history", "mrr_history", history, recorded)
        logging.info(f"[ANALYTICS_TASKS] MRR snapshot: ${mrr_point['mrr']:.2f} on {today} ({len(history)} days of history)")

    except Exception as e:
        logging.error(f"[ANALYTICS_TASKS] Daily MRR snapshot failed: {e}", exc_info=True)


@shared_task(
    bind=True,
    name="snapshot_daily_churn_rate",
    ignore_result=True,
    soft_time_limit=60,
    time_limit=90,
)
def snapshot_daily_churn_rate_task(self):
    """
    Daily task: Snapshot today's churn rate into the churnRateTrend chart's
    history (Firestore, cached in Redis). Keeps 90 days of history.

    Schedule: Daily at 23:50 UTC via Celery Beat
    """
    logging.info("[ANALYTICS_TASKS] Starting daily churn rate snapshot")

    try:
        from analytics_api import _compute_churn_intelligence

        # Compute 30-day churn data
        churn = _compute_churn_intelligence(30)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        churn_point = {
            "date": today,
            "rate": churn.get("churnRate", 0),
            "atRiskCount": churn.get("atRiskCount", 0),
            "churnedCount": len(churn.get("churnedUsers", [])),
        }

        # It used to start from Redis alone and wrote one point when Redis was
        # down, so the Firestore copy held a single day (2026-10).
        redis = _get_redis()
        history, recorded = _load_history(redis, "analytics_cache:churn_rate_history", "churn_rate_history")

        # Append or update today's entry; keep only the last 90 days
        history = [p for p in history if p.get("date") != today]
        history.append(churn_point)
        history = sorted(history, key=lambda p: p.get("date", ""))[-90:]

        _save_history(redis, "analytics_cache:churn_rate_history", "churn_rate_history", history, recorded)
        logging.info(f"[ANALYTICS_TASKS] Churn rate snapshot: {churn_point['rate']}% on {today} ({len(history)} days of history)")

    except Exception as e:
        logging.error(f"[ANALYTICS_TASKS] Daily churn rate snapshot failed: {e}", exc_info=True)
