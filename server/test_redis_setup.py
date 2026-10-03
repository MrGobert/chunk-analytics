"""The Redis client: Heroku Redis's TLS, connecting on first use, and the
retry after Heroku drops an idle connection. Nothing here reaches a server.

Run:
    python -m pytest server/test_redis_setup.py -v
"""

import importlib
import os
import ssl
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import redis  # noqa: E402

import redis_setup  # noqa: E402

TLS_URL = "rediss://:not-a-password@redis.example.invalid:6380"


def _connection(url):
    with patch.dict(os.environ, {"REDIS_URL": url}):
        client = redis_setup.get_redis_connection(decode_responses=True)
    return client.connection_pool.make_connection()


class RedisSetupTests(unittest.TestCase):
    def test_heroku_tls_skips_the_certificate_check(self):
        # Heroku Redis serves a self-signed chain. Verifying it always failed,
        # so redis_client was None and every cache was skipped (2026-03 to 10).
        conn = _connection(TLS_URL)
        self.assertIsInstance(conn, redis.connection.SSLConnection)
        self.assertEqual(conn.cert_reqs, ssl.CERT_NONE)
        self.assertFalse(conn.check_hostname)

    def test_a_plain_url_gets_no_tls_options(self):
        conn = _connection("redis://localhost:6379")
        self.assertNotIsInstance(conn, redis.connection.SSLConnection)

    def test_without_a_url_there_is_no_client(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(redis_setup.get_redis_connection())

    def test_importing_never_connects(self):
        # It used to ping at import, so a slow Redis held up the import.
        self.addCleanup(importlib.reload, redis_setup)
        with patch.object(redis.connection.AbstractConnection, "connect",
                          side_effect=AssertionError("connected at import")), \
             patch.dict(os.environ, {"REDIS_URL": TLS_URL}):
            module = importlib.reload(redis_setup)
        self.assertIsNotNone(module.redis_client)

    def test_a_dropped_idle_connection_is_retried_once(self):
        # Heroku Redis closes a connection after 300 s idle.
        conn = _connection(TLS_URL)
        self.assertIn(redis.exceptions.ConnectionError, conn.retry_on_error)
        self.assertEqual(conn.retry._retries, 1)
        self.assertEqual(conn.socket_timeout, 5)
        self.assertEqual(conn.socket_connect_timeout, 5)


if __name__ == "__main__":
    unittest.main()
