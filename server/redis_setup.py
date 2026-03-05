# redis_setup.py
import logging
import os

import redis
from rq import Queue

logging.basicConfig(level=logging.INFO)


def get_redis_connection(decode_responses=False):
    """Get Redis client from REDIS_URL environment variable.

    Args:
        decode_responses: If True, return strings instead of bytes (for caching)
    """
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        logging.warning("No REDIS_URL set - Redis features will be disabled")
        return None
    try:
        client = redis.from_url(redis_url, decode_responses=decode_responses)
        client.ping()  # Test connection
        return client
    except Exception as e:
        logging.error(f"Failed to connect to Redis: {e}")
        return None


# Connection for RQ (binary mode - default)
r = get_redis_connection(decode_responses=False)

# Connection for caching (string mode for JSON)
redis_client = get_redis_connection(decode_responses=True)

# RQ Queue (only if Redis available)
queue = Queue(connection=r) if r else None
