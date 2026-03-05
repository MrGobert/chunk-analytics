"""
Thread pool utility for running blocking operations (Firestore/gRPC)
without eventlet.tpool, which deadlocks with greenlet 3.x.

greenlet 3.0+ enforces strict thread affinity — eventlet.tpool.execute
tries to switch greenlets across threads, which raises:
    greenlet.error: Cannot switch to a different thread

This module uses concurrent.futures.ThreadPoolExecutor instead.
The calling eventlet greenlet blocks (yields to hub) while waiting
for the thread result, preserving cooperative behavior.

FIX: Pool increased from 8 → 20 workers. When a Firestore/gRPC call
hangs (300s default gRPC deadline), the timed-out future still holds a
worker thread hostage. With only 8 workers, a few stuck calls exhaust
the pool and cascade-block all subsequent operations. 20 workers gives
headroom for stuck threads while keeping memory reasonable on Heroku.
"""

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

# Shared thread pool — sized for Firestore/gRPC I/O, not CPU work.
# 20 workers: enough headroom so a few stuck gRPC calls (300s default
# deadline) don't exhaust the pool and cascade-block everything.
_pool = ThreadPoolExecutor(max_workers=20, thread_name_prefix="firestore-io")

T = TypeVar("T")


def run_in_thread(fn: Callable[..., T], *args: Any, timeout: float = 10.0, **kwargs: Any) -> T:
    """
    Run a blocking function in a native thread, wait for the result.

    Unlike eventlet.tpool.execute, this does NOT use greenlet switching
    across threads, so it works with greenlet 3.x.

    IMPORTANT: If the timeout fires, the thread continues running in the
    background (Python can't kill native threads). The caller gets a
    TimeoutError, but the stuck thread still occupies a pool slot until
    the underlying gRPC call completes or hits its own 300s deadline.
    The pool is sized at 20 to absorb these stuck threads.

    Args:
        fn: The blocking function to call
        *args: Positional arguments for fn
        timeout: Max seconds to wait (default 10)
        **kwargs: Keyword arguments for fn

    Returns:
        The return value of fn(*args, **kwargs)

    Raises:
        TimeoutError: If the function doesn't complete within timeout
        Exception: Any exception raised by fn
    """
    future: Future = _pool.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        logger.warning(f"Thread pool call timed out after {timeout}s: {fn.__name__}")
        raise
