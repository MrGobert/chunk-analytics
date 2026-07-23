import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analytics_api


class FakeDoc:
    def __init__(self, doc_id, data, exists=True):
        self.id = doc_id
        self._data = data
        self.exists = exists

    def to_dict(self):
        return self._data


class FakeDocRef:
    def __init__(self, doc):
        self._doc = doc

    def get(self):
        return self._doc


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

    def order_by(self, field):
        return FakeQuery(sorted(self.docs, key=lambda d: d.to_dict().get(field)))

    def limit(self, _count):
        return self

    def stream(self):
        return iter(self.docs)


class FakeCollection(FakeQuery):
    def document(self, doc_id):
        for doc in self.docs:
            if doc.id == doc_id:
                return FakeDocRef(doc)
        return FakeDocRef(FakeDoc(doc_id, {}, exists=False))


class FakeDB:
    def __init__(self, collections):
        self.collections = collections

    def collection(self, name):
        return FakeCollection(self.collections.get(name, []))


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


class CustomerDetailTests(unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def _get_detail(self, users=None, events=None, emails=None, rc=None):
        fake_db = FakeDB({
            "users": users or [],
            "subscription_events": events or [],
            "emailTracking": emails or [],
        })
        rc_module = SimpleNamespace(get_current_subscription=rc or (lambda uid: None))
        with patch.dict(sys.modules, {
            "firebase_setup": SimpleNamespace(db=fake_db),
            "revenuecat_client": rc_module,
        }):
            return analytics_api._get_customer_detail("u1")

    def _user_doc(self, **overrides):
        data = {
            "email": "u1@example.com",
            "subscriptionStatus": "active",
            "platform": "ios",
            "createdAt": self.NOW - timedelta(days=100),
            "lastActiveAt": self.NOW - timedelta(days=1),
            "usageStats": {"monthlySearches": 10, "monthlyNotes": 2},
        }
        data.update(overrides)
        return FakeDoc("u1", data)

    def test_includes_health_factors_and_status(self):
        result = self._get_detail(users=[self._user_doc()])
        self.assertIn(result["healthStatus"], ("healthy", "atRisk", "churning"))
        self.assertEqual(
            set(result["healthFactors"]),
            {"recency", "frequency", "featureDepth", "tenure", "emailEngagement"},
        )
        self.assertTrue(result["hasUsageStats"])

    def test_has_usage_stats_false_when_untracked(self):
        result = self._get_detail(users=[self._user_doc(usageStats=None)])
        self.assertFalse(result["hasUsageStats"])
        self.assertEqual(result["usageStats"]["monthlySearches"], 0)

    def test_timeline_uses_subscription_events(self):
        events = [
            FakeDoc("e2", {
                "appUserId": "u1",
                "type": "TRIAL_CONVERTED",
                "periodType": "NORMAL",
                "occurredAt": self.NOW - timedelta(days=10),
                "platform": "ios",
                "store": "APP_STORE",
                "price": 9.99,
                "currency": "USD",
                "environment": "PRODUCTION",
            }),
            FakeDoc("e1", {
                "appUserId": "u1",
                "type": "INITIAL_PURCHASE",
                "periodType": "TRIAL",
                "occurredAt": self.NOW - timedelta(days=17),
                "platform": "ios",
                "environment": "PRODUCTION",
            }),
            FakeDoc("sandbox", {
                "appUserId": "u1",
                "type": "RENEWAL",
                "occurredAt": self.NOW - timedelta(days=3),
                "environment": "SANDBOX",
            }),
            FakeDoc("other-user", {
                "appUserId": "u2",
                "type": "RENEWAL",
                "occurredAt": self.NOW - timedelta(days=2),
                "environment": "PRODUCTION",
            }),
        ]
        result = self._get_detail(users=[self._user_doc()], events=events)

        self.assertEqual(result["subscriptionHistorySource"], "events")
        labels = [e["event"] for e in result["subscriptionHistory"]]
        # created entry prepended, then events oldest-first; sandbox and
        # other-user events excluded
        self.assertEqual(labels, ["created", "trial_started", "trial_converted"])
        converted = result["subscriptionHistory"][2]
        self.assertEqual(converted["source"], "revenuecat")
        self.assertEqual(converted["price"], 9.99)
        self.assertEqual(converted["store"], "APP_STORE")

    def test_timeline_falls_back_to_derived(self):
        user = self._user_doc(
            trialEndDate=self.NOW - timedelta(days=90),
            renewalDate=self.NOW + timedelta(days=20),
        )
        result = self._get_detail(users=[user])

        self.assertEqual(result["subscriptionHistorySource"], "derived")
        labels = [e["event"] for e in result["subscriptionHistory"]]
        self.assertEqual(labels, ["created", "trial_ends", "subscription_active"])
        self.assertTrue(all(e["source"] == "derived" for e in result["subscriptionHistory"]))

    def test_partial_profile_when_user_doc_missing_but_events_exist(self):
        events = [
            FakeDoc("e1", {
                "appUserId": "u1",
                "type": "INITIAL_PURCHASE",
                "periodType": "NORMAL",
                "occurredAt": self.NOW - timedelta(days=5),
                "environment": "PRODUCTION",
            }),
        ]
        result = self._get_detail(events=events)

        self.assertTrue(result["partialProfile"])
        self.assertIsNone(result["healthScore"])
        self.assertIsNone(result["healthFactors"])
        self.assertEqual(len(result["subscriptionHistory"]), 1)

    def test_returns_none_when_nothing_links_to_uid(self):
        self.assertIsNone(self._get_detail())

    def test_current_subscription_prefers_live_revenuecat(self):
        period_end = self.NOW + timedelta(days=14)
        rc = lambda uid: {
            "userExists": True,
            "isSubscribed": True,
            "status": "active",
            "store": "app_store",
            "productId": "chunk_monthly",
            "currentPeriodStartsAt": int((self.NOW - timedelta(days=16)).timestamp() * 1000),
            "currentPeriodEndsAt": int(period_end.timestamp() * 1000),
            "willRenew": True,
            "isSandbox": False,
        }
        result = self._get_detail(users=[self._user_doc()], rc=rc)

        sub = result["currentSubscription"]
        self.assertEqual(sub["source"], "revenuecat")
        self.assertTrue(sub["isSubscribed"])
        # epoch-ms timestamps serialized to ISO
        self.assertTrue(sub["currentPeriodEndsAt"].startswith(str(period_end.year)))

    def test_current_subscription_falls_back_to_firestore(self):
        user = self._user_doc(
            subscriptionStore="app_store",
            productId="chunk_monthly",
            subscriptionPrice=9.99,
            subscriptionCurrency="USD",
            renewalDate=self.NOW + timedelta(days=20),
        )
        result = self._get_detail(users=[user])

        sub = result["currentSubscription"]
        self.assertEqual(sub["source"], "firestore")
        self.assertEqual(sub["status"], "active")
        self.assertTrue(sub["willRenew"])
        self.assertEqual(sub["price"], 9.99)
        self.assertTrue(sub["currentPeriodEndsAt"])

    def test_firestore_fallback_marks_expired_as_not_renewing(self):
        user = self._user_doc(
            subscriptionStatus="expired",
            expirationDate=self.NOW - timedelta(days=30),
        )
        result = self._get_detail(users=[user])
        self.assertFalse(result["currentSubscription"]["willRenew"])

    def test_email_history_included_for_partial_profile(self):
        emails = [
            FakeDoc("m1", {
                "userId": "u1",
                "emailType": "welcome_day1",
                "sentAt": self.NOW - timedelta(days=9),
                "opened": True,
            }),
        ]
        result = self._get_detail(emails=emails)

        self.assertTrue(result["partialProfile"])
        self.assertEqual(result["emailHistory"][0]["emailType"], "welcome_day1")


if __name__ == "__main__":
    unittest.main()
