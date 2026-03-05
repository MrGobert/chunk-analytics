"""
Standalone Celery app config for cerebral-analytics.
"""

import os

from celery import Celery
from celery.schedules import crontab

redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Heroku Redis uses rediss:// (TLS) — Celery needs explicit SSL config
broker_use_ssl = None
if redis_url.startswith("rediss://"):
    import ssl
    broker_use_ssl = {
        "ssl_cert_reqs": ssl.CERT_NONE,
    }

celery = Celery("cerebral-analytics")

celery.conf.update(
    broker_url=redis_url,
    result_backend=redis_url,
    broker_use_ssl=broker_use_ssl,
    redis_backend_use_ssl=broker_use_ssl,
    task_ignore_result=True,
    timezone="UTC",
    imports=["email_tasks", "analytics_tasks"],
    beat_schedule={
        # ============================================================
        # Trial & Churn Monitoring
        # ============================================================
        "check-trials-ending-every-6-hours": {
            "task": "check_trials_ending_soon",
            "schedule": crontab(minute=0, hour="*/6"),
        },
        "check-churned-7day-daily": {
            "task": "check_churned_users_7day",
            "schedule": crontab(minute=0, hour=10),
        },
        "check-churned-30day-daily": {
            "task": "check_churned_users_30day",
            "schedule": crontab(minute=30, hour=10),
        },
        # ============================================================
        # Welcome Sequence (Onboarding Drip)
        # ============================================================
        "check-welcome-day1-every-6-hours": {
            "task": "check_welcome_sequence_day1",
            "schedule": crontab(minute=15, hour="*/6"),
        },
        "check-welcome-day3-daily": {
            "task": "check_welcome_sequence_day3",
            "schedule": crontab(minute=0, hour=11),
        },
        "check-welcome-day7-daily": {
            "task": "check_welcome_sequence_day7",
            "schedule": crontab(minute=30, hour=11),
        },
        # ============================================================
        # Monthly Recap & Renewal Reminders
        # ============================================================
        "check-monthly-recap": {
            "task": "check_monthly_recap",
            "schedule": crontab(minute=0, hour=14, day_of_month=1),
        },
        "check-renewal-reminders-daily": {
            "task": "check_renewal_reminders",
            "schedule": crontab(minute=0, hour=9),
        },
        # ============================================================
        # Re-engagement & Nudge
        # ============================================================
        "check-reengagement-14day-daily": {
            "task": "check_reengagement_14day",
            "schedule": crontab(minute=0, hour=12),
        },
        "check-signup-no-trial-daily": {
            "task": "check_signup_no_trial",
            "schedule": crontab(minute=30, hour=12),
        },
        # ============================================================
        # Email Stats Cache Refresh
        # ============================================================
        "refresh-email-stats-cache": {
            "task": "refresh_email_stats_cache",
            "schedule": crontab(minute="*/5"),
        },
        # ============================================================
        # Analytics Pre-computation
        # ============================================================
        "compute-analytics-snapshot": {
            "task": "compute_analytics_snapshot",
            "schedule": crontab(minute="*/15"),
        },
        "snapshot-daily-mrr": {
            "task": "snapshot_daily_mrr",
            "schedule": crontab(minute=55, hour=23),
        },
    },
)
