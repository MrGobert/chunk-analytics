"""Repair the stored MRR trend after the September 2026 inflation incident.

`snapshot_daily_mrr_task` records one MRR point per day into Redis
(`analytics_cache:mrr_history`) and Firestore (`analytics_cache/mrr_history`).
Every point it wrote was produced by the pre-fix `_compute_revenue_summary`,
which summed local-currency prices as dollars and booked a flat $9.99 for
anyone the native app had flagged "active". Those points survive a code fix,
and they are what drives both the trend chart and the mrrChange badge.

Firestore is the one that matters: the daily task restores history from it
whenever Redis misses, so clearing Redis alone brings the bad series back
within a day. This writes Firestore first, then Redis, then drops the derived
summary caches.

Run AFTER the corrected analytics_api.py is deployed — otherwise the 23:55 UTC
snapshot re-poisons Firestore the same night.

    heroku run -a cerebral-analytics python repair_mrr_history.py --dry-run
    heroku run -a cerebral-analytics python repair_mrr_history.py --wipe --apply
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(message)s")

REDIS_KEY = "analytics_cache:mrr_history"
FIRESTORE_DOC = ("analytics_cache", "mrr_history")
# Derived caches that would keep serving the old numbers. mrr_history is
# excluded deliberately — this script owns it.
DERIVED_CACHE_PREFIXES = (
    "analytics_cache:revenue_summary:",
    "analytics_cache:subscriber_funnel:",
    "analytics_cache:churn_intelligence:",
    "analytics_cache:customer_health",
)


def _redis():
    from redis_setup import redis_client

    if redis_client is None:
        logging.warning("Redis unavailable — Firestore only")
    return redis_client


def _load_history(redis):
    """Prefer Firestore: it is what the daily task restores from."""
    from firebase_setup import db

    doc = db.collection(FIRESTORE_DOC[0]).document(FIRESTORE_DOC[1]).get()
    if doc.exists:
        history = (doc.to_dict() or {}).get("history", []) or []
        if history:
            return history, "firestore"

    if redis:
        raw = redis.get(REDIS_KEY)
        if raw:
            return json.loads(raw), "redis"
    return [], "empty"


def _keep(point, drop_from, above):
    date = str(point.get("date") or "")
    try:
        mrr = float(point.get("mrr", 0) or 0)
    except (TypeError, ValueError):
        return False
    if drop_from and date >= drop_from:
        return False
    if above is not None and mrr > above:
        return False
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wipe", action="store_true",
                        help="drop the whole series and let it rebuild from corrected snapshots")
    parser.add_argument("--drop-from", metavar="YYYY-MM-DD",
                        help="drop every point on or after this date")
    parser.add_argument("--above", type=float, metavar="USD",
                        help="drop every point whose MRR exceeds this")
    parser.add_argument("--apply", action="store_true", help="write the change")
    parser.add_argument("--dry-run", action="store_true", help="report only (default)")
    args = parser.parse_args(argv)

    if not (args.wipe or args.drop_from or args.above):
        parser.error("choose one of --wipe, --drop-from or --above")
    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run are mutually exclusive")

    redis = _redis()
    history, source = _load_history(redis)
    logging.info(f"Loaded {len(history)} point(s) from {source}")
    if not history:
        logging.info("Nothing to repair.")
        return 0

    kept, dropped = [], []
    for point in history:
        target = dropped if args.wipe or not _keep(point, args.drop_from, args.above) else kept
        target.append(point)

    logging.info(f"Keeping {len(kept)}, dropping {len(dropped)}")
    for point in dropped[:20]:
        logging.info(f"  drop {point.get('date')}  ${point.get('mrr')}")
    if len(dropped) > 20:
        logging.info(f"  ... and {len(dropped) - 20} more")

    if not args.apply:
        logging.info("\nDry run — nothing written. Re-run with --apply.")
        return 0

    from firebase_setup import db

    db.collection(FIRESTORE_DOC[0]).document(FIRESTORE_DOC[1]).set({
        "history": kept,
        "_updated_at": datetime.now(timezone.utc),
        "_repaired_at": datetime.now(timezone.utc),
    })
    logging.info("Firestore updated")

    if redis:
        if kept:
            redis.set(REDIS_KEY, json.dumps(kept))
        else:
            redis.delete(REDIS_KEY)
        logging.info("Redis updated")

        purged = 0
        for key in redis.scan_iter("analytics_cache:*"):
            name = key if isinstance(key, str) else key.decode()
            if name.startswith(DERIVED_CACHE_PREFIXES):
                redis.delete(name)
                purged += 1
        logging.info(f"Purged {purged} derived cache key(s)")

    logging.info("Done. The next dashboard load recomputes from live data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
