import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analytics_api
import revenuecat_client


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

    def test_scheduled_cancellation_remains_active_and_not_churned(self):
        now = datetime.now(timezone.utc)
        users = [
            FakeDoc("cancelled-paid", {
                "createdAt": now - timedelta(days=10),
                "trialStartedAt": now - timedelta(days=9),
                "trialEndDate": now - timedelta(days=6),
                "expirationDate": now + timedelta(days=20),
                "subscriptionStatus": "cancelled",
                "lastActiveAt": now - timedelta(days=1),
                "platform": "ios",
            }),
        ]
        fake_db = FakeDB({"users": users, "subscription_events": []})

        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}):
            result = analytics_api._compute_subscriber_funnel(30)

        stages = {row["stage"]: row["count"] for row in result["funnel"]}
        self.assertEqual(stages, {
            "Signed Up": 1,
            "Started Trial": 1,
            "Converted to Paid": 1,
            "Active (30d)": 1,
            "Churned": 0,
        })


class RevenueSummaryTests(unittest.TestCase):
    def test_paid_churn_and_mrr_exclude_trials_but_keep_scheduled_paid_cancels(self):
        now = datetime.now(timezone.utc)
        users = [
            FakeDoc("active-paid", {
                "subscriptionStatus": "active",
                "subscriptionPrice": 10,
                "createdAt": now - timedelta(days=100),
            }),
            FakeDoc("cancelled-paid", {
                "subscriptionStatus": "cancelled",
                "subscriptionPrice": 10,
                "expirationDate": now + timedelta(days=10),
                "createdAt": now - timedelta(days=100),
            }),
            FakeDoc("active-trial", {
                "subscriptionStatus": "trial",
                "trialEndDate": now + timedelta(days=3),
                "createdAt": now - timedelta(days=1),
            }),
            FakeDoc("cancelled-trial", {
                "subscriptionStatus": "cancelled",
                "trialEndDate": now + timedelta(days=5),
                "expirationDate": now + timedelta(days=5),
                "createdAt": now - timedelta(days=1),
            }),
            FakeDoc("expired-paid", {
                "subscriptionStatus": "expired",
                "expirationDate": now - timedelta(days=2),
                "createdAt": now - timedelta(days=100),
            }),
            FakeDoc("expired-trial", {
                "subscriptionStatus": "expired",
                "trialEndDate": now - timedelta(days=3),
                "expirationDate": now - timedelta(days=3),
                "createdAt": now - timedelta(days=6),
            }),
        ]
        fake_db = FakeDB({
            "users": users,
            "subscription_events": [],
            "analytics_cache": [],
        })

        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None):
            result = analytics_api._compute_revenue_summary(30)

        self.assertEqual(result["totalSubscribers"], 2)
        self.assertEqual(result["trialUsers"], 2)
        self.assertEqual(result["mrr"], 20)
        self.assertEqual(result["churned"], 1)


class HealthScoreTests(unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def _user(self):
        return {
            "lastActiveAt": self.NOW - timedelta(days=1),
            "createdAt": self.NOW - timedelta(days=200),
        }

    def test_frequency_and_depth_come_from_usage_monthly(self):
        health = analytics_api._compute_health_score(
            self._user(), self.NOW, {"searches": 20, "captures": 3})
        self.assertEqual(health["factors"]["frequency"], 100)
        self.assertEqual(health["factors"]["featureDepth"], 100)

    def test_single_signal_scores_half_depth(self):
        health = analytics_api._compute_health_score(
            self._user(), self.NOW, {"searches": 4, "captures": 0})
        self.assertEqual(health["factors"]["frequency"], 20)
        self.assertEqual(health["factors"]["featureDepth"], 50)

    def test_missing_usage_scores_zero_not_error(self):
        health = analytics_api._compute_health_score(self._user(), self.NOW, None)
        self.assertEqual(health["factors"]["frequency"], 0)
        self.assertEqual(health["factors"]["featureDepth"], 0)

    def test_dead_usage_stats_fields_are_ignored(self):
        # usageStats.monthly* lost all writers in cerebral dfe43f0 — a doc
        # that still carries stale values must not influence the score
        user = {**self._user(), "usageStats": {"monthlySearches": 50}}
        health = analytics_api._compute_health_score(user, self.NOW, None)
        self.assertEqual(health["factors"]["frequency"], 0)

    def test_usage_month_update_supplies_recency_when_profile_field_is_missing(self):
        user = {"createdAt": self.NOW - timedelta(days=200)}
        health = analytics_api._compute_health_score(
            user,
            self.NOW,
            {"searches": 1, "captures": 0,
             "_lastActiveAt": self.NOW - timedelta(days=1)},
        )
        self.assertGreaterEqual(health["factors"]["recency"], 96)

    def test_future_trial_end_is_not_used_as_tenure_start(self):
        user = {
            "lastActiveAt": self.NOW,
            "trialEndDate": self.NOW + timedelta(days=7),
        }
        health = analytics_api._compute_health_score(user, self.NOW)

        self.assertIsNone(analytics_api._get_tenure_date(user))
        self.assertEqual(health["factors"]["tenure"], 50)

    def test_trial_start_supplies_non_negative_tenure(self):
        user = {
            "lastActiveAt": self.NOW,
            "trialStartedAt": self.NOW - timedelta(days=10),
            "trialEndDate": self.NOW + timedelta(days=4),
        }
        health = analytics_api._compute_health_score(user, self.NOW)

        self.assertEqual(analytics_api._get_tenure_date(user), user["trialStartedAt"])
        self.assertEqual(health["factors"]["tenure"], 7)

    def test_cancelled_customer_keeps_access_until_expiration(self):
        self.assertTrue(analytics_api._has_current_subscription_access(
            {
                "subscriptionStatus": "cancelled",
                "expirationDate": self.NOW + timedelta(days=1),
            },
            self.NOW,
        ))
        self.assertFalse(analytics_api._has_current_subscription_access(
            {
                "subscriptionStatus": "cancelled",
                "expirationDate": self.NOW - timedelta(seconds=1),
            },
            self.NOW,
        ))


class FetchUsageMonthlyTests(unittest.TestCase):
    def test_month_keys_roll_january_back_to_december(self):
        keys = analytics_api._usage_month_keys(datetime(2026, 1, 15, tzinfo=timezone.utc))
        self.assertEqual(keys, ("2026-01", "2025-12"))

    def test_sums_both_months_and_maps_by_uid(self):
        now = datetime(2026, 8, 2, tzinfo=timezone.utc)
        requested = []

        updated_at = datetime(2026, 8, 2, 5, tzinfo=timezone.utc)

        def snap(uid, searches, captures, updated=None):
            return SimpleNamespace(
                exists=True,
                to_dict=lambda: {
                    "searches": searches,
                    "captures": captures,
                    "updated_at": updated.isoformat() if updated else None,
                },
                reference=SimpleNamespace(
                    parent=SimpleNamespace(parent=SimpleNamespace(id=uid))
                ),
            )

        class Db:
            def collection(self, _name):
                return SimpleNamespace(document=lambda uid: SimpleNamespace(
                    collection=lambda _n: SimpleNamespace(
                        document=lambda key: requested.append((uid, key))
                    )
                ))

            def get_all(self, refs):
                return [snap("u1", 5, 1), snap("u1", 7, 0, updated_at),
                        SimpleNamespace(exists=False)]

        usage = analytics_api._fetch_usage_monthly(Db(), ["u1", "u2"], now)

        self.assertEqual(usage, {"u1": {
            "searches": 12,
            "captures": 1,
            "_lastActiveAt": updated_at,
        }})
        self.assertEqual(requested, [
            ("u1", "2026-08"), ("u1", "2026-07"),
            ("u2", "2026-08"), ("u2", "2026-07"),
        ])


class PartialUsageStatsTests(unittest.TestCase):
    def test_one_failed_collection_does_not_blank_other_counts(self):
        import email_tasks

        class Ref:
            exists = True

            def collection(self, _name):
                return self

            def document(self, _name):
                return self

            def where(self, *_args):
                return self

            def get(self):
                return self

            def to_dict(self):
                return {"searches": 8, "captures": 3}

            def list_documents(self):
                return []

        ref = Ref()
        db = SimpleNamespace(collection=lambda _name: ref)
        with patch.object(
            email_tasks,
            "_count",
            side_effect=[2, RuntimeError("images unavailable"), 4, 5, 6],
        ):
            stats, unavailable = email_tasks._compute_recap_stats_with_availability(
                db,
                "u1",
                window=(
                    datetime(2026, 8, 1, tzinfo=timezone.utc),
                    datetime(2026, 9, 1, tzinfo=timezone.utc),
                    "2026-08",
                    "2026-09",
                ),
            )

        self.assertEqual(unavailable, ["images"])
        self.assertEqual(stats, {
            "searches": 8,
            "captures": 3,
            "documents": 2,
            "notes": 4,
            "collections": 5,
            "artifacts": 6,
            "automations": 0,
        })


class ChurnReasonTests(unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def _churned_user(self):
        return {
            "expirationDate": self.NOW - timedelta(days=5),
            "createdAt": self.NOW - timedelta(days=200),
            "lastActiveAt": self.NOW - timedelta(days=10),
        }

    def test_no_usage_monthly_reads_as_no_usage(self):
        reason = analytics_api._classify_churn_reason(self._churned_user(), self.NOW, None)
        self.assertEqual(reason, "No usage")

    def test_recent_usage_monthly_reclassifies(self):
        reason = analytics_api._classify_churn_reason(
            self._churned_user(), self.NOW, {"searches": 9, "captures": 2})
        self.assertEqual(reason, "Active user - unknown reason")


class CustomerDetailTests(unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def _get_detail(
        self,
        users=None,
        events=None,
        emails=None,
        rc=None,
        rc_profile=None,
        identity=None,
    ):
        fake_db = FakeDB({
            "users": users or [],
            "subscription_events": events or [],
            "emailTracking": emails or [],
        })
        rc_module = SimpleNamespace(
            get_current_subscription=rc or (lambda uid: None),
            get_customer_profile=rc_profile or (lambda uid: None),
        )
        with patch.object(
            analytics_api,
            "_firebase_auth_identity",
            return_value=identity or {},
        ), \
             patch.dict(sys.modules, {
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
        }
        data.update(overrides)
        return FakeDoc("u1", data)

    def test_includes_health_factors_and_status(self):
        sample_stats = {"searches": 9, "captures": 2, "documents": 1, "images": 0,
                        "notes": 3, "collections": 1, "automations": 0, "artifacts": 1}
        import email_tasks
        with patch.object(
            email_tasks,
            "_compute_recap_stats_with_availability",
            return_value=(sample_stats, []),
        ):
            result = self._get_detail(users=[self._user_doc()])
        self.assertIn(result["healthStatus"], ("healthy", "atRisk", "churning"))
        self.assertEqual(
            set(result["healthFactors"]),
            {"recency", "frequency", "featureDepth", "tenure", "emailEngagement"},
        )
        self.assertTrue(result["hasUsageStats"])
        self.assertEqual(result["usageStats"], sample_stats)

    def test_keeps_available_usage_fields_when_one_source_fails(self):
        import email_tasks
        with patch.object(
            email_tasks,
            "_compute_recap_stats_with_availability",
            return_value=({"searches": 7, "captures": 2}, ["documents"]),
        ):
            result = self._get_detail(users=[self._user_doc()])

        self.assertTrue(result["hasUsageStats"])
        self.assertEqual(result["usageStats"], {"searches": 7, "captures": 2})
        self.assertEqual(result["usageStatsUnavailableFields"], ["documents"])

    def test_has_usage_stats_false_when_counts_unavailable(self):
        # FakeDB cannot serve the count queries — the endpoint must degrade
        # to hasUsageStats=False instead of erroring or reporting zeros
        result = self._get_detail(users=[self._user_doc()])
        self.assertFalse(result["hasUsageStats"])
        self.assertEqual(result["usageStats"], {})

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
        self.assertEqual(labels, ["created", "trial_ends", "renews"])
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
        self.assertEqual(result["subscriptionStatus"], "active")
        # epoch-ms timestamps serialized to ISO
        self.assertTrue(sub["currentPeriodEndsAt"].startswith(str(period_end.year)))

    def test_live_revenuecat_status_overrides_stale_firestore_header(self):
        result = self._get_detail(
            users=[self._user_doc(subscriptionStatus="expired")],
            rc=lambda uid: {
                "userExists": True,
                "isSubscribed": True,
                "status": "active",
            },
        )
        self.assertEqual(result["subscriptionStatus"], "active")

    def test_sparse_live_subscription_keeps_firestore_details(self):
        period_end = self.NOW + timedelta(days=14)
        user = self._user_doc(
            subscriptionStore="APP_STORE",
            productId="chunk_monthly",
            subscriptionPrice=9.99,
            subscriptionCurrency="USD",
            renewalDate=period_end,
        )
        result = self._get_detail(
            users=[user],
            rc=lambda uid: {
                "userExists": True,
                "isSubscribed": True,
                "willRenew": None,
            },
        )

        sub = result["currentSubscription"]
        self.assertEqual(sub["source"], "revenuecat")
        self.assertEqual(sub["status"], "active")
        self.assertEqual(sub["store"], "APP_STORE")
        self.assertEqual(sub["productId"], "chunk_monthly")
        self.assertEqual(sub["price"], 9.99)
        self.assertIsNone(sub["willRenew"])
        self.assertTrue(sub["currentPeriodEndsAt"])

    def test_cancelled_firestore_subscription_is_entitled_but_not_renewing(self):
        result = self._get_detail(users=[self._user_doc(
            subscriptionStatus="cancelled",
            expirationDate=self.NOW + timedelta(days=5),
        )])

        sub = result["currentSubscription"]
        self.assertTrue(sub["isSubscribed"])
        self.assertFalse(sub["willRenew"])

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

    def test_revenuecat_not_found_preserves_firestore_mirror(self):
        user = self._user_doc(
            subscriptionStore="APP_STORE",
            productId="chunk_monthly",
            subscriptionPrice=9.99,
        )
        result = self._get_detail(
            users=[user], rc=lambda uid: {"userExists": False}
        )
        self.assertEqual(result["currentSubscription"]["source"], "firestore")
        self.assertFalse(result["currentSubscription"]["revenueCatUserExists"])

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

    def test_revenuecat_only_customer_is_a_partial_profile(self):
        result = self._get_detail(rc=lambda uid: {
            "userExists": True,
            "isSubscribed": True,
            "status": "active",
        })
        self.assertTrue(result["partialProfile"])
        self.assertEqual(result["currentSubscription"]["source"], "revenuecat")

    def test_revenuecat_profile_fills_rc_only_customer_identity(self):
        result = self._get_detail(
            rc=lambda uid: {
                "userExists": True,
                "isSubscribed": False,
                "status": "not_subscribed",
            },
            rc_profile=lambda uid: {
                "uid": uid,
                "revenueCatCustomerId": "canonical-customer",
                "email": "billing@example.org",
                "displayName": "Billing Profile",
                "platform": "ios",
                "createdAt": int(
                    (self.NOW - timedelta(days=60)).timestamp() * 1000
                ),
                "lastActiveAt": int(
                    (self.NOW - timedelta(days=2)).timestamp() * 1000
                ),
            },
        )

        self.assertTrue(result["partialProfile"])
        self.assertEqual(result["email"], "billing@example.org")
        self.assertEqual(result["name"], "Billing Profile")
        self.assertEqual(result["platform"], "ios")
        self.assertTrue(result["createdAt"])
        self.assertTrue(result["lastActiveAt"])
        self.assertIsNotNone(result["healthFactors"])

    def test_revenuecat_profile_stays_below_auth_identity_precedence(self):
        result = self._get_detail(
            users=[self._user_doc(email="stale@example.org")],
            identity={
                "uid": "u1",
                "email": "auth@example.org",
                "displayName": "Auth Profile",
            },
            rc_profile=lambda uid: {
                "uid": uid,
                "revenueCatCustomerId": "canonical-customer",
                "email": "billing@example.org",
                "displayName": "Billing Profile",
                "platform": "android",
            },
        )

        self.assertEqual(result["email"], "auth@example.org")
        self.assertEqual(result["name"], "Auth Profile")
        self.assertEqual(result["platform"], "ios")

    def test_auth_identity_fills_sparse_native_profile(self):
        fake_db = FakeDB({"users": [FakeDoc("u1", {"firstName": "Ada", "lastName": "Lovelace"})]})
        created_ms = int((self.NOW - timedelta(days=400)).timestamp() * 1000)
        identity = {
            "uid": "u1",
            "email": "ada@example.org",
            "displayName": "",
            "authCreatedAt": created_ms,
            "authLastSignInAt": int(self.NOW.timestamp() * 1000),
        }
        with patch.object(analytics_api, "_firebase_auth_identity", return_value=identity), \
             patch.dict(sys.modules, {
                 "firebase_setup": SimpleNamespace(db=fake_db),
                 "revenuecat_client": SimpleNamespace(
                     get_current_subscription=lambda uid: None,
                     get_customer_profile=lambda uid: None,
                 ),
             }):
            result = analytics_api._get_customer_detail("u1")

        self.assertEqual(result["email"], "ada@example.org")
        self.assertEqual(result["name"], "Ada Lovelace")
        self.assertTrue(result["createdAt"])
        self.assertTrue(result["lastActiveAt"])

    def test_auth_email_and_newer_sign_in_override_stale_firestore_mirror(self):
        firestore_last_active = self.NOW - timedelta(days=30)
        auth_last_active = self.NOW - timedelta(hours=2)
        auth_last_active_ms = int(auth_last_active.timestamp() * 1000)
        fake_db = FakeDB({"users": [FakeDoc("u1", {
            "email": "old@example.org",
            "createdAt": self.NOW - timedelta(days=100),
            "lastActiveAt": firestore_last_active,
        })]})
        identity = {
            "uid": "u1",
            "email": "current@example.org",
            "authLastSignInAt": auth_last_active_ms,
        }
        with patch.object(
            analytics_api, "_firebase_auth_identity", return_value=identity
        ), patch.dict(sys.modules, {
            "firebase_setup": SimpleNamespace(db=fake_db),
            "revenuecat_client": SimpleNamespace(
                get_current_subscription=lambda uid: None,
                get_customer_profile=lambda uid: None,
            ),
        }):
            result = analytics_api._get_customer_detail("u1")

        self.assertEqual(result["email"], "current@example.org")
        self.assertEqual(
            analytics_api._to_datetime(result["lastActiveAt"]),
            datetime.fromtimestamp(
                auth_last_active_ms / 1000, tz=timezone.utc
            ),
        )

    def test_auth_only_uid_with_slash_skips_invalid_firestore_document_path(self):
        uid = "tenant/customer"

        class UsersCollection(FakeCollection):
            def document(self, doc_id):
                if "/" in doc_id:
                    raise AssertionError("slash UID must not become a Firestore doc path")
                return super().document(doc_id)

        class DB(FakeDB):
            def collection(self, name):
                if name == "users":
                    return UsersCollection([])
                return super().collection(name)

        identity = {
            "uid": uid,
            "email": "owner@example.org",
            "authCreatedAt": int(
                (self.NOW - timedelta(days=30)).timestamp() * 1000
            ),
        }
        with patch.object(
            analytics_api, "_firebase_auth_identity", return_value=identity
        ), patch.object(
            analytics_api, "_fetch_usage_monthly", return_value={}
        ), patch.dict(sys.modules, {
            "firebase_setup": SimpleNamespace(db=DB({
                "subscription_events": [],
                "emailTracking": [],
            })),
            "revenuecat_client": SimpleNamespace(
                get_current_subscription=lambda _uid: None,
                get_customer_profile=lambda _uid: None,
            ),
        }):
            result = analytics_api._get_customer_detail(uid)

        self.assertTrue(result["partialProfile"])
        self.assertEqual(result["uid"], uid)
        self.assertEqual(result["email"], "owner@example.org")

    def test_email_history_replaces_sent_marker_health_proxy(self):
        emails_sent = {f"marker-{index}": self.NOW for index in range(7)}
        emails = [
            FakeDoc("m1", {
                "userId": "u1",
                "emailType": "monthly_recap",
                "sentAt": self.NOW - timedelta(days=2),
                "delivered": True,
                "opened": False,
                "clicked": False,
            }),
        ]
        result = self._get_detail(
            users=[self._user_doc(emailsSent=emails_sent)],
            emails=emails,
        )

        self.assertEqual(result["healthFactors"]["emailEngagement"], 0)


class CustomerSearchTests(unittest.TestCase):
    def _find(self, query, users, by_email=None, by_uid=None, revenuecat=None):
        fake_db = FakeDB({"users": users})
        with patch.dict(sys.modules, {
                 "firebase_setup": SimpleNamespace(db=fake_db),
                 "revenuecat_client": SimpleNamespace(
                     search_customer=lambda _query: revenuecat
                 ),
             }), \
             patch.object(
                 analytics_api, "_firebase_auth_identity_by_email",
                 return_value=by_email or {},
             ), patch.object(
                 analytics_api, "_firebase_auth_identity", return_value=by_uid or {},
             ):
            return analytics_api._find_customer(query)

    def test_exact_uid_lookup_returns_profile_basics_and_name_fallback(self):
        result = self._find("uid-2", [FakeDoc("uid-2", {
            "email": "person@example.org",
            "firstName": "Grace",
            "lastName": "Hopper",
            "subscriptionStatus": "active",
        })])
        self.assertEqual(result["uid"], "uid-2")
        self.assertEqual(result["name"], "Grace Hopper")
        self.assertEqual(result["email"], "person@example.org")

    def test_normalized_email_uses_auth_canonical_uid(self):
        identity = {
            "uid": "canonical-uid",
            "email": "person@example.org",
            "displayName": "Auth Name",
        }
        result = self._find(
            "  PERSON@EXAMPLE.ORG ",
            [FakeDoc("canonical-uid", {"subscriptionStatus": "trial"})],
            by_email=identity,
        )
        self.assertEqual(result["uid"], "canonical-uid")
        self.assertEqual(result["email"], "person@example.org")
        self.assertEqual(result["subscriptionStatus"], "trial")

    def test_exact_auth_uid_with_at_sign_wins_before_email_lookup(self):
        identity = {
            "uid": "acct@tenant",
            "email": "owner@example.org",
        }
        result = self._find(
            "acct@tenant",
            [],
            by_email={"uid": "wrong-user", "email": "acct@tenant"},
            by_uid=identity,
        )

        self.assertEqual(result["uid"], "acct@tenant")
        self.assertEqual(result["email"], "owner@example.org")

    def test_exact_auth_uid_with_slash_bypasses_firestore_document_lookup(self):
        uid = "tenant/customer"

        class UsersCollection(FakeCollection):
            def document(self, doc_id):
                if "/" in doc_id:
                    raise AssertionError("slash UID must not become a Firestore doc path")
                return super().document(doc_id)

        class DB(FakeDB):
            def collection(self, name):
                if name == "users":
                    return UsersCollection([])
                return super().collection(name)

        identity = {"uid": uid, "email": "owner@example.org"}
        with patch.dict(sys.modules, {
            "firebase_setup": SimpleNamespace(db=DB({})),
            "revenuecat_client": SimpleNamespace(
                search_customer=lambda _query: None
            ),
        }), patch.object(
            analytics_api, "_firebase_auth_identity", return_value=identity
        ), patch.object(
            analytics_api, "_firebase_auth_identity_by_email", return_value={}
        ):
            result = analytics_api._find_customer(uid)

        self.assertEqual(result["uid"], uid)
        self.assertEqual(result["email"], "owner@example.org")

    def test_firestore_email_fallback_is_deterministic(self):
        users = [
            FakeDoc("z-user", {"email": "same@example.org"}),
            FakeDoc("a-user", {"email": "same@example.org"}),
        ]
        result = self._find("same@example.org", users)
        self.assertEqual(result["uid"], "a-user")

    def test_revenuecat_only_email_fallback_returns_canonical_uid(self):
        result = self._find(
            "billing@example.org",
            [],
            revenuecat={
                "uid": "revenuecat-only",
                "email": "billing@example.org",
                "platform": "ios",
            },
        )
        self.assertEqual(result["uid"], "revenuecat-only")
        self.assertEqual(result["email"], "billing@example.org")

    def test_endpoint_validates_query_and_returns_404(self):
        app = Flask(__name__)
        app.register_blueprint(analytics_api.analytics_api_bp, url_prefix="/api/analytics")
        with patch("auth.verify_auth", return_value=True), \
             patch.object(analytics_api, "_find_customer", return_value=None):
            missing = app.test_client().get("/api/analytics/customer-search")
            not_found = app.test_client().get(
                "/api/analytics/customer-search?q=nobody%40example.org"
            )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(not_found.status_code, 404)
        self.assertEqual(not_found.get_json(), {"error": "Customer not found"})

    def test_query_detail_endpoint_preserves_reserved_uid_characters(self):
        app = Flask(__name__)
        app.register_blueprint(
            analytics_api.analytics_api_bp, url_prefix="/api/analytics"
        )
        expected_uid = "acct/tenant?region#1"
        with patch("auth.verify_auth", return_value=True), patch.object(
            analytics_api,
            "_get_customer_detail",
            return_value={"uid": expected_uid},
        ) as detail:
            response = app.test_client().get(
                "/api/analytics/customer-detail",
                query_string={"uid": expected_uid},
            )

        self.assertEqual(response.status_code, 200)
        detail.assert_called_once_with(expected_uid)


class RevenueCatClientTests(unittest.TestCase):
    class Response:
        def __init__(self, payload, status_code=200):
            self.payload = payload
            self.status_code = status_code

        def json(self):
            return self.payload

    def _get(self, items, uid="u/1@example.org"):
        with patch.object(
            revenuecat_client, "_config", return_value=("secret", "project-1")
        ), patch.object(
            revenuecat_client.httpx,
            "get",
            return_value=self.Response({"items": items}),
        ) as request:
            result = revenuecat_client.get_current_subscription(uid)
        return result, request

    def _search(self, items, query="person@example.org", direct_customer=None):
        responses = (
            [self.Response(direct_customer)]
            if direct_customer is not None
            else [
                self.Response({}, status_code=404),
                self.Response({"items": items}),
            ]
        )
        with patch.object(
            revenuecat_client, "_config", return_value=("secret", "project-1")
        ), patch.object(
            revenuecat_client.httpx, "get", side_effect=responses
        ) as request:
            result = revenuecat_client.search_customer(query)
        return result, request

    def test_accessible_subscription_wins_and_uses_auto_renewal_status(self):
        result, request = self._get([
            {
                "gives_access": True,
                "status": "trialing",
                "store": "app_store",
                "product_id": "monthly",
                "current_period_starts_at": 1000,
                "current_period_ends_at": 2000,
                "auto_renewal_status": "will_not_renew",
            },
            {
                "gives_access": False,
                "status": "expired",
                "current_period_ends_at": 9000,
            },
        ])
        self.assertTrue(result["isSubscribed"])
        self.assertEqual(result["status"], "trialing")
        self.assertFalse(result["willRenew"])
        self.assertIn("u%2F1%40example.org", request.call_args.args[0])
        self.assertEqual(
            request.call_args.kwargs["params"],
            {"environment": "production", "limit": 100},
        )

    def test_expired_customer_keeps_latest_subscription_details(self):
        result, _ = self._get([
            {
                "gives_access": False,
                "status": "expired",
                "store": "app_store",
                "product_id": "annual",
                "current_period_ends_at": 8000,
                "auto_renewal_status": "will_not_renew",
            },
        ])
        self.assertFalse(result["isSubscribed"])
        self.assertEqual(result["status"], "expired")
        self.assertEqual(result["productId"], "annual")
        self.assertFalse(result["willRenew"])

    def test_customer_with_no_subscriptions_is_explicitly_not_subscribed(self):
        result, _ = self._get([])

        self.assertTrue(result["userExists"])
        self.assertFalse(result["isSubscribed"])
        self.assertEqual(result["status"], "not_subscribed")
        self.assertFalse(result["willRenew"])

    def test_customer_search_matches_exact_email_and_maps_profile_fields(self):
        result, request = self._search([
            {
                "id": "canonical-uid",
                "first_seen_at": 1000,
                "last_seen_at": 2000,
                "last_seen_platform": "ios",
                "attributes": {
                    "items": [
                        {"name": "$email", "value": "person@example.org"},
                        {"name": "$displayName", "value": "Person Example"},
                    ],
                },
            },
        ])

        self.assertEqual(result["uid"], "canonical-uid")
        self.assertEqual(result["email"], "person@example.org")
        self.assertEqual(result["displayName"], "Person Example")
        self.assertEqual(result["platform"], "ios")
        self.assertEqual(
            request.call_args_list[1].kwargs["params"],
            {"search": "person@example.org", "limit": 100},
        )

    def test_customer_search_preserves_entered_alias_separately_from_rc_id(self):
        result, request = self._search(
            [],
            query="acct@tenant",
            direct_customer={
                "id": "canonical-customer",
                "attributes": {
                    "items": [{"name": "$email", "value": "owner@example.org"}],
                },
            },
        )

        self.assertEqual(result["uid"], "acct@tenant")
        self.assertEqual(result["revenueCatCustomerId"], "canonical-customer")
        self.assertIn("acct%40tenant", request.call_args.args[0])
        self.assertEqual(
            request.call_args.kwargs["params"],
            {"expand": "attributes"},
        )


if __name__ == "__main__":
    unittest.main()
