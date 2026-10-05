import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))
import account_activity
import analytics_api
import revenuecat_client
from firebase_admin import auth as firebase_auth

_AUTH_GUARDS = []


def setUpModule():
    # firebase_setup initializes the default app from this machine's
    # credentials, so an unpatched Auth call would reach the real project.
    # Fail it instead; tests stub what they read (ActivityStubs,
    # _firebase_auth_identity).
    for name in ("get_user", "get_user_by_email", "get_users", "list_users"):
        patcher = patch.object(firebase_auth, name, side_effect=AssertionError(f"real Firebase Auth {name} call"))
        patcher.start()
        _AUTH_GUARDS.append(patcher)


def tearDownModule():
    while _AUTH_GUARDS:
        _AUTH_GUARDS.pop().stop()


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

    def get_all(self, refs):
        return [ref.get() for ref in refs]


def ledger_event(event_id, uid, event_type, occurred, expires=None, **fields):
    """A subscription_ledger record as cerebral writes it (services/subscription/ledger.py there)."""
    data = {
        "appUserId": uid,
        "type": event_type,
        "periodType": "NORMAL",
        "store": "APP_STORE",
        "environment": "PRODUCTION",
        "price": 4.99,
        "isFamilyShare": False,
        "occurredAt": occurred,
        "expirationAt": expires,
        "updatedAt": occurred,
    }
    data.update(fields)
    return FakeDoc(event_id, data)


DAY_MS = 24 * 3600 * 1000


def _auth_record(uid, refreshed_days_ago=None, disabled=False):
    """A Firebase Auth record created and last signed in long ago, whose ID
    token was last refreshed refreshed_days_ago (never, when None)."""
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    return SimpleNamespace(
        uid=uid,
        disabled=disabled,
        user_metadata=SimpleNamespace(
            creation_timestamp=int(now_ms - 400 * DAY_MS),
            last_sign_in_timestamp=int(now_ms - 300 * DAY_MS),
            last_refresh_timestamp=(
                None if refreshed_days_ago is None else int(now_ms - refreshed_days_ago * DAY_MS)
            ),
        ),
    )


class FakeAuth:
    """firebase_admin.auth.get_users over a fixed set of records."""

    def __init__(self, records=()):
        self.records = {record.uid: record for record in records}
        self.calls = []

    def get_users(self, identifiers):
        identifiers = list(identifiers)
        assert len(identifiers) <= 100, "get_users takes at most 100 identifiers"
        self.calls.append([identifier.uid for identifier in identifiers])
        return SimpleNamespace(
            users=[self.records[i.uid] for i in identifiers if i.uid in self.records],
            not_found=[i for i in identifiers if i.uid not in self.records],
        )


class ActivityStubs:
    """Stubs both signals account_activity reads. No test may reach live
    Firebase Auth: firebase_setup initializes the default app from ADC when
    no credentials are set."""

    def stub_activity(self, records=(), used=()):
        self.auth = FakeAuth(records)
        self.used_since_calls = []

        def used_since(_db, uid, _since):
            self.used_since_calls.append(uid)
            return uid in used

        for patcher in (
            patch.object(firebase_auth, "get_users", self.auth.get_users),
            patch.object(account_activity, "used_since", side_effect=used_since),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)


class SubscriberFunnelTests(ActivityStubs, unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def setUp(self):
        self.stub_activity()

    def test_uses_revenuecat_trial_lifecycle_and_excludes_direct_paid_purchase(self):
        now = datetime.now(timezone.utc)
        users = [
            FakeDoc("trial-converted", {
                "createdAt": now - timedelta(days=8),
                "subscriptionStatus": "active",
                "platform": "ios",
            }),
            FakeDoc("trial-open", {
                "createdAt": now - timedelta(days=4),
                "subscriptionStatus": "trial",
                "platform": "ios",
            }),
            FakeDoc("direct-paid", {
                "createdAt": now - timedelta(days=2),
                "subscriptionStatus": "active",
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
        fake_db = FakeDB({"users": users, "subscription_ledger": events})
        self.stub_activity(records=[
            _auth_record(uid, refreshed_days_ago=1)
            for uid in ("trial-converted", "trial-open", "direct-paid")
        ])

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
                "platform": "ios",
            }),
        ]
        fake_db = FakeDB({"users": users, "subscription_ledger": []})
        self.stub_activity(records=[_auth_record("cancelled-paid", refreshed_days_ago=1)])

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

    def _paying(self, uid):
        """An account whose trial converted and that still has paid access."""
        return FakeDoc(uid, {
            "createdAt": self.NOW - timedelta(days=10),
            "trialStartedAt": self.NOW - timedelta(days=9),
            "trialEndDate": self.NOW - timedelta(days=6),
            "expirationDate": self.NOW + timedelta(days=20),
            "subscriptionStatus": "cancelled",
            "platform": "ios",
        })

    def _stages(self, users):
        fake_db = FakeDB({"users": users, "subscription_ledger": []})
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}):
            result = analytics_api._compute_subscriber_funnel(30)
        return {row["stage"]: row["count"] for row in result["funnel"]}

    def test_a_token_refresh_counts_as_use_without_any_firestore_read(self):
        self.stub_activity(records=[_auth_record("paying", refreshed_days_ago=2)])
        self.assertEqual(self._stages([self._paying("paying")])["Active (30d)"], 1)
        self.assertEqual(self.used_since_calls, [])

    def test_a_capture_or_chat_counts_when_auth_saw_nothing(self):
        # The clipper, the share sheet and email-in never refresh a token.
        self.stub_activity(records=[_auth_record("paying", refreshed_days_ago=45)], used={"paying"})
        self.assertEqual(self._stages([self._paying("paying")])["Active (30d)"], 1)

    def test_a_quiet_subscriber_is_not_active(self):
        self.stub_activity(records=[_auth_record("paying", refreshed_days_ago=45)])
        self.assertEqual(self._stages([self._paying("paying")])["Active (30d)"], 0)
        self.assertEqual(self.used_since_calls, ["paying"])

    def test_the_user_docs_last_active_fields_do_not_count(self):
        # Nothing writes lastActiveAt, and the account's owner can.
        user = self._paying("paying")
        user._data["lastActiveAt"] = self.NOW
        self.stub_activity(records=[_auth_record("paying", refreshed_days_ago=45)])
        self.assertEqual(self._stages([user])["Active (30d)"], 0)

    def test_no_paying_account_no_lookup(self):
        self._stages([])
        self.assertEqual(self.auth.calls, [])

    def test_a_failed_lookup_counts_nobody_and_the_funnel_still_returns(self):
        with patch.object(firebase_auth, "get_users", side_effect=RuntimeError("auth down")):
            stages = self._stages([self._paying("paying")])
        self.assertEqual(stages["Converted to Paid"], 1)
        self.assertEqual(stages["Active (30d)"], 0)


class ActiveSinceTests(ActivityStubs, unittest.TestCase):
    """account_activity.active_since: who used Chunk since a moment."""

    SINCE = datetime.now(timezone.utc) - timedelta(days=30)

    def test_firestore_only_for_the_accounts_auth_did_not_show(self):
        self.stub_activity(
            records=[
                _auth_record("seen", refreshed_days_ago=1),
                _auth_record("quiet", refreshed_days_ago=45),
                _auth_record("clipper", refreshed_days_ago=45),
            ],
            used={"clipper"},
        )
        active = account_activity.active_since(None, ["seen", "quiet", "clipper"], self.SINCE)
        self.assertEqual(active, {"seen", "clipper"})
        self.assertEqual(sorted(self.used_since_calls), ["clipper", "quiet"])

    def test_disabled_and_deleted_accounts_are_never_active(self):
        self.stub_activity(
            records=[_auth_record("disabled", refreshed_days_ago=1, disabled=True)],
            used={"disabled", "deleted"},
        )
        self.assertEqual(account_activity.active_since(None, ["disabled", "deleted"], self.SINCE), set())
        self.assertEqual(self.used_since_calls, [])

    def test_asks_auth_100_accounts_at_a_time(self):
        uids = [f"uid-{i}" for i in range(150)]
        self.stub_activity(records=[_auth_record(uid, refreshed_days_ago=1) for uid in uids])
        self.assertEqual(account_activity.active_since(None, uids + uids[:5], self.SINCE), set(uids))
        self.assertEqual([len(call) for call in self.auth.calls], [100, 50])


class LastSeenByUidTests(ActivityStubs, unittest.TestCase):
    """account_activity.last_seen_by_uid: when each account last used Chunk,
    by Firebase Auth alone."""

    def test_asks_auth_100_accounts_at_a_time_and_reads_no_firestore(self):
        uids = [f"uid-{i}" for i in range(150)]
        self.stub_activity(records=[_auth_record(uid, refreshed_days_ago=1) for uid in uids])

        seen = account_activity.last_seen_by_uid(uids + uids[:5])

        self.assertEqual(set(seen), set(uids))
        self.assertEqual([len(call) for call in self.auth.calls], [100, 50])
        self.assertEqual(self.used_since_calls, [])

    def test_unknown_accounts_are_left_out_and_disabled_ones_kept(self):
        self.stub_activity(records=[_auth_record("disabled", refreshed_days_ago=3, disabled=True)])

        seen = account_activity.last_seen_by_uid(["disabled", "deleted"])

        self.assertEqual(list(seen), ["disabled"])
        self.assertEqual((datetime.now(timezone.utc) - seen["disabled"]).days, 3)


class LedgerQuery(FakeCollection):
    """Logs each read: the field it was bounded by, and how many docs came back."""

    def __init__(self, docs, log, bound_by=None):
        super().__init__(docs)
        self.log = log
        self.bound_by = bound_by

    def where(self, field, operator, value):
        narrowed = super().where(field, operator, value)
        return LedgerQuery(narrowed.docs, self.log, self.bound_by or field)

    def stream(self):
        self.log.append((self.bound_by, len(self.docs)))
        return iter(self.docs)


class LedgerDB(FakeDB):
    def __init__(self, events):
        super().__init__({"subscription_ledger": list(events)})
        self.reads = []

    def collection(self, name):
        return LedgerQuery(self.collections.get(name, []), self.reads)


class LedgerReadTests(unittest.TestCase):
    """subscription_ledger is cerebral's record of every RevenueCat event. Its
    490-day read is about 1,600 events, and a snapshot run computes three
    revenue, funnel and churn windows every 15 minutes: one read serves them
    all, and later runs read only the records written since."""

    NOW = datetime.now(timezone.utc)

    def _event(self, name, days_ago, environment="PRODUCTION", updated_at=None):
        occurred = self.NOW - timedelta(days=days_ago)
        return FakeDoc(name, {
            "appUserId": f"uid-{name}",
            "type": "RENEWAL",
            "periodType": "NORMAL",
            "store": "APP_STORE",
            "environment": environment,
            "occurredAt": occurred,
            "updatedAt": updated_at or occurred,
        })

    def _week(self, db):
        events = analytics_api._subscription_events_since(db, self.NOW - timedelta(days=7))
        return sorted(event["appUserId"] for event in events)

    def _written_now(self, name, days_ago):
        return self._event(name, days_ago, updated_at=datetime.now(timezone.utc))

    def test_one_read_serves_every_window(self):
        db = LedgerDB([
            self._event("recent", 1),
            self._event("sandbox", 2, environment="SANDBOX"),
            self._event("older", 200),
            self._event("ancient", 500),
        ])

        week = analytics_api._subscription_events_since(db, self.NOW - timedelta(days=7))
        quarter = analytics_api._subscription_events_since(db, self.NOW - timedelta(days=90))
        sandbox_only, _ = analytics_api._non_paying_uids_from_events(db, self.NOW - timedelta(days=400))
        # Churn intelligence's 90-day window looks for payments a year and a
        # month before it.
        analytics_api._paid_subscriptions(
            db, self.NOW - timedelta(days=90) - analytics_api.PAID_PERIOD_LOOKBACK, self.NOW)

        # One read, bounded by date: the 500-day-old event never came back.
        self.assertEqual(db.reads, [("occurredAt", 3)])
        self.assertEqual([e["appUserId"] for e in week], ["uid-recent"])
        self.assertEqual([e["appUserId"] for e in quarter], ["uid-recent"])
        self.assertEqual(sandbox_only, {"uid-sandbox"})

    def test_no_read_before_a_refresh_is_due(self):
        db = LedgerDB([self._event("recent", 1)])
        self._week(db)
        self._week(db)
        self.assertEqual(db.reads, [("occurredAt", 1)])

    def test_a_refresh_reads_only_what_was_written_since(self):
        db = LedgerDB([self._event("old", 3)])
        self._week(db)
        db.collections["subscription_ledger"].append(self._written_now("new", 0))
        with patch.object(analytics_api, "LEDGER_REFRESH_SECONDS", 0):
            week = self._week(db)
        self.assertEqual(db.reads, [("occurredAt", 1), ("updatedAt", 1)])
        self.assertEqual(week, ["uid-new", "uid-old"])

    def test_a_retried_event_counts_once(self):
        db = LedgerDB([self._event("evt", 1)])
        self._week(db)
        # RevenueCat sent it again, and cerebral rewrote the same record.
        db.collections["subscription_ledger"] = [self._written_now("evt", 1)]
        with patch.object(analytics_api, "LEDGER_REFRESH_SECONDS", 0):
            week = self._week(db)
        self.assertEqual(db.reads, [("occurredAt", 1), ("updatedAt", 1)])
        self.assertEqual(week, ["uid-evt"])

    def test_reads_the_whole_look_back_again_every_few_hours(self):
        db = LedgerDB([self._event("recent", 1)])
        self._week(db)
        with patch.object(analytics_api, "LEDGER_FULL_READ_SECONDS", 0):
            self._week(db)
        self.assertEqual(db.reads, [("occurredAt", 1), ("occurredAt", 1)])

    def test_a_refresh_that_fills_a_read_reads_everything_instead(self):
        db = LedgerDB([self._event("old", 3)])
        self._week(db)
        db.collections["subscription_ledger"].append(self._written_now("new", 0))
        with patch.object(analytics_api, "LEDGER_REFRESH_SECONDS", 0), \
             patch.object(analytics_api, "LEDGER_READ_LIMIT", 1):
            week = self._week(db)
        self.assertEqual(db.reads, [("occurredAt", 1), ("updatedAt", 1), ("occurredAt", 2)])
        self.assertEqual(week, ["uid-new", "uid-old"])

    def test_a_window_older_than_the_read_reads_again(self):
        db = LedgerDB([self._event("ancient", 500)])
        self._week(db)
        older = analytics_api._subscription_events_since(db, self.NOW - timedelta(days=600))
        self.assertEqual(db.reads, [("occurredAt", 0), ("occurredAt", 1)])
        self.assertEqual([e["appUserId"] for e in older], ["uid-ancient"])

    def test_another_database_never_gets_this_ones_events(self):
        self._week(LedgerDB([self._event("recent", 1)]))
        other = LedgerDB([])
        self.assertEqual(self._week(other), [])
        self.assertEqual(other.reads, [("occurredAt", 0)])


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
                "subscriptionPrice": 10,
                "subscriptionStore": "APP_STORE",
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
        # The ledger can't be read, so the user docs' webhook fields decide
        fake_db = ChurnDB({"users": users, "analytics_cache": []}, ledger_fails=True)

        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None):
            result = analytics_api._compute_revenue_summary(30)

        self.assertEqual(result["totalSubscribers"], 2)
        self.assertEqual(result["trialUsers"], 2)
        self.assertEqual(result["mrr"], 20)
        self.assertEqual(result["churned"], 1)


class RevenueGuardTests(unittest.TestCase):
    """The doc fallback, for when the ledger can't be read, and its regressions
    from the September 2026 $250k MRR incident.

    Two defects stacked: cerebral stored RevenueCat's local-currency price in
    subscriptionPrice, and the native app wrote subscriptionStatus "active" for
    anyone holding an entitlement — trials, sandbox builds and promo grants
    included. MRR summed the first over the second.
    """

    NOW = datetime.now(timezone.utc)

    def _paid(self, **overrides):
        """A subscriber the RevenueCat webhook confirmed and priced in USD."""
        data = {
            "subscriptionStatus": "active",
            "subscriptionPrice": 9.99,
            "subscriptionCurrency": "USD",
            "subscriptionPeriod": "monthly",
            "subscriptionStore": "APP_STORE",
            "latestTransactionId": "txn-1",
            "renewalDate": self.NOW + timedelta(days=20),
            "createdAt": self.NOW - timedelta(days=100),
        }
        data.update(overrides)
        return data

    def _summarize(self, users):
        fake_db = ChurnDB({"users": users, "analytics_cache": []}, ledger_fails=True)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None):
            return analytics_api._compute_revenue_summary(30)

    def test_foreign_currency_price_is_not_summed_as_dollars(self):
        """249,000 VND is Apple's $9.99 tier in Vietnam, not $249,000 of MRR."""
        result = self._summarize([
            FakeDoc("vnd-monthly", self._paid(
                subscriptionPrice=249000.0, subscriptionCurrency="VND",
            )),
            FakeDoc("usd-monthly", self._paid()),
        ])

        self.assertEqual(result["mrr"], 9.99)
        self.assertEqual(result["excludedNonUsd"], 1)
        self.assertEqual(result["unpricedSubscribers"], 1)
        self.assertEqual(result["pricedSubscribers"], 1)
        # Still a real subscriber — only their price is unusable.
        self.assertEqual(result["totalSubscribers"], 2)

    def test_implausible_price_is_rejected_even_without_a_currency_field(self):
        """The backstop for currency metadata that never arrived."""
        result = self._summarize([
            FakeDoc("no-currency", self._paid(
                subscriptionPrice=249000.0, subscriptionCurrency=None,
            )),
        ])

        self.assertEqual(result["mrr"], 0)
        self.assertEqual(result["unpricedSubscribers"], 1)

    def test_client_written_active_status_is_not_a_subscriber(self):
        """The native app writes subscriptionStatus and nothing else."""
        result = self._summarize([
            FakeDoc("ghost", {
                "subscriptionStatus": "active",
                "createdAt": self.NOW - timedelta(days=10),
            }),
            FakeDoc("real", self._paid()),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["excludedNoProvenance"], 1)
        # The old DEFAULT_MONTHLY_PRICE booked the ghost at $9.99.
        self.assertEqual(result["mrr"], 9.99)

    def test_unpriced_subscriber_contributes_nothing(self):
        """No price must mean no revenue, never an assumed one."""
        result = self._summarize([
            FakeDoc("priceless", self._paid(
                subscriptionPrice=None, subscriptionCurrency=None,
            )),
        ])

        self.assertEqual(result["mrr"], 0)
        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["pricedSubscribers"], 0)
        self.assertEqual(result["unpricedSubscribers"], 1)

    def test_revenuecat_metrics_win_over_the_firestore_derivation(self):
        """A webhook that never landed leaves a payer invisible to us but not to RevenueCat."""
        with patch.object(analytics_api.revenuecat_client, "get_overview_metrics",
                          return_value={"mrr": 337.0, "active_subscriptions": 44.0}):
            result = self._summarize([FakeDoc("one", self._paid())])

        self.assertEqual(result["mrr"], 337.0)
        self.assertEqual(result["arr"], 4044.0)
        self.assertEqual(result["totalSubscribers"], 44)
        self.assertEqual(result["mrrSource"], "revenuecat")
        # What we can actually attribute to a store and a plan is kept beside it.
        self.assertEqual(result["attributedMrr"], 9.99)
        self.assertEqual(result["attributedSubscribers"], 1)

    def test_todays_trend_point_matches_the_headline_figure(self):
        with patch.object(analytics_api.revenuecat_client, "get_overview_metrics",
                          return_value={"mrr": 337.0}):
            result = self._summarize([FakeDoc("one", self._paid())])

        self.assertEqual(result["mrrTrend"][-1]["mrr"], 337.0)

    def test_falls_back_to_the_derived_figure_when_revenuecat_is_unavailable(self):
        with patch.object(analytics_api.revenuecat_client, "get_overview_metrics",
                          return_value=None):
            result = self._summarize([FakeDoc("one", self._paid())])

        self.assertEqual(result["mrr"], 9.99)
        self.assertEqual(result["mrrSource"], "firestore")

    def test_the_rate_is_churn_intelligences_without_the_ledger(self):
        users = [
            FakeDoc("paying", self._paid()),
            FakeDoc("new", self._paid(initialPurchaseAt=self.NOW - timedelta(days=3))),
            FakeDoc("left", self._paid(subscriptionStatus="expired", renewalDate=None,
                                       expirationDate=self.NOW - timedelta(days=3))),
        ]
        result = self._summarize(users)
        churn = ChurnDB({"users": users, "emailTracking": [], "analytics_cache": []}, ledger_fails=True)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=churn)}), \
             patch.object(analytics_api, "_get_redis", return_value=None), \
             patch.object(analytics_api, "_auth_last_seen", return_value={}):
            intelligence = analytics_api._compute_churn_intelligence(30)

        # 1 / (2 - 1 + 1)
        self.assertEqual(result["churnRate"], 50.0)
        self.assertEqual(result["churnRate"], intelligence["churnRate"])

    def test_usd_price_field_is_trusted_whatever_the_buyer_was_charged_in(self):
        """After the webhook fix a VND subscriber carries a USD price too."""
        result = self._summarize([
            FakeDoc("vnd", self._paid(
                subscriptionPrice=9.99, subscriptionPriceUsd=9.99,
                subscriptionCurrency="VND",
            )),
        ])

        self.assertEqual(result["mrr"], 9.99)
        self.assertEqual(result["excludedNonUsd"], 0)
        self.assertEqual(result["pricedSubscribers"], 1)

    def test_offer_code_and_family_share_mark_free_access_on_the_user_doc(self):
        result = self._summarize([
            FakeDoc("offer", self._paid(subscriptionOfferCode="free_month")),
            FakeDoc("family", self._paid(subscriptionIsFamilyShare=True)),
            FakeDoc("paying", self._paid()),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["excludedFreeAccess"], 2)

    def test_comped_access_is_excluded_from_the_subscriber_count(self):
        """A currency with no price means the webhook saw a zero-price charge.

        cerebral writes subscriptionCurrency whenever RevenueCat reports one but
        subscriptionPrice only when it is > 0, so this shape is complimentary
        access — a friends-and-family grant or an offer-code redemption — and
        counting it would drag ARPU and conversion down with a population that
        was never going to pay.
        """
        result = self._summarize([
            FakeDoc("comped", self._paid(subscriptionPrice=None, subscriptionCurrency="GBP")),
            FakeDoc("paying", self._paid()),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["excludedFreeAccess"], 1)
        self.assertEqual(result["excludedNonUsd"], 0)
        self.assertEqual(result["mrr"], 9.99)

    def test_a_live_trial_is_a_trial_before_it_is_free_access(self):
        """Both shapes lack a price; the trial classification must win."""
        result = self._summarize([
            FakeDoc("trialling", self._paid(
                subscriptionPrice=None, subscriptionCurrency="EUR",
                trialEndDate=self.NOW + timedelta(days=2),
            )),
        ])

        self.assertEqual(result["trialUsers"], 1)
        self.assertEqual(result["excludedFreeAccess"], 0)

    def test_held_out_uids_never_reach_any_revenue_figure(self):
        with patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": "tester-1, tester-2"}):
            result = self._summarize([
                FakeDoc("tester-1", self._paid()),
                FakeDoc("tester-2", self._paid()),
                FakeDoc("real", self._paid()),
            ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["mrr"], 9.99)

    def test_a_promotional_grant_on_the_doc_is_excluded(self):
        result = self._summarize([
            FakeDoc("comped", self._paid(subscriptionStore="PROMOTIONAL")),
            FakeDoc("real", self._paid()),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["excludedNonPaying"], 1)
        self.assertEqual(result["mrr"], 9.99)

    def test_live_trial_flipped_to_active_counts_as_a_trial(self):
        """Why the dashboard reported trialUsers: 0 against 6 trial starts."""
        result = self._summarize([
            FakeDoc("ratcheted", self._paid(
                subscriptionPrice=None, subscriptionCurrency=None,
                trialEndDate=self.NOW + timedelta(days=2),
                hasStartedTrial=True,
            )),
        ])

        self.assertEqual(result["totalSubscribers"], 0)
        self.assertEqual(result["trialUsers"], 1)
        self.assertEqual(result["mrr"], 0)

    def test_converted_trial_is_a_paying_subscriber(self):
        """handle_trial_converted deletes trialEndDate and sets the flag."""
        result = self._summarize([
            FakeDoc("converted", self._paid(
                hasConvertedTrial=True,
                trialConvertedAt=self.NOW - timedelta(days=5),
            )),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["trialUsers"], 0)
        self.assertEqual(result["mrr"], 9.99)

    def test_subscription_whose_renewal_date_has_passed_is_excluded(self):
        result = self._summarize([
            FakeDoc("lapsed", self._paid(
                renewalDate=self.NOW - timedelta(days=5),
            )),
        ])

        self.assertEqual(result["totalSubscribers"], 0)
        self.assertEqual(result["excludedLapsed"], 1)

    def test_missing_renewal_date_does_not_drop_a_long_cycle_subscriber(self):
        """renewalDate only became reliable in 2026-03; absence is not evidence."""
        result = self._summarize([
            FakeDoc("old-annual", self._paid(
                renewalDate=None,
                subscriptionPeriod="annual",
                subscriptionPrice=99.99,
            )),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["mrr"], 8.33)

    def test_annual_is_normalized_and_bucketed_separately_from_monthly(self):
        result = self._summarize([
            FakeDoc("yearly", self._paid(
                subscriptionPeriod="annual", subscriptionPrice=99.99,
            )),
            FakeDoc("monthly", self._paid()),
        ])

        self.assertEqual(result["byProduct"], {"annual": 8.33, "monthly": 9.99})
        self.assertEqual(result["subscribersByProduct"], {"annual": 1, "monthly": 1})
        self.assertEqual(result["mrr"], 18.32)
        self.assertEqual(result["arr"], round(18.32 * 12, 2))

    def test_revenue_is_attributed_to_the_billing_store_not_the_device(self):
        result = self._summarize([
            FakeDoc("ios", self._paid(subscriptionStore="APP_STORE", platform="macos")),
            FakeDoc("web", self._paid(subscriptionStore="STRIPE", platform="ios")),
        ])

        self.assertEqual(result["byPlatform"], {"App Store": 9.99, "Stripe": 9.99})

    def test_churn_counts_only_subscriptions_the_webhook_confirmed(self):
        """Numerator and denominator must be screened the same way."""
        result = self._summarize([
            FakeDoc("real", self._paid()),
            FakeDoc("real-churned", self._paid(
                subscriptionStatus="expired",
                expirationDate=self.NOW - timedelta(days=3),
                renewalDate=None,
            )),
            FakeDoc("ghost-churned", {
                "subscriptionStatus": "expired",
                "expirationDate": self.NOW - timedelta(days=3),
                "createdAt": self.NOW - timedelta(days=90),
            }),
        ])

        self.assertEqual(result["churned"], 1)

    def test_coverage_counts_account_for_every_confirmed_subscriber(self):
        result = self._summarize([
            FakeDoc("a", self._paid()),
            FakeDoc("b", self._paid(subscriptionPrice=None, subscriptionCurrency=None)),
            FakeDoc("c", self._paid(subscriptionCurrency="JPY", subscriptionPrice=1500)),
        ])

        self.assertEqual(
            result["pricedSubscribers"] + result["unpricedSubscribers"],
            result["totalSubscribers"],
        )
        self.assertEqual(result["totalSubscribers"], 3)
        self.assertEqual(result["mrr"], 9.99)


class HealthScoreTests(unittest.TestCase):
    NOW = datetime.now(timezone.utc)

    def _user(self):
        return {
            "lastSeenAt": self.NOW - timedelta(days=1),
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

    def test_usage_month_update_supplies_recency_when_auth_saw_nothing(self):
        user = {"createdAt": self.NOW - timedelta(days=200)}
        health = analytics_api._compute_health_score(
            user,
            self.NOW,
            {"searches": 1, "captures": 0,
             "_lastActiveAt": self.NOW - timedelta(days=1)},
        )
        self.assertGreaterEqual(health["factors"]["recency"], 96)

    def test_recency_is_the_later_of_auth_and_a_chat_or_capture(self):
        user = {"createdAt": self.NOW - timedelta(days=200), "lastSeenAt": self.NOW - timedelta(days=20)}
        chatted = {"searches": 1, "captures": 0, "_lastActiveAt": self.NOW - timedelta(days=2)}

        self.assertEqual(analytics_api._compute_health_score(user, self.NOW)["factors"]["recency"], 34)
        self.assertEqual(analytics_api._compute_health_score(user, self.NOW, chatted)["factors"]["recency"], 93)

    def test_the_user_docs_last_active_fields_do_not_count(self):
        # Nothing writes them, and the account's owner can.
        user = {
            "createdAt": self.NOW - timedelta(days=200),
            "lastActiveAt": self.NOW, "last_active_at": self.NOW, "lastActive": self.NOW,
        }
        health = analytics_api._compute_health_score(user, self.NOW)
        self.assertEqual(health["factors"]["recency"], 0)
        self.assertEqual(health["factors"]["tenure"], 50)

    def test_future_trial_end_is_not_used_as_tenure_start(self):
        user = {
            "lastSeenAt": self.NOW,
            "trialEndDate": self.NOW + timedelta(days=7),
        }
        health = analytics_api._compute_health_score(user, self.NOW)

        self.assertIsNone(analytics_api._get_tenure_date(user))
        self.assertEqual(health["factors"]["tenure"], 50)

    def test_trial_start_supplies_non_negative_tenure(self):
        user = {
            "lastSeenAt": self.NOW,
            "trialStartedAt": self.NOW - timedelta(days=10),
            "trialEndDate": self.NOW + timedelta(days=4),
        }
        health = analytics_api._compute_health_score(user, self.NOW)

        self.assertEqual(analytics_api._get_tenure_date(user), user["trialStartedAt"])
        self.assertEqual(health["factors"]["tenure"], 7)

    def test_cancelled_customer_keeps_access_until_expiration(self):
        # cerebral writes "cancelled"; the Cloud Function updateSubscriptionStatus "canceled"
        for status in ("cancelled", "canceled"):
            with self.subTest(status):
                self.assertTrue(analytics_api._has_current_subscription_access(
                    {
                        "subscriptionStatus": status,
                        "expirationDate": self.NOW + timedelta(days=1),
                    },
                    self.NOW,
                ))
                self.assertFalse(analytics_api._has_current_subscription_access(
                    {
                        "subscriptionStatus": status,
                        "expirationDate": self.NOW - timedelta(seconds=1),
                    },
                    self.NOW,
                ))


class StatusScan(FakeCollection):
    """The customer health scan: a status "in" filter, paged by document id."""

    def where(self, field, operator, value):
        if operator == "in":
            return StatusScan([doc for doc in self.docs if doc.to_dict().get(field) in value])
        return StatusScan(super().where(field, operator, value).docs)

    def order_by(self, field):
        assert field == "__name__"
        return StatusScan(sorted(self.docs, key=lambda doc: doc.id))

    def start_after(self, last_doc):
        return StatusScan([doc for doc in self.docs if doc.id > last_doc.id])


class HealthDB(FakeDB):
    """Answers the customer health scan's status "in" filter, and can fail
    every ledger read."""

    def __init__(self, collections, ledger_fails=False):
        super().__init__(collections)
        self.ledger_fails = ledger_fails

    def collection(self, name):
        if name == "subscription_ledger" and self.ledger_fails:
            raise RuntimeError("deadline exceeded")
        return StatusScan(self.collections.get(name, []))


class CustomerHealthTests(ActivityStubs, unittest.TestCase):
    """The health list scores the accounts paying or trialling now, and scores
    recency by when Firebase Auth last saw each account, or a later chat or
    capture: most subscribers never chat."""

    NOW = datetime.now(timezone.utc)

    def setUp(self):
        self.stub_activity()

    def _health(self, users, usage=None, ledger=None, held_out="", ledger_fails=False):
        self.usage_reads = []

        def fetch_usage(_db, uids, _now):
            self.usage_reads += list(uids)
            return {uid: (usage or {})[uid] for uid in uids if uid in (usage or {})}

        if ledger is None:
            # Every user here pays monthly
            ledger = [
                ledger_event(f"r-{doc.id}", doc.id, "RENEWAL", self.NOW - timedelta(days=5),
                             self.NOW + timedelta(days=25))
                for doc in users
            ]
        db = HealthDB({"users": users, "subscription_ledger": ledger}, ledger_fails=ledger_fails)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(analytics_api, "_fetch_usage_monthly", side_effect=fetch_usage), \
             patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": held_out}):
            result = analytics_api._compute_customer_health()
        self.distribution = result["distribution"]
        return {row["uid"]: row for row in result["customers"]}

    def _subscriber(self, uid, **fields):
        return FakeDoc(uid, {"subscriptionStatus": "active", "createdAt": self.NOW - timedelta(days=200), **fields})

    def test_a_subscriber_who_never_chats_is_scored_by_when_auth_last_saw_them(self):
        self.stub_activity(records=[_auth_record("reader", refreshed_days_ago=1)])

        reader = self._health([self._subscriber("reader")])["reader"]

        # By usage_monthly alone: recency 0, tenure halved, score 5, churning
        self.assertEqual(reader["factors"]["recency"], 97)
        self.assertEqual(reader["healthScore"], 44)
        self.assertEqual(reader["healthStatus"], "atRisk")
        self.assertEqual((datetime.now(timezone.utc) - analytics_api._to_datetime(reader["lastActiveAt"])).days, 1)

    def test_a_chat_after_auth_last_saw_the_account_counts(self):
        self.stub_activity(records=[_auth_record("chatter", refreshed_days_ago=20)])
        chatted = {"searches": 1, "captures": 0, "_lastActiveAt": self.NOW - timedelta(days=2)}

        chatter = self._health([self._subscriber("chatter")], usage={"chatter": chatted})["chatter"]

        self.assertEqual(chatter["factors"]["recency"], 93)

    def test_the_docs_own_last_seen_fields_do_not_count(self):
        # The account's owner can write any of them; Auth has no record here.
        doc = self._subscriber("spoofed", lastActiveAt=self.NOW, lastSeenAt=self.NOW)

        self.assertEqual(self._health([doc])["spoofed"]["factors"]["recency"], 0)

    def test_only_accounts_paying_or_trialling_are_scored(self):
        ago = lambda days: self.NOW - timedelta(days=days)  # noqa: E731
        later = lambda days: self.NOW + timedelta(days=days)  # noqa: E731
        users = [
            self._subscriber("paying"),
            # The Cloud Function's spelling, which the status scans skip
            self._subscriber("paying-canceled", subscriptionStatus="canceled"),
            # The native app writes "active" for all of these
            self._subscriber("trialling"),
            self._subscriber("never-paid"),
            self._subscriber("testflight"),
            self._subscriber("promo"),
            self._subscriber("trial-over", subscriptionStatus="trial", trialEndDate=ago(2)),
            self._subscriber("paid-left"),
            self._subscriber("internal"),
        ]
        ledger = [
            ledger_event("a1", "paying", "RENEWAL", ago(5), later(25)),
            ledger_event("c1", "paying-canceled", "INITIAL_PURCHASE", ago(100), later(265)),
            ledger_event("c2", "paying-canceled", "CANCELLATION", ago(50), later(265)),
            ledger_event("t1", "trialling", "INITIAL_PURCHASE", ago(2), later(5), periodType="TRIAL", price=0),
            ledger_event("s1", "testflight", "INITIAL_PURCHASE", ago(2), later(28), environment="SANDBOX"),
            ledger_event("g1", "promo", "INITIAL_PURCHASE", ago(2), later(28),
                         store="PROMOTIONAL", periodType="PROMOTIONAL", price=0),
            ledger_event("o1", "trial-over", "INITIAL_PURCHASE", ago(9), ago(2), periodType="TRIAL", price=0),
            ledger_event("o2", "trial-over", "EXPIRATION", ago(2), ago(2), periodType="TRIAL"),
            ledger_event("l1", "paid-left", "RENEWAL", ago(40), ago(10)),
            ledger_event("l2", "paid-left", "EXPIRATION", ago(10), ago(10)),
            ledger_event("i1", "internal", "RENEWAL", ago(5), later(25)),
            # Paying, but the account has no user doc
            ledger_event("n1", "no-doc", "RENEWAL", ago(5), later(25)),
        ]

        customers = self._health(users, ledger=ledger, held_out="internal")

        scored = ["paying", "paying-canceled", "trialling"]
        self.assertEqual(sorted(customers), scored)
        self.assertEqual(sum(self.distribution.values()), 3)
        self.assertEqual([sorted(call) for call in self.auth.calls], [scored])
        self.assertEqual(sorted(self.usage_reads), scored)

    def test_without_the_ledger_only_docs_with_access_are_looked_up(self):
        users = [
            self._subscriber("paying"),
            self._subscriber("paid-to-next-month", subscriptionStatus="cancelled",
                             expirationDate=self.NOW + timedelta(days=20)),
            self._subscriber("lapsed", subscriptionStatus="cancelled",
                             expirationDate=self.NOW - timedelta(days=20)),
            self._subscriber("internal"),
        ]

        customers = self._health(users, ledger_fails=True, held_out="internal")

        self.assertEqual(sorted(customers), ["paid-to-next-month", "paying"])
        self.assertEqual([sorted(call) for call in self.auth.calls], [["paid-to-next-month", "paying"]])
        self.assertEqual(sorted(self.usage_reads), ["paid-to-next-month", "paying"])

    def test_a_failed_auth_lookup_scores_by_usage_alone(self):
        chatted = {"searches": 1, "captures": 0, "_lastActiveAt": self.NOW - timedelta(days=2)}
        with patch.object(firebase_auth, "get_users", side_effect=RuntimeError("auth down")):
            customers = self._health([self._subscriber("chatter"), self._subscriber("reader")],
                                     usage={"chatter": chatted})

        self.assertEqual(customers["chatter"]["factors"]["recency"], 93)
        self.assertEqual(customers["reader"]["factors"]["recency"], 0)


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
            "lastSeenAt": self.NOW - timedelta(days=10),
        }

    def test_no_usage_monthly_reads_as_no_usage(self):
        reason = analytics_api._classify_churn_reason(self._churned_user(), self.NOW, None)
        self.assertEqual(reason, "No usage")

    def test_recent_usage_monthly_reclassifies(self):
        reason = analytics_api._classify_churn_reason(
            self._churned_user(), self.NOW, {"searches": 9, "captures": 2})
        self.assertEqual(reason, "Active user - unknown reason")

    def test_went_inactive_goes_by_when_the_account_was_last_seen(self):
        used = {"searches": 9, "captures": 2}
        quiet = {**self._churned_user(), "lastSeenAt": self.NOW - timedelta(days=40)}
        still_opening_the_app = {**quiet, "lastSeenAt": self.NOW - timedelta(days=1)}

        self.assertEqual(analytics_api._classify_churn_reason(quiet, self.NOW, used), "Went inactive")
        self.assertEqual(analytics_api._classify_churn_reason(still_opening_the_app, self.NOW, used),
                         "Active user - unknown reason")

    def test_the_ledger_says_whether_a_trial_expired_when_it_knows(self):
        no_trial_fields = self._churned_user()
        trial_dates = {**no_trial_fields, "trialEndDate": no_trial_fields["expirationDate"]}

        self.assertEqual(analytics_api._classify_churn_reason(no_trial_fields, self.NOW, None, trial=True),
                         "Trial - no usage")
        self.assertEqual(analytics_api._classify_churn_reason(trial_dates, self.NOW, None, trial=False),
                         "No usage")
        self.assertEqual(analytics_api._classify_churn_reason(trial_dates, self.NOW, None),
                         "Trial - no usage")


class PaidSubscriptionTests(unittest.TestCase):
    """_paid_subscriptions: who paid, from the ledger, and when that ended."""

    NOW = datetime.now(timezone.utc)

    def _ago(self, days):
        return self.NOW - timedelta(days=days)

    def _in(self, days):
        return self.NOW + timedelta(days=days)

    def _subscriptions(self, *events):
        db = FakeDB({"subscription_ledger": list(events)})
        return analytics_api._paid_subscriptions(db, self._ago(490), self.NOW)

    @staticmethod
    def _run(sub):
        return {key: sub[key] for key in ("started", "ended", "trialled")}

    def test_it_runs_from_the_first_payment_to_the_expiration_after_the_last(self):
        subscriptions = self._subscriptions(
            ledger_event("l1", "left", "INITIAL_PURCHASE", self._ago(70), self._ago(40)),
            ledger_event("l2", "left", "RENEWAL", self._ago(40), self._ago(10)),
            ledger_event("l3", "left", "CANCELLATION", self._ago(20), self._ago(10)),
            ledger_event("l4", "left", "EXPIRATION", self._ago(10), self._ago(10)),
            ledger_event("s1", "stays", "RENEWAL", self._ago(5), self._in(25)),
        )

        self.assertEqual(self._run(subscriptions["left"]),
                         {"started": self._ago(70), "ended": self._ago(10), "trialled": False})
        self.assertEqual(self._run(subscriptions["stays"]),
                         {"started": self._ago(5), "ended": None, "trialled": False})

    def test_a_refund_ends_it_early_and_a_billing_grace_period_late(self):
        subscriptions = self._subscriptions(
            # A yearly plan, refunded ten days in
            ledger_event("r1", "refunded", "INITIAL_PURCHASE", self._ago(100), self._in(265)),
            ledger_event("r2", "refunded", "CANCELLATION", self._ago(90), self._ago(90)),
            ledger_event("r3", "refunded", "EXPIRATION", self._ago(90), self._ago(90)),
            # Apple retried the charge for its 16 days of grace
            ledger_event("g1", "graced", "RENEWAL", self._ago(46), self._ago(16)),
            ledger_event("g2", "graced", "BILLING_ISSUE", self._ago(16), self._ago(16)),
            ledger_event("g3", "graced", "EXPIRATION", self._ago(0), self._ago(0)),
        )

        self.assertEqual(subscriptions["refunded"]["ended"], self._ago(90))
        self.assertEqual(subscriptions["graced"]["ended"], self._ago(0))

    def test_a_trial_taken_later_doesnt_stretch_the_paid_period(self):
        subscriptions = self._subscriptions(
            ledger_event("p1", "returned", "INITIAL_PURCHASE", self._ago(200), self._ago(170)),
            ledger_event("t1", "returned", "INITIAL_PURCHASE", self._ago(40), self._ago(33),
                         periodType="TRIAL", price=0),
            ledger_event("t2", "returned", "EXPIRATION", self._ago(33), self._ago(33), periodType="TRIAL"),
        )

        self.assertEqual(self._run(subscriptions["returned"]),
                         {"started": self._ago(200), "ended": self._ago(170), "trialled": True})

    def test_with_no_expiration_it_ends_with_its_paid_period_once_the_grace_runs_out(self):
        subscriptions = self._subscriptions(
            ledger_event("l1", "lapsed", "RENEWAL", self._ago(75), self._ago(45)),
            ledger_event("b1", "retrying", "RENEWAL", self._ago(40), self._ago(10)),
            ledger_event("b2", "retrying", "BILLING_ISSUE", self._ago(10), self._ago(10)),
        )

        self.assertEqual(subscriptions["lapsed"]["ended"], self._ago(45))
        self.assertIsNone(subscriptions["retrying"]["ended"])

    def test_paying_again_after_it_ended_starts_a_new_subscription(self):
        subscriptions = self._subscriptions(
            ledger_event("a1", "back", "INITIAL_PURCHASE", self._ago(120), self._ago(90)),
            ledger_event("a2", "back", "EXPIRATION", self._ago(90), self._ago(90)),
            ledger_event("a3", "back", "INITIAL_PURCHASE", self._ago(20), self._in(10)),
        )

        self.assertEqual(self._run(subscriptions["back"]),
                         {"started": self._ago(20), "ended": None, "trialled": False})

    def test_it_keeps_the_latest_payment(self):
        subscriptions = self._subscriptions(
            ledger_event("m1", "monthly", "INITIAL_PURCHASE", self._ago(40), self._ago(10), price=9.99),
            ledger_event("m2", "monthly", "RENEWAL", self._ago(10), self._in(20), price=10.49),
            ledger_event("m3", "monthly", "CANCELLATION", self._ago(2), self._in(20)),
        )

        self.assertEqual(subscriptions["monthly"]["payment"]["price"], 10.49)

    def test_a_trial_runs_until_it_converts_or_expires(self):
        def trial(uid, started, ends, **fields):
            return ledger_event(f"t-{uid}", uid, "INITIAL_PURCHASE", started, ends,
                                periodType="TRIAL", price=0, **fields)

        subscriptions = self._subscriptions(
            trial("running", self._ago(1), self._in(2)),
            # Set not to renew: it runs to its end all the same
            trial("cancelled", self._ago(1), self._in(2)),
            ledger_event("c2", "cancelled", "CANCELLATION", self._ago(0), self._in(2), periodType="TRIAL"),
            trial("converted", self._ago(4), self._ago(1)),
            ledger_event("v2", "converted", "RENEWAL", self._ago(1), self._in(364)),
            trial("expired", self._ago(9), self._ago(2)),
            ledger_event("x2", "expired", "EXPIRATION", self._ago(2), self._ago(2), periodType="TRIAL"),
            trial("sandbox", self._ago(1), self._in(2), environment="SANDBOX"),
        )

        running = {uid for uid, sub in subscriptions.items()
                   if sub["trialUntil"] and sub["trialUntil"] > self.NOW}
        self.assertEqual(running, {"running", "cancelled"})

    def test_only_a_production_sale_someone_paid_for_is_a_payment(self):
        def sale(uid, **fields):
            return ledger_event(f"e-{uid}", uid, "INITIAL_PURCHASE", self._ago(5), self._in(25), **fields)

        subscriptions = self._subscriptions(
            sale("sandbox", environment="SANDBOX"),
            sale("sandbox-trial", environment="SANDBOX", periodType="TRIAL", price=0),
            sale("promotional-store", store="PROMOTIONAL", price=0),
            sale("promotional-period", periodType="PROMOTIONAL", price=0),
            sale("family", isFamilyShare=True, price=0),
            sale("free", price=0),
            sale("trial", periodType="TRIAL", price=0),
            sale("price-unknown", price=None),
            sale("intro-offer", periodType="INTRO", price=0.99),
        )

        self.assertEqual(
            {uid for uid, sub in subscriptions.items() if sub["started"] is None},
            {"sandbox", "sandbox-trial", "promotional-store", "promotional-period",
             "family", "free", "trial"},
        )
        self.assertEqual({uid for uid, sub in subscriptions.items() if sub["trialled"]}, {"trial"})

    def test_a_cancellation_holds_until_a_payment_or_an_uncancellation(self):
        subscriptions = self._subscriptions(
            # A yearly plan set not to renew a day after it was bought
            ledger_event("y1", "set-to-lapse", "INITIAL_PURCHASE", self._ago(100), self._in(265)),
            ledger_event("y2", "set-to-lapse", "CANCELLATION", self._ago(99), self._in(265)),
            ledger_event("m1", "changed-mind", "RENEWAL", self._ago(5), self._in(25)),
            ledger_event("m2", "changed-mind", "CANCELLATION", self._ago(4), self._in(25)),
            ledger_event("m3", "changed-mind", "UNCANCELLATION", self._ago(3), self._in(25)),
            # Cancelled, then bought again before the paid period ran out
            ledger_event("b1", "bought-again", "RENEWAL", self._ago(45), self._ago(15)),
            ledger_event("b2", "bought-again", "CANCELLATION", self._ago(30), self._ago(15)),
            ledger_event("b3", "bought-again", "INITIAL_PURCHASE", self._ago(5), self._in(25)),
            ledger_event("t1", "trial-cancelled", "INITIAL_PURCHASE", self._ago(3), self._in(4),
                         periodType="TRIAL", price=0),
            ledger_event("t2", "trial-cancelled", "CANCELLATION", self._ago(1), self._in(4), periodType="TRIAL"),
            ledger_event("s1", "testflight-cancel", "RENEWAL", self._ago(5), self._in(25)),
            ledger_event("s2", "testflight-cancel", "CANCELLATION", self._ago(1), self._in(25),
                         environment="SANDBOX"),
        )

        self.assertEqual(
            {uid: sub["cancelled"] for uid, sub in subscriptions.items()},
            {"set-to-lapse": True, "changed-mind": False, "bought-again": False,
             "trial-cancelled": True, "testflight-cancel": False},
        )
        self.assertEqual(subscriptions["trial-cancelled"]["trialUntil"], self._in(4))
        self.assertIsNone(subscriptions["set-to-lapse"]["ended"])

    def test_an_unreadable_ledger_is_none(self):
        class Unreadable(FakeDB):
            def collection(self, name):
                raise RuntimeError("deadline exceeded")

        self.assertIsNone(analytics_api._paid_subscriptions(Unreadable({}), self._ago(490), self.NOW))


class ChurnDB(FakeDB):
    """Logs the user docs read one by one, and can fail every ledger read."""

    def __init__(self, collections, ledger_fails=False):
        super().__init__(collections)
        self.ledger_fails = ledger_fails
        self.read_by_id = []

    def collection(self, name):
        if name == "subscription_ledger" and self.ledger_fails:
            raise RuntimeError("deadline exceeded")
        return super().collection(name)

    def get_all(self, refs):
        docs = super().get_all(refs)
        self.read_by_id += [doc.id for doc in docs]
        return docs


class ChurnIntelligenceTests(ActivityStubs, unittest.TestCase):
    """Churn is paid subscriptions that ended, from the ledger. A user doc's
    status, webhook fields and expirationDate can't say (2026-10-04): the
    native app writes "active" for trials and grants, most paying accounts'
    docs carry none of the webhook's fields, and the Cloud Function's
    "canceled" docs often have no expirationDate."""

    NOW = datetime.now(timezone.utc)

    def setUp(self):
        self.stub_activity()

    def _ago(self, days):
        return self.NOW - timedelta(days=days)

    def _in(self, days):
        return self.NOW + timedelta(days=days)

    def _ledger(self):
        ago, later = self._ago, self._in
        return [
            # Paid, then left
            ledger_event("p1", "paid-left", "RENEWAL", ago(40), ago(10)),
            ledger_event("p2", "paid-left", "EXPIRATION", ago(10), ago(10)),
            # The same, under the Cloud Function's spelling and with no date
            ledger_event("c1", "canceled-left", "RENEWAL", ago(50), ago(20)),
            ledger_event("c2", "canceled-left", "EXPIRATION", ago(20), ago(20)),
            # The same, and then the account was deleted
            ledger_event("d1", "deleted", "RENEWAL", ago(45), ago(15)),
            ledger_event("d2", "deleted", "EXPIRATION", ago(15), ago(15)),
            # A web trial that never converted, with no trial fields on its doc
            ledger_event("w1", "web-trial", "INITIAL_PURCHASE", ago(12), ago(5),
                         periodType="TRIAL", store="RC_BILLING", price=0),
            ledger_event("w2", "web-trial", "EXPIRATION", ago(5), ago(5),
                         periodType="TRIAL", store="RC_BILLING"),
            # A TestFlight purchase and a promotional grant
            ledger_event("s1", "sandbox", "INITIAL_PURCHASE", ago(33), ago(3), environment="SANDBOX"),
            ledger_event("s2", "sandbox", "EXPIRATION", ago(3), ago(3), environment="SANDBOX"),
            ledger_event("g1", "promo", "INITIAL_PURCHASE", ago(34), ago(4),
                         store="PROMOTIONAL", periodType="PROMOTIONAL", price=0),
            ledger_event("g2", "promo", "EXPIRATION", ago(4), ago(4),
                         store="PROMOTIONAL", periodType="PROMOTIONAL"),
            # Paying now: monthly renewals, a yearly plan set not to renew, a first purchase
            ledger_event("a1", "paying", "RENEWAL", ago(35), ago(5)),
            ledger_event("a2", "paying", "RENEWAL", ago(5), later(25)),
            ledger_event("y1", "paying-canceled", "INITIAL_PURCHASE", ago(100), later(265)),
            ledger_event("y2", "paying-canceled", "CANCELLATION", ago(50), later(265)),
            ledger_event("n1", "new-payer", "INITIAL_PURCHASE", ago(3), later(27)),
        ]

    def _users(self):
        ago = self._ago
        return [
            FakeDoc("paid-left", {"subscriptionStatus": "expired", "expirationDate": ago(10),
                                  "productId": "chunk_pro_monthly", "createdAt": ago(200)}),
            FakeDoc("canceled-left", {"subscriptionStatus": "canceled", "createdAt": ago(300)}),
            FakeDoc("web-trial", {"subscriptionStatus": "expired", "expirationDate": ago(5),
                                  "createdAt": ago(12)}),
            FakeDoc("sandbox", {"subscriptionStatus": "expired", "expirationDate": ago(3),
                                "productId": "chunk_pro_monthly", "createdAt": ago(40)}),
            FakeDoc("promo", {"subscriptionStatus": "expired", "expirationDate": ago(4),
                              "subscriptionStore": "PROMOTIONAL", "createdAt": ago(40)}),
            FakeDoc("paying", {"subscriptionStatus": "active", "createdAt": ago(400)}),
            FakeDoc("paying-canceled", {"subscriptionStatus": "canceled", "createdAt": ago(120)}),
            FakeDoc("new-payer", {"subscriptionStatus": "active", "createdAt": ago(90)}),
            FakeDoc("never-paid", {"subscriptionStatus": "active", "createdAt": ago(30)}),
        ]

    def _churn(self, users=None, ledger=None, held_out="", ledger_fails=False):
        db = ChurnDB({
            "users": self._users() if users is None else users,
            "subscription_ledger": self._ledger() if ledger is None else ledger,
            "emailTracking": [],
            "analytics_cache": [],
        }, ledger_fails=ledger_fails)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None), \
             patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": held_out}):
            return analytics_api._compute_churn_intelligence(30), db

    def test_the_rate_is_paid_subscriptions_that_ended_over_the_paying_base(self):
        result, _ = self._churn()

        # Three paid subscriptions ended, one account since deleted. Three
        # accounts pay now, one of them new this month: 3 / (3 - 1 + 3).
        self.assertEqual(result["churnRate"], 60.0)

    def test_trials_stay_on_the_list_as_trials_and_accounts_that_never_paid_leave_it(self):
        result, _ = self._churn()

        rows = {row["uid"]: row for row in result["churnedUsers"]}
        # Paid churn first, then expired trials, newest first in each
        self.assertEqual(list(rows), ["paid-left", "canceled-left", "web-trial"])
        self.assertEqual(rows["web-trial"]["reason"], "Trial - no usage")
        self.assertEqual(result["churnReasons"], {"No usage": 2, "Trial - no usage": 1})

    def test_a_canceled_doc_is_read_by_id_and_dated_by_the_ledger(self):
        result, db = self._churn()

        rows = {row["uid"]: row for row in result["churnedUsers"]}
        self.assertEqual(rows["canceled-left"]["churnDate"], self._ago(20).isoformat())
        self.assertEqual(rows["canceled-left"]["tenure"], 280)
        # The customers, and the churners the status scans don't return
        self.assertEqual(sorted(db.read_by_id), ["canceled-left", "deleted", "new-payer", "paying", "paying-canceled"])

    def test_paying_again_isnt_churn_whatever_the_doc_says(self):
        ago, later = self._ago, self._in
        result, _ = self._churn(
            users=[FakeDoc("back", {"subscriptionStatus": "expired", "expirationDate": ago(8),
                                    "createdAt": ago(200)})],
            ledger=[
                ledger_event("b1", "back", "RENEWAL", ago(38), ago(8)),
                ledger_event("b2", "back", "EXPIRATION", ago(8), ago(8)),
                ledger_event("b3", "back", "INITIAL_PURCHASE", ago(2), later(28)),
            ],
        )

        self.assertEqual(result["churnedUsers"], [])
        self.assertEqual(result["churnRate"], 0)

    def test_held_out_accounts_never_count(self):
        result, _ = self._churn(held_out="paid-left, paying")

        # canceled-left and deleted over paying-canceled and new-payer: 2 / (2 - 1 + 2)
        self.assertEqual(result["churnRate"], 66.7)
        self.assertEqual([row["uid"] for row in result["churnedUsers"]], ["canceled-left", "web-trial"])

    def test_an_unreadable_ledger_falls_back_to_the_webhook_fields(self):
        ago = self._ago
        result, _ = self._churn(ledger_fails=True, users=[
            FakeDoc("confirmed", {"subscriptionStatus": "active", "latestTransactionId": "t1",
                                  "createdAt": ago(200)}),
            FakeDoc("confirmed-left", {"subscriptionStatus": "expired", "expirationDate": ago(10),
                                       "latestTransactionId": "t2", "createdAt": ago(200)}),
            FakeDoc("unconfirmed-left", {"subscriptionStatus": "expired", "expirationDate": ago(5),
                                         "createdAt": ago(100)}),
            FakeDoc("trial-left", {"subscriptionStatus": "expired", "trialEndDate": ago(3),
                                   "expirationDate": ago(3), "createdAt": ago(10)}),
        ])

        self.assertEqual(result["churnRate"], 50.0)
        self.assertEqual([row["uid"] for row in result["churnedUsers"]], ["confirmed-left", "trial-left"])

    def test_the_overview_counts_churn_the_same_way(self):
        for days in (7, 30, 90):
            with self.subTest(days=days):
                db = ChurnDB({"users": self._users(), "subscription_ledger": self._ledger(),
                              "emailTracking": [], "analytics_cache": []})
                with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
                     patch.object(analytics_api, "_get_redis", return_value=None), \
                     patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": ""}):
                    churn = analytics_api._compute_churn_intelligence(days)
                    summary = analytics_api._compute_revenue_summary(days)

                self.assertEqual(summary["churnRate"], churn["churnRate"])
        # 90 days: three paid subscriptions ended, two accounts started paying
        self.assertEqual((summary["churned"], summary["newSubscribers"]), (3, 2))

    def test_the_at_risk_list_goes_by_when_auth_last_saw_the_account(self):
        # None of them ever chatted or captured: by usage_monthly alone, all
        # three were inactive.
        self.stub_activity(records=[
            _auth_record("paying", refreshed_days_ago=2),
            _auth_record("new-payer", refreshed_days_ago=20),
        ])
        result, _ = self._churn()

        at_risk = {row["uid"]: row for row in result["atRiskUsers"]}
        self.assertEqual(sorted(at_risk), ["new-payer", "paying-canceled"])
        self.assertEqual(at_risk["new-payer"]["daysSinceActive"], 20)
        self.assertIsNone(at_risk["paying-canceled"]["daysSinceActive"])
        self.assertEqual([row["uid"] for row in result["topEngagedUsers"]], ["paying"])
        self.assertEqual(result["topEngagedUsers"][0]["daysSinceActive"], 2)

    def test_one_auth_lookup_covers_the_scored_and_the_churned(self):
        self._churn()

        self.assertEqual(len(self.auth.calls), 1)
        self.assertEqual(sorted(self.auth.calls[0]), [
            "canceled-left", "new-payer", "paid-left", "paying", "paying-canceled", "web-trial"])

    def test_a_failed_auth_lookup_leaves_usage_alone_to_say(self):
        with patch.object(firebase_auth, "get_users", side_effect=RuntimeError("auth down")):
            result, _ = self._churn()

        self.assertEqual(result["churnRate"], 60.0)
        self.assertEqual(result["atRiskCount"], 3)


class CustomerListTests(ActivityStubs, unittest.TestCase):
    """The at-risk and engaged lists hold the accounts paying or trialling
    now, from the ledger. The status scans held every "active" doc, and on
    2026-10-05, 55 of the 97 accounts they gave access to had never paid and
    weren't trialling."""

    NOW = datetime.now(timezone.utc)

    def setUp(self):
        # Everyone was seen yesterday, so only a cancellation or a trial's
        # end puts an account at risk.
        self.stub_activity(records=[
            _auth_record(uid, refreshed_days_ago=1) for uid in (
                "paying", "paying-canceled", "set-to-lapse", "changed-mind", "trialling",
                "never-paid", "testflight", "promo", "trial-over", "paid-left", "internal")
        ])

    def _ago(self, days):
        return self.NOW - timedelta(days=days)

    def _in(self, days):
        return self.NOW + timedelta(days=days)

    def _lists(self, users, ledger, held_out="", ledger_fails=False):
        db = ChurnDB({"users": users, "subscription_ledger": ledger,
                      "emailTracking": [], "analytics_cache": []}, ledger_fails=ledger_fails)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None), \
             patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": held_out}):
            result = analytics_api._compute_churn_intelligence(30)
        at_risk = {row["uid"]: row for row in result["atRiskUsers"]}
        engaged = {row["uid"]: row for row in result["topEngagedUsers"]}
        return result, at_risk, engaged

    def _user(self, uid, status="active", **fields):
        return FakeDoc(uid, {"subscriptionStatus": status, "createdAt": self._ago(400), **fields})

    def test_only_accounts_paying_or_trialling_are_listed(self):
        ago, later = self._ago, self._in
        users = [
            self._user("paying"),
            self._user("paying-canceled", "canceled"),
            # The native app writes "active" for all of these
            self._user("trialling"),
            self._user("never-paid"),
            self._user("testflight"),
            self._user("promo"),
            self._user("trial-over", "trial", trialEndDate=ago(2)),
            self._user("paid-left"),
            self._user("internal"),
        ]
        ledger = [
            ledger_event("a1", "paying", "RENEWAL", ago(5), later(25)),
            ledger_event("c1", "paying-canceled", "INITIAL_PURCHASE", ago(100), later(265)),
            ledger_event("c2", "paying-canceled", "CANCELLATION", ago(50), later(265)),
            ledger_event("t1", "trialling", "INITIAL_PURCHASE", ago(2), later(5), periodType="TRIAL", price=0),
            ledger_event("s1", "testflight", "INITIAL_PURCHASE", ago(2), later(28), environment="SANDBOX"),
            ledger_event("g1", "promo", "INITIAL_PURCHASE", ago(2), later(28),
                         store="PROMOTIONAL", periodType="PROMOTIONAL", price=0),
            ledger_event("o1", "trial-over", "INITIAL_PURCHASE", ago(9), ago(2), periodType="TRIAL", price=0),
            ledger_event("o2", "trial-over", "EXPIRATION", ago(2), ago(2), periodType="TRIAL"),
            ledger_event("l1", "paid-left", "RENEWAL", ago(40), ago(10)),
            ledger_event("l2", "paid-left", "EXPIRATION", ago(10), ago(10)),
            ledger_event("i1", "internal", "RENEWAL", ago(5), later(25)),
            # Paying, but the account has no user doc: no row, as in the churned list
            ledger_event("n1", "no-doc", "RENEWAL", ago(5), later(25)),
        ]

        result, at_risk, engaged = self._lists(users, ledger, held_out="internal")

        self.assertEqual(sorted(at_risk), ["paying-canceled"])
        self.assertEqual(at_risk["paying-canceled"]["subscriptionType"], "cancelled")
        self.assertEqual(sorted(engaged), ["paying"])
        # The trial is neither at risk (five days left) nor a paying customer
        self.assertEqual((result["atRiskCount"], result["engagedCount"]), (1, 1))

    def test_a_cancellation_on_the_ledger_puts_a_customer_at_risk_whatever_the_doc_says(self):
        ago, later = self._ago, self._in
        users = [self._user("set-to-lapse"), self._user("changed-mind")]
        ledger = [
            ledger_event("s1", "set-to-lapse", "INITIAL_PURCHASE", ago(100), later(265)),
            ledger_event("s2", "set-to-lapse", "CANCELLATION", ago(99), later(265)),
            ledger_event("m1", "changed-mind", "RENEWAL", ago(5), later(25)),
            ledger_event("m2", "changed-mind", "CANCELLATION", ago(4), later(25)),
            ledger_event("m3", "changed-mind", "UNCANCELLATION", ago(3), later(25)),
        ]

        _, at_risk, engaged = self._lists(users, ledger)

        self.assertEqual(list(at_risk), ["set-to-lapse"])
        self.assertEqual(at_risk["set-to-lapse"]["subscriptionType"], "cancelled")
        self.assertEqual(at_risk["set-to-lapse"]["daysSinceActive"], 1)
        self.assertEqual(list(engaged), ["changed-mind"])

    def test_a_trial_counts_down_to_the_end_the_ledger_gives(self):
        ago, later = self._ago, self._in
        users = [
            # The doc's own trial dates are stale or missing
            self._user("trialling", trialEndDate=ago(30)),
            self._user("trial-over", "trial", trialEndDate=ago(2)),
        ]
        ledger = [
            ledger_event("t1", "trialling", "INITIAL_PURCHASE", ago(4.5), later(2.5),
                         periodType="TRIAL", price=0),
            ledger_event("o1", "trial-over", "INITIAL_PURCHASE", ago(9), ago(2), periodType="TRIAL", price=0),
            ledger_event("o2", "trial-over", "EXPIRATION", ago(2), ago(2), periodType="TRIAL"),
        ]

        result, at_risk, engaged = self._lists(users, ledger)

        self.assertEqual(list(at_risk), ["trialling"])
        self.assertEqual(at_risk["trialling"]["subscriptionType"], "trial")
        self.assertEqual(at_risk["trialling"]["trialEndsIn"], 2)
        self.assertEqual(result["trialAtRiskCount"], 1)
        self.assertEqual(engaged, {})

    def test_without_the_ledger_every_doc_with_access_is_listed(self):
        ago, later = self._ago, self._in
        users = [
            self._user("paying"),
            self._user("trialling", "trial", trialEndDate=later(2.5)),
            self._user("paying-canceled", "cancelled", expirationDate=later(20)),
            self._user("paid-left", "cancelled", expirationDate=ago(20)),
            self._user("internal"),
        ]

        result, at_risk, engaged = self._lists(users, [], held_out="internal", ledger_fails=True)

        self.assertEqual(sorted(at_risk), ["paying-canceled", "trialling"])
        self.assertEqual(at_risk["paying-canceled"]["subscriptionType"], "cancelled")
        self.assertEqual(at_risk["trialling"]["trialEndsIn"], 2)
        self.assertEqual(sorted(engaged), ["paying"])


class LoggedDB(ChurnDB):
    """Logs every collection read."""

    def __init__(self, collections, ledger_fails=False):
        super().__init__(collections, ledger_fails)
        self.collections_read = []

    def collection(self, name):
        self.collections_read.append(name)
        return super().collection(name)


class RevenueLedgerTests(unittest.TestCase):
    """The revenue summary from the ledger: the accounts paying now, priced and
    split by their latest payment, and churn as churn intelligence counts it.
    The user doc can't say who paid (ChurnIntelligenceTests)."""

    NOW = datetime.now(timezone.utc)

    def _ago(self, days):
        return self.NOW - timedelta(days=days)

    def _in(self, days):
        return self.NOW + timedelta(days=days)

    def _summary(self, events, rc=None, held_out=""):
        db = LoggedDB({"subscription_ledger": list(events), "analytics_cache": []})
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None), \
             patch.object(analytics_api.revenuecat_client, "get_overview_metrics", return_value=rc), \
             patch.dict(os.environ, {"ANALYTICS_EXCLUDED_UIDS": held_out}):
            result = analytics_api._compute_revenue_summary(30)
        return result, db

    def _payers(self):
        ago, later = self._ago, self._in
        return [
            ledger_event("m1", "monthly", "RENEWAL", ago(10), later(20), price=9.99),
            ledger_event("y1", "yearly", "INITIAL_PURCHASE", ago(100), later(265), price=69.99,
                         productId="annual_69_3day_free"),
            ledger_event("w1", "weekly", "RENEWAL", ago(2), later(5), price=4.99, store="RC_BILLING"),
            # USD whatever the buyer paid in: that's priceLocal
            ledger_event("e1", "euro", "RENEWAL", ago(5), later(25), price=10.49, priceLocal=9.99,
                         currency="EUR"),
            ledger_event("u1", "unpriced", "RENEWAL", ago(3), later(27), price=None),
        ]

    def test_paying_accounts_are_priced_by_their_latest_payment(self):
        result, _ = self._summary(self._payers())

        self.assertEqual(result["mrrSource"], "ledger")
        self.assertEqual(result["totalSubscribers"], 5)
        self.assertEqual((result["pricedSubscribers"], result["unpricedSubscribers"]), (4, 1))
        # 9.99 + 69.99 / 12 + 4.99 * 4 + 10.49: RevenueCat counts a week as a
        # quarter of a month
        self.assertEqual(result["mrr"], 46.27)
        self.assertEqual(result["attributedMrr"], 46.27)
        self.assertEqual(result["byProduct"], {"monthly": 20.48, "annual": 5.83, "weekly": 19.96})
        self.assertEqual(result["subscribersByProduct"], {"monthly": 2, "annual": 1, "weekly": 1})
        self.assertEqual(result["byPlatform"], {"App Store": 26.31, "Web": 19.96})

    def test_without_its_dates_a_payments_plan_comes_from_its_product(self):
        def payment(product):
            return {"productId": product, "occurredAt": self.NOW}

        self.assertEqual(analytics_api._payment_plan(payment("chunk_pro_99_web_yr")), ("annual", 12))
        self.assertEqual(analytics_api._payment_plan(payment("weekly_4_99")), ("weekly", 1 / 4))
        self.assertEqual(analytics_api._payment_plan(payment("chunk_15_1mo")), ("monthly", 1))

    def test_nothing_unpaid_counts(self):
        ago, later = self._ago, self._in

        def sale(uid, **fields):
            return ledger_event(f"s-{uid}", uid, "INITIAL_PURCHASE", ago(5), later(25), **fields)

        result, _ = self._summary([
            sale("sandbox", environment="SANDBOX"),
            sale("promotional", store="PROMOTIONAL", price=0),
            # An App Store offer code: a promotional period on APP_STORE
            sale("offer-code", periodType="PROMOTIONAL", price=0),
            sale("family", isFamilyShare=True, price=0),
            sale("free", price=0),
            sale("trial", periodType="TRIAL", price=0),
            # A tester who also bought in production pays
            sale("tester", environment="SANDBOX"),
            ledger_event("t2", "tester", "RENEWAL", ago(2), later(28)),
        ])

        self.assertEqual(result["totalSubscribers"], 1)
        self.assertEqual(result["mrr"], 4.99)
        self.assertEqual(result["trialUsers"], 1)

    def test_revenuecat_is_the_headline_and_the_ledger_the_attribution(self):
        result, _ = self._summary(self._payers(), rc={
            "mrr": 337.0, "active_subscriptions": 44.0, "active_trials": 2.0})

        self.assertEqual(result["mrrSource"], "revenuecat")
        self.assertEqual((result["mrr"], result["arr"]), (337.0, 4044.0))
        self.assertEqual((result["totalSubscribers"], result["trialUsers"]), (44, 2))
        self.assertEqual((result["attributedMrr"], result["attributedSubscribers"]), (46.27, 5))
        self.assertEqual(result["mrrTrend"][-1]["mrr"], 337.0)

    def test_held_out_accounts_never_count(self):
        result, _ = self._summary(self._payers(), held_out="monthly, weekly")

        self.assertEqual(result["totalSubscribers"], 3)
        self.assertEqual(result["mrr"], 16.32)
        self.assertEqual(result["excludedNonPaying"], 2)

    def test_reads_the_ledger_and_no_user_docs(self):
        _, db = self._summary(self._payers())

        self.assertNotIn("users", db.collections_read)
        self.assertIn("subscription_ledger", db.collections_read)

    def test_todays_revenue_counts_a_foreign_sale_at_its_usd_price(self):
        """The ledger's price is RevenueCat's USD figure; priceLocal is what the buyer paid."""
        sale = ledger_event("sale", "eur-buyer", "INITIAL_PURCHASE", self.NOW, self._in(30),
                            price=10.49, priceLocal=9.99, currency="EUR")
        result, _ = self._summary([sale])

        self.assertEqual(result["todayRevenue"], 10.49)

    def test_an_unreadable_ledger_falls_back_to_the_webhook_fields(self):
        db = LoggedDB({"users": [FakeDoc("doc-paid", {
            "subscriptionStatus": "active", "subscriptionPrice": 9.99, "subscriptionStore": "APP_STORE",
            "renewalDate": self._in(20), "createdAt": self._ago(100),
        })], "analytics_cache": []}, ledger_fails=True)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(analytics_api, "_get_redis", return_value=None), \
             patch.object(analytics_api.revenuecat_client, "get_overview_metrics", return_value=None):
            result = analytics_api._compute_revenue_summary(30)

        self.assertEqual(result["mrrSource"], "firestore")
        self.assertEqual((result["totalSubscribers"], result["mrr"]), (1, 9.99))


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
            "subscription_ledger": events or [],
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

    def test_timeline_uses_the_event_ledger(self):
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
            "lastSeenAt": self.NOW,
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

    def test_auth_email_and_last_seen_override_stale_firestore_mirror(self):
        auth_last_active = self.NOW - timedelta(hours=2)
        auth_last_active_ms = int(auth_last_active.timestamp() * 1000)
        fake_db = FakeDB({"users": [FakeDoc("u1", {
            "email": "old@example.org",
            "createdAt": self.NOW - timedelta(days=100),
            # Written by the account's owner: neither counts
            "lastActiveAt": self.NOW,
            "lastSeenAt": self.NOW,
        })]})
        identity = {
            "uid": "u1",
            "email": "current@example.org",
            "lastSeenAt": auth_last_active_ms,
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

    def test_the_auth_identity_is_last_seen_by_token_refresh_not_sign_in(self):
        record = _auth_record("u1", refreshed_days_ago=1)
        record.email, record.display_name = "u1@example.com", ""

        identity = analytics_api._auth_identity_from_record(record)

        # Signed in 300 days ago, and the app has refreshed its token since
        refreshed = record.user_metadata.last_refresh_timestamp / 1000
        self.assertEqual(identity["lastSeenAt"], datetime.fromtimestamp(refreshed, timezone.utc))

    def test_revenuecat_last_seen_stands_in_only_when_auth_has_no_record(self):
        rc_seen = int((self.NOW - timedelta(days=1)).timestamp() * 1000)
        profile = lambda uid: {"uid": uid, "lastActiveAt": rc_seen}  # noqa: E731
        auth_seen = self.NOW - timedelta(days=10)

        known = self._get_detail(users=[self._user_doc()], rc_profile=profile,
                                 identity={"uid": "u1", "lastSeenAt": auth_seen})
        unknown = self._get_detail(users=[self._user_doc()], rc_profile=profile)

        self.assertEqual(analytics_api._to_datetime(known["lastActiveAt"]), auth_seen)
        self.assertEqual(analytics_api._to_datetime(unknown["lastActiveAt"]),
                         analytics_api._to_datetime(rc_seen))

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
                "subscription_ledger": [],
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

    def test_last_active_is_auths_last_seen_or_revenuecats_without_an_auth_record(self):
        seen = datetime(2026, 9, 30, tzinfo=timezone.utc)
        by_auth = self._find("uid-2", [FakeDoc("uid-2", {"lastActiveAt": datetime(2026, 10, 3)})],
                             by_uid={"uid": "uid-2", "lastSeenAt": seen})
        by_revenuecat = self._find("billing@example.org", [], revenuecat={
            "uid": "revenuecat-only", "lastActiveAt": int(seen.timestamp() * 1000)})

        self.assertEqual(by_auth["lastActiveAt"], seen.isoformat())
        self.assertEqual(by_revenuecat["lastActiveAt"], seen.isoformat())

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
