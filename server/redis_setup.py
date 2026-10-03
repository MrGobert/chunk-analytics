# redis_setup.py
"""The Redis client for this app's caches, eval lock and eval run budget.

REDIS_URL is cerebral-analytics' own Heroku Redis (Mini: 25 MB, noeviction,
no persistence), which is also the Celery broker. It requires TLS (rediss://)
and serves a self-signed certificate chain, so a client that verifies it
always fails. celery_app.py turns verification off for the broker; this
client does the same. Until Oct 2026 it didn't: every process logged
"certificate verify failed", redis_client was None, and every cache, the eval
lock and the eval budget were skipped.

The client connects on first use, so importing this module never blocks.
Callers ping it inside try/except and treat a failure as "no Redis".
"""
import logging
import os

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

logging.basicConfig(level=logging.INFO)


def get_redis_connection(decode_responses=False):
    """Get Redis client from REDIS_URL environment variable, or None without one.

    Args:
        decode_responses: If True, return strings instead of bytes (for caching)
    """
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        logging.warning("No REDIS_URL set - Redis features will be disabled")
        return None
    options = {
        "decode_responses": decode_responses,
        "socket_connect_timeout": 5,
        "socket_timeout": 5,
        # Heroku Redis closes a connection after 300 s idle, as long as the gap
        # between some beat runs: retry once on a fresh connection.
        "retry": Retry(NoBackoff(), 1),
        "retry_on_error": [redis.exceptions.ConnectionError],
    }
    if redis_url.startswith("rediss://"):
        # Heroku's self-signed chain, the same choice as celery_app.py
        options["ssl_cert_reqs"] = None
        options["ssl_check_hostname"] = False
    try:
        return redis.from_url(redis_url, **options)
    except Exception as e:
        # The message can carry part of the URL; the class name can't.
        logging.error(f"Failed to set up Redis: {type(e).__name__}")
        return None


# Connection for caching (string mode for JSON)
redis_client = get_redis_connection(decode_responses=True)
