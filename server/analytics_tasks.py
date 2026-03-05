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

# MRR history TTL (25 hours - refreshed daily)
MRR_HISTORY_TTL = 90000


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
    Daily task: Snapshot today's MRR into a Redis list for mrrTrend chart.
    Keeps 90 days of history.

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
        if redis:
            # Load existing history
            try:
                existing = redis.get("analytics_cache:mrr_history")
                history = json.loads(existing) if existing else []
            except Exception:
                history = []

            # Append or update today's entry
            history = [p for p in history if p.get("date") != today]
            history.append(mrr_point)

            # Keep only last 90 days
            history = history[-90:]

            _cache_result(redis, "analytics_cache:mrr_history", history, MRR_HISTORY_TTL)
            logging.info(f"[ANALYTICS_TASKS] MRR snapshot: ${mrr_point['mrr']:.2f} on {today} ({len(history)} days of history)")
        else:
            logging.warning("[ANALYTICS_TASKS] Redis unavailable, MRR snapshot not saved")

        # Also persist to Firestore as fallback
        try:
            from firebase_setup import db
            db.collection("analytics_cache").document("mrr_history").set({
                "history": history if redis else [mrr_point],
                "_updated_at": datetime.now(timezone.utc),
            })
        except Exception as e:
            logging.warning(f"[ANALYTICS_TASKS] Failed to persist MRR to Firestore: {e}")

    except Exception as e:
        logging.error(f"[ANALYTICS_TASKS] Daily MRR snapshot failed: {e}", exc_info=True)
