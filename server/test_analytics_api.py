import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analytics_api


class FakeDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = True

    def to_dict(self):
        return self._data


class FakeQuery:
    def __init__(self, docs):
        self.docs = docs

    def where(self, field, operator, value):
        def matches(doc):
            actual = doc.to_dict().get(field)
            if operator == "==":
                return actual == value
            if operator == ">=":
                return actual is not None and actual >= value
            raise AssertionError(f"Unsupported fake query operator: {operator}")

        return FakeQuery([doc for doc in self.docs if matches(doc)])

    def limit(self, _count):
        return self

    def stream(self):
        return iter(self.docs)


class FakeDB:
    def __init__(self, collections):
        self.collections = collections

    def collection(self, name):
        return FakeQuery(self.collections.get(name, []))


class SubscriberFunnelTests(unittest.TestCase):
    def test_uses_revenuecat_trial_lifecycle_and_excludes_direct_paid_purchase(self):
        now = datetime.now(timezone.utc)
        users = [
            FakeDoc("trial-converted", {
                "createdAt": now - timedelta(days=8),
                "subscriptionStatus": "active",
                "lastActiveAt": now,
                "platform": "ios",
            }),
            FakeDoc("trial-open", {
                "createdAt": now - timedelta(days=4),
                "subscriptionStatus": "trial",
                "lastActiveAt": now,
                "platform": "ios",
            }),
            FakeDoc("direct-paid", {
                "createdAt": now - timedelta(days=2),
                "subscriptionStatus": "active",
                "lastActiveAt": now,
                "platform": "web",
            }),
        ]
        events = [
            FakeDoc("e1", {
                "appUserId": "trial-converted",
                "type": "INITIAL_PURCHASE",
                "periodType": "TRIAL",
                "occurredAt": now - timedelta(days=6),
                "platform": "ios",
                "environment": "PRODUCTION",
            }),
            FakeDoc("e2", {
                "appUserId": "trial-converted",
                "type": "RENEWAL",
                "periodType": "NORMAL",
                "occurredAt": now - timedelta(days=3),
                "platform": "ios",
                "environment": "PRODUCTION",
            }),
            FakeDoc("e3", {
                "appUserId": "trial-open",
                "type": "INITIAL_PURCHASE",
                "periodType": "TRIAL",
                "occurredAt": now - timedelta(days=2),
                "platform": "ios",
                "environment": "PRODUCTION",
            }),
            FakeDoc("e4", {
                "appUserId": "direct-paid",
                "type": "INITIAL_PURCHASE",
                "periodType": "NORMAL",
                "occurredAt": now - timedelta(days=2),
                "platform": "web",
                "environment": "PRODUCTION",
            }),
        ]
        fake_db = FakeDB({"users": users, "subscription_events": events})

        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}):
            result = analytics_api._compute_subscriber_funnel(30)

        stages = {row["stage"]: row["count"] for row in result["funnel"]}
        self.assertEqual(stages["Started Trial"], 2)
        self.assertEqual(stages["Converted to Paid"], 1)
        self.assertEqual(stages["Active (30d)"], 1)
        self.assertEqual(result["trialConversionRate"], 50.0)
        self.assertEqual(result["conversionByPlatform"], {"ios": 50.0})
        self.assertEqual(result["medianDaysToConvert"], 3.0)


if __name__ == "__main__":
    unittest.main()
