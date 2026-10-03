"""The dashboard's chart histories: Firestore holds the record, Redis only
caches it.

Redis on this plan keeps nothing across a restart and its keys expire, so an
empty or missing Redis copy must never shorten the record. The churn-rate
history did exactly that: it started from Redis alone, and with Redis down it
wrote today's point by itself, so Firestore held one day (2026-10).

Run:
    python -m pytest server/test_analytics_tasks.py -v
"""

import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import analytics_api  # noqa: E402
import analytics_tasks  # noqa: E402

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
CHURN_KEY = "analytics_cache:churn_rate_history"
MRR_KEY = "analytics_cache:mrr_history"


class FakeRedis:
    def __init__(self, data=None):
        self.data = dict(data or {})

    def get(self, key):
        return self.data.get(key)

    def setex(self, key, _ttl, value):
        self.data[key] = value

    def dates(self, key):
        return [p["date"] for p in json.loads(self.data[key])]


class FakeFirestore:
    """analytics_cache/{doc_id} docs. fail=True makes every read raise."""

    def __init__(self, docs=None, fail=False):
        self.docs = dict(docs or {})
        self.fail = fail
        self.writes = []

    def collection(self, name):
        assert name == "analytics_cache"
        return SimpleNamespace(document=lambda doc_id: SimpleNamespace(
            get=lambda: self._get(doc_id),
            set=lambda data: self._set(doc_id, data),
        ))

    def _get(self, doc_id):
        if self.fail:
            raise RuntimeError("firestore down")
        data = self.docs.get(doc_id)
        return SimpleNamespace(exists=data is not None, to_dict=lambda: data)

    def _set(self, doc_id, data):
        self.writes.append(doc_id)
        self.docs[doc_id] = data

    def dates(self, doc_id):
        return [p["date"] for p in self.docs[doc_id]["history"]]


def _history(*dates, **values):
    return {"history": [{"date": d, **values} for d in dates]}


class ChurnRateHistoryTests(unittest.TestCase):
    CHURN = {"churnRate": 4.2, "atRiskCount": 3, "churnedUsers": [{}, {}]}

    def _run(self, firestore, redis):
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=firestore)}), \
             patch.object(analytics_tasks, "_get_redis", return_value=redis), \
             patch.object(analytics_api, "_compute_churn_intelligence", return_value=self.CHURN):
            analytics_tasks.snapshot_daily_churn_rate_task()

    def test_an_empty_cache_keeps_the_record(self):
        # What turning the cache on looks like: Redis starts empty.
        firestore = FakeFirestore({"churn_rate_history": _history("2026-09-01", "2026-09-02", rate=1.0)})
        redis = FakeRedis()
        self._run(firestore, redis)
        self.assertEqual(firestore.dates("churn_rate_history"), ["2026-09-01", "2026-09-02", TODAY])
        self.assertEqual(redis.dates(CHURN_KEY), ["2026-09-01", "2026-09-02", TODAY])
        self.assertEqual(firestore.docs["churn_rate_history"]["history"][-1],
                         {"date": TODAY, "rate": 4.2, "atRiskCount": 3, "churnedCount": 2})

    def test_without_redis_the_record_still_grows(self):
        firestore = FakeFirestore({"churn_rate_history": _history("2026-09-01", rate=1.0)})
        self._run(firestore, None)
        self.assertEqual(firestore.dates("churn_rate_history"), ["2026-09-01", TODAY])

    def test_an_unreadable_record_is_never_overwritten(self):
        firestore = FakeFirestore({"churn_rate_history": _history("2026-09-01", "2026-09-02", rate=1.0)}, fail=True)
        redis = FakeRedis({CHURN_KEY: json.dumps(_history("2026-09-02", rate=1.0)["history"])})
        self._run(firestore, redis)
        self.assertEqual(firestore.writes, [])
        self.assertEqual(redis.dates(CHURN_KEY), ["2026-09-02", TODAY])

    def test_keeps_the_last_ninety_days_in_date_order(self):
        dates = [f"2026-{m:02d}-{d:02d}" for m in (6, 7, 8) for d in range(1, 31)] + ["2026-09-01"]
        firestore = FakeFirestore({"churn_rate_history": _history(*reversed(dates), rate=1.0)})
        self._run(firestore, FakeRedis())
        kept = firestore.dates("churn_rate_history")
        self.assertEqual(len(kept), 90)
        self.assertEqual(kept, sorted(kept))
        self.assertEqual(kept[-1], TODAY)
        self.assertNotIn("2026-06-01", kept)


class MrrHistoryTests(unittest.TestCase):
    def _run(self, firestore, redis):
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=firestore)}), \
             patch.object(analytics_tasks, "_get_redis", return_value=redis), \
             patch.object(analytics_api, "_compute_revenue_summary", return_value={"mrr": 50.79}):
            analytics_tasks.snapshot_daily_mrr_task()

    def test_the_record_wins_over_a_stale_cache(self):
        # repair_mrr_history.py corrects the record; a cached copy of the
        # inflated points must not bring them back.
        firestore = FakeFirestore({"mrr_history": _history("2026-09-01", mrr=50.0)})
        redis = FakeRedis({MRR_KEY: json.dumps(_history("2026-09-01", "2026-09-02", mrr=900.0)["history"])})
        self._run(firestore, redis)
        self.assertEqual(firestore.docs["mrr_history"]["history"],
                         [{"date": "2026-09-01", "mrr": 50.0}, {"date": TODAY, "mrr": 50.79}])
        self.assertEqual(redis.dates(MRR_KEY), ["2026-09-01", TODAY])

    def test_an_unreadable_record_is_never_overwritten(self):
        firestore = FakeFirestore({"mrr_history": _history("2026-09-01", mrr=50.0)}, fail=True)
        redis = FakeRedis({MRR_KEY: json.dumps(_history("2026-09-01", mrr=50.0)["history"])})
        self._run(firestore, redis)
        self.assertEqual(firestore.writes, [])
        self.assertEqual(redis.dates(MRR_KEY), ["2026-09-01", TODAY])

    def test_without_redis_the_record_still_grows(self):
        firestore = FakeFirestore({"mrr_history": _history("2026-09-01", mrr=50.0)})
        self._run(firestore, None)
        self.assertEqual(firestore.dates("mrr_history"), ["2026-09-01", TODAY])


if __name__ == "__main__":
    unittest.main()
