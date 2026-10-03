"""Monthly recap pipeline tests.

The stat-computation tests pin the timestamp FIELD NAME and VALUE TYPE per
collection (audited across web/native/cerebral writers, 2026-08). The fakes
compare bounds against realistically-typed stored values, so querying the
wrong field counts nothing and passing a wrong-typed bound raises TypeError —
either way the test fails if a future change breaks the contract.

Run:
    python -m pytest server/test_email_tasks.py -v
"""

import ast
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import email_service
import email_tasks


_AUTH_GUARDS = []


def setUpModule():
    # Firebase is initialized with this machine's default credentials, so an
    # unpatched Auth lookup would reach the real project. Fail it instead;
    # tests patch email_tasks.account_email / account_emails where they need one.
    from firebase_admin import auth

    for name in ("get_user", "get_users", "list_users"):
        patcher = patch.object(auth, name, side_effect=AssertionError(f"real Firebase Auth {name} call"))
        patcher.start()
        _AUTH_GUARDS.append(patcher)


def tearDownModule():
    while _AUTH_GUARDS:
        _AUTH_GUARDS.pop().stop()


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeAgg:
    def __init__(self, value):
        self.value = value


class FakeCount:
    def __init__(self, n):
        self._n = n

    def get(self):
        return [[FakeAgg(self._n)]]


class FakeRangeQuery:
    """A subcollection holding rows (dicts) that supports where-range + count.

    Comparisons run against the stored values as-is: a bound of the wrong
    type raises TypeError instead of silently matching.
    """

    def __init__(self, rows):
        self._rows = rows

    def where(self, field, op, value):
        def keep(row):
            actual = row.get(field)
            if actual is None:
                return False
            if op == ">=":
                return actual >= value
            if op == "<":
                return actual < value
            raise AssertionError(f"Unsupported fake operator: {op}")

        return FakeRangeQuery([r for r in self._rows if keep(r)])

    def count(self):
        return FakeCount(len(self._rows))


class FakeCounterDoc:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return self._data


class FakeUserRef:
    def __init__(self, subcollections=None, counter_data=None, monitor_runs=None):
        self._subcollections = subcollections or {}
        self._counter_data = counter_data
        self._monitor_runs = monitor_runs or []
        self.requested_month_keys = []

    def collection(self, name):
        if name == "usage_monthly":
            def document(key):
                self.requested_month_keys.append(key)
                return SimpleNamespace(get=lambda: FakeCounterDoc(self._counter_data))

            return SimpleNamespace(document=document)
        if name == "monitors":
            refs = [
                SimpleNamespace(collection=lambda _n, rows=rows: FakeRangeQuery(rows))
                for rows in self._monitor_runs
            ]
            return SimpleNamespace(list_documents=lambda: refs)
        return FakeRangeQuery(self._subcollections.get(name, []))


class FakeDB:
    def __init__(self, user_ref, files_metadata_rows=None):
        self._user_ref = user_ref
        self._files_metadata_rows = files_metadata_rows or []

    def collection(self, name):
        if name == "users":
            return SimpleNamespace(document=lambda _uid: self._user_ref)
        if name == "document_metadata":
            return SimpleNamespace(
                document=lambda _uid: SimpleNamespace(
                    collection=lambda _n: FakeRangeQuery(self._files_metadata_rows)
                )
            )
        raise AssertionError(f"Unexpected collection: {name}")


# ---------------------------------------------------------------------------
# _previous_month_window
# ---------------------------------------------------------------------------


class PreviousMonthWindowTests(unittest.TestCase):
    def test_mid_year(self):
        now = datetime(2026, 8, 15, 14, 30, tzinfo=timezone.utc)
        start, end, key, next_key = email_tasks._previous_month_window(now)
        self.assertEqual(start, datetime(2026, 7, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 8, 1, tzinfo=timezone.utc))
        self.assertEqual(key, "2026-07")
        self.assertEqual(next_key, "2026-08")

    def test_january_rolls_back_to_december_of_prior_year(self):
        now = datetime(2026, 1, 1, 14, 0, tzinfo=timezone.utc)
        start, end, key, next_key = email_tasks._previous_month_window(now)
        self.assertEqual(start, datetime(2025, 12, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(key, "2025-12")
        self.assertEqual(next_key, "2026-01")

    def test_current_month_window_mid_year(self):
        now = datetime(2026, 8, 2, 10, 0, tzinfo=timezone.utc)
        start, end, key, next_key = email_tasks._current_month_window(now)
        self.assertEqual(start, datetime(2026, 8, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 9, 1, tzinfo=timezone.utc))
        self.assertEqual(key, "2026-08")
        self.assertEqual(next_key, "2026-09")

    def test_current_month_window_december_rolls_into_next_year(self):
        now = datetime(2026, 12, 31, 23, 0, tzinfo=timezone.utc)
        start, end, key, next_key = email_tasks._current_month_window(now)
        self.assertEqual(start, datetime(2026, 12, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2027, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(key, "2026-12")
        self.assertEqual(next_key, "2027-01")


# ---------------------------------------------------------------------------
# _recap_should_send
# ---------------------------------------------------------------------------


def _stats(**overrides):
    base = {
        "searches": 0, "documents": 0, "images": 0, "notes": 0,
        "collections": 0, "captures": 0, "automations": 0, "artifacts": 0,
    }
    base.update(overrides)
    return base


class RecapShouldSendTests(unittest.TestCase):
    def test_all_zero_does_not_send(self):
        self.assertFalse(email_tasks._recap_should_send(_stats()))

    def test_two_searches_alone_do_not_send(self):
        self.assertFalse(email_tasks._recap_should_send(_stats(searches=2)))

    def test_three_searches_alone_send(self):
        self.assertTrue(email_tasks._recap_should_send(_stats(searches=3)))

    def test_any_non_search_stat_sends(self):
        self.assertTrue(email_tasks._recap_should_send(_stats(captures=1)))
        self.assertTrue(email_tasks._recap_should_send(_stats(artifacts=1)))


# ---------------------------------------------------------------------------
# _compute_recap_stats — field names, value types, window bounds
# ---------------------------------------------------------------------------

WINDOW = (
    datetime(2026, 7, 1, tzinfo=timezone.utc),
    datetime(2026, 8, 1, tzinfo=timezone.utc),
    "2026-07",
    "2026-08",
)

IN_MONTH_DT = datetime(2026, 7, 15, tzinfo=timezone.utc)
BEFORE_DT = datetime(2026, 6, 30, 23, 59, tzinfo=timezone.utc)
AFTER_DT = datetime(2026, 8, 1, tzinfo=timezone.utc)  # boundary: excluded


class ComputeRecapStatsTests(unittest.TestCase):
    def _compute(self, db):
        return email_tasks._compute_recap_stats(db, "uid123", window=WINDOW)

    def test_default_window_is_the_previous_month(self):
        user_ref = FakeUserRef(subcollections={}, counter_data=None)
        with patch.object(email_tasks, "_previous_month_window", return_value=WINDOW) as pw:
            email_tasks._compute_recap_stats(FakeDB(user_ref), "uid123")
        pw.assert_called_once()
        self.assertEqual(user_ref.requested_month_keys, ["2026-07"])

    def test_counts_each_source_with_its_own_field_and_type(self):
        user_ref = FakeUserRef(
            subcollections={
                # notes/collections: Firestore-Timestamp `createdAt` (datetime)
                "notes": [
                    {"createdAt": IN_MONTH_DT},
                    {"createdAt": datetime(2026, 7, 1, tzinfo=timezone.utc)},  # >= start: in
                    {"createdAt": BEFORE_DT},
                    {"createdAt": AFTER_DT},
                ],
                "collections": [{"createdAt": IN_MONTH_DT}, {"createdAt": BEFORE_DT}],
                # generated_images: numeric epoch-seconds `timestamp`
                "generated_images": [
                    {"timestamp": float(int(IN_MONTH_DT.timestamp()))},
                    {"timestamp": float(int(BEFORE_DT.timestamp()))},
                ],
                # transforms: ISO-string `created_at`, both suffix variants
                "transforms": [
                    {"created_at": "2026-07-15T10:00:00+00:00"},
                    {"created_at": "2026-07-02T09:30:00.123456Z"},
                    {"created_at": "2026-06-15T10:00:00+00:00"},
                    {"created_at": "2026-08-01T00:00:00+00:00"},
                ],
            },
            counter_data={"searches": 7, "captures": 2, "updated_at": "x"},
            # two monitors: one run in-window each plus out-of-window noise
            monitor_runs=[
                [
                    {"created_at": "2026-07-20T08:00:00+00:00"},
                    {"created_at": "2026-06-20T08:00:00+00:00"},
                ],
                [
                    {"created_at": "2026-07-01T00:00:00Z"},
                ],
            ],
        )
        db = FakeDB(
            user_ref,
            files_metadata_rows=[
                {"timestamp": int(IN_MONTH_DT.timestamp())},
                {"timestamp": int(AFTER_DT.timestamp())},
                {"noTimestamp": True},  # temp chat attachments omit the field
            ],
        )

        stats = self._compute(db)

        self.assertEqual(stats, {
            "searches": 7,
            "captures": 2,
            "documents": 1,
            "images": 1,
            "notes": 2,
            "collections": 1,
            "artifacts": 2,
            "automations": 2,
        })
        # The counter doc read must target the PREVIOUS month's key
        self.assertEqual(user_ref.requested_month_keys, ["2026-07"])

    def test_missing_counter_doc_reads_as_zero(self):
        user_ref = FakeUserRef(subcollections={}, counter_data=None)
        db = FakeDB(user_ref)

        stats = self._compute(db)

        self.assertEqual(stats["searches"], 0)
        self.assertEqual(stats["captures"], 0)


# ---------------------------------------------------------------------------
# Template rendering
# ---------------------------------------------------------------------------


class MonthlyRecapTemplateTests(unittest.TestCase):
    def test_min_saved_is_gone(self):
        _, html, text = email_service.get_monthly_recap_email(
            "James", searches=127, documents=23, images=8, notes=34,
            collections=6, captures=19, automations=12, artifacts=4,
        )
        self.assertNotIn("Min Saved", html)
        self.assertNotIn("minutes</strong>", html)
        self.assertNotIn("Min Saved", text)

    def test_all_eight_stats_render_when_non_zero(self):
        _, html, _ = email_service.get_monthly_recap_email(
            "James", searches=1, documents=2, images=3, notes=4,
            collections=5, captures=6, automations=7, artifacts=8,
        )
        for label in ("Searches", "Documents", "Images", "Notes",
                      "Collections", "Captures", "Automations", "Artifacts"):
            self.assertIn(f">{label}</p>", html)

    def test_zero_stats_are_hidden(self):
        _, html, _ = email_service.get_monthly_recap_email(
            "James", searches=12, documents=2,
        )
        self.assertIn(">Searches</p>", html)
        self.assertIn(">Documents</p>", html)
        for label in ("Images", "Notes", "Collections", "Captures",
                      "Automations", "Artifacts"):
            self.assertNotIn(f">{label}</p>", html)

    def test_preheader_lists_leading_non_zero_stats(self):
        _, html, text = email_service.get_monthly_recap_email(
            "James", searches=12, captures=3,
        )
        self.assertIn("12 searches", html)
        self.assertIn("3 captures", text)


# ---------------------------------------------------------------------------
# send_monthly_recap_task — skip rule + tracking isolation
# ---------------------------------------------------------------------------


class SendTaskTests(unittest.TestCase):
    def _run(self, stats, send_result=None, track_fails=False):
        fake_db = object()
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=fake_db)}), \
             patch.object(email_tasks, "account_email", return_value="james@example.org"), \
             patch.object(email_tasks, "marketing_blocked", return_value=None), \
             patch.object(email_tasks, "_compute_recap_stats", return_value=stats) as compute, \
             patch.object(email_tasks.email_service, "send_monthly_recap",
                          return_value=send_result or {"id": "re_123"}) as send, \
             patch.object(email_tasks, "track_email_sent",
                          side_effect=RuntimeError("boom") if track_fails else None) as track:
            result = email_tasks.send_monthly_recap_task(
                "james@example.org", "James", user_id="uid123"
            )
        return result, compute, send, track

    def test_below_threshold_skips_without_sending(self):
        result, _, send, _ = self._run(_stats(searches=2))
        self.assertEqual(result["reason"], "no_usage")
        send.assert_not_called()

    def test_sends_stats_by_keyword(self):
        stats = _stats(searches=5, captures=2)
        result, _, send, track = self._run(stats)
        self.assertEqual(result["status"], "sent")
        _, kwargs = send.call_args
        self.assertEqual(kwargs["user_id"], "uid123")
        self.assertEqual(kwargs["searches"], 5)
        self.assertEqual(kwargs["captures"], 2)
        track.assert_called_once_with("uid123", "james@example.org", "monthly_recap", "re_123")

    def test_tracking_failure_does_not_retry_a_sent_email(self):
        result, _, send, _ = self._run(_stats(captures=1), track_fails=True)
        self.assertEqual(result["status"], "sent")
        send.assert_called_once()

    def test_missing_user_id_skips(self):
        # No uid means no switch to check: the consent gate blocks the send.
        with patch.object(email_tasks.email_service, "send_monthly_recap") as send:
            result = email_tasks.send_monthly_recap_task("james@example.org", "James")
        self.assertEqual(result["reason"], "no_user_id")
        send.assert_not_called()


# ---------------------------------------------------------------------------
# check_monthly_recap_task — pagination, dedupe, cooldown, dry run
# ---------------------------------------------------------------------------


class FakeUserDoc:
    def __init__(self, doc_id, data, auth_email=None):
        self.id = doc_id
        self._data = data
        self.auth_email = auth_email  # what Firebase Auth holds for this uid
        self.reference = MagicMock()

    def to_dict(self):
        return self._data


class FakeUsersQuery:
    """Supports the cursor pattern: where(in) → order_by(__name__) →
    limit(n) [→ start_after(doc)] → stream()."""

    def __init__(self, docs, limit_n=None, after_id=None):
        self._docs = docs
        self._limit = limit_n
        self._after_id = after_id

    def where(self, field, op, value):
        assert (field, op) == ("subscriptionStatus", "in")
        return FakeUsersQuery(
            [d for d in self._docs if d.to_dict().get(field) in value],
            self._limit, self._after_id,
        )

    def order_by(self, field):
        assert field == "__name__"
        return FakeUsersQuery(sorted(self._docs, key=lambda d: d.id),
                              self._limit, self._after_id)

    def limit(self, n):
        return FakeUsersQuery(self._docs, n, self._after_id)

    def start_after(self, doc):
        return FakeUsersQuery(self._docs, self._limit, doc.id)

    def stream(self):
        docs = self._docs
        if self._after_id is not None:
            docs = [d for d in docs if d.id > self._after_id]
        return iter(docs[: self._limit])


class FakeBeatDB:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, name):
        assert name == "users"
        return FakeUsersQuery(self._docs)


def _active_user(doc_id, email, **extra):
    data = {"subscriptionStatus": "active", "displayName": "U"}
    data.update(extra)
    return FakeUserDoc(doc_id, data, auth_email=email)


def _fake_auth(docs):
    """account_emails over the docs' Auth addresses."""
    def account_emails(uids):
        wanted = set(uids)
        return {d.id: d.auth_email for d in docs if d.id in wanted and d.auth_email}
    return account_emails


class CheckTaskTests(unittest.TestCase):
    def _run_beat(self, docs, page_size=2, dry_run=False):
        db = FakeBeatDB(docs)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", _fake_auth(docs)), \
             patch.object(email_tasks, "RECAP_PAGE_SIZE", page_size), \
             patch.object(email_tasks.send_monthly_recap_task, "apply_async") as dispatch:
            result = email_tasks.check_monthly_recap_task(dry_run=dry_run)
        return result, dispatch

    def test_traverses_past_the_first_page_and_marks_each_user(self):
        # 5 users at page size 2 = three pages, the last one short
        docs = [_active_user(f"uid{i:03d}", f"u{i}@real.org") for i in range(5)]
        result, dispatch = self._run_beat(docs)
        self.assertEqual(result["emails_queued"], 5)
        self.assertEqual(dispatch.call_count, 5)
        for doc in docs:
            doc.reference.update.assert_called_once()
        # Only the name and uid travel: no stats, and no address (the send
        # task looks it up in Firebase Auth when it runs)
        _, kwargs = dispatch.call_args
        self.assertEqual(set(kwargs["kwargs"]), {"user_name", "user_id"})
        self.assertNotIn("args", kwargs)

    def test_dedupe_and_cooldown_skip(self):
        now = datetime.now(timezone.utc)
        docs = [
            _active_user("uid1", "a@real.org",
                         emailsSent={"monthlyRecap": now}),          # dedupe
            _active_user("uid2", "b@real.org",
                         emailsSent={"welcomeDay1": now}),           # cooldown
            _active_user("uid3", "c@real.org"),
        ]
        result, dispatch = self._run_beat(docs)
        self.assertEqual(result["emails_queued"], 1)
        dispatch.assert_called_once()
        self.assertEqual(dispatch.call_args[1]["kwargs"]["user_id"], "uid3")

    def test_dry_run_dispatches_and_marks_nothing(self):
        docs = [_active_user("uid1", "a@real.org")]
        result, dispatch = self._run_beat(docs, dry_run=True)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(result["candidates"], [{"uid": "uid1", "email": "a@real.org"}])
        dispatch.assert_not_called()
        docs[0].reference.update.assert_not_called()


# ---------------------------------------------------------------------------
# The welcome email: the Cloud Function's, never this server's
# ---------------------------------------------------------------------------


class CreatedAtWindowQuery:
    """users where(createdAt >= / <=) → limit(n) → stream(), filtered for real."""

    def __init__(self, docs):
        self._docs = docs

    def where(self, field, op, value):
        assert field == "createdAt" and op in (">=", "<=")
        if op == ">=":
            return CreatedAtWindowQuery([d for d in self._docs if d.to_dict()[field] >= value])
        return CreatedAtWindowQuery([d for d in self._docs if d.to_dict()[field] <= value])

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._docs)


class RetiredInstantWelcomeTests(unittest.TestCase):
    """The Cloud Function syncEmailToFirestore sends the welcome email at
    signup. This server's copy (check_welcome_instant) never sent one: it
    raised NameError. But it set emailsSent.welcome about an hour after
    signup, and that flag started the 24-hour cooldown. The day-1 beat sees a
    user once or twice, 20-28 hours after signup, so a user whose only run
    came within 24 hours of the flag never got day 1. That was 22 of the 65
    accounts created in September 2026."""

    def _run_day1(self, docs):
        db = SimpleNamespace(collection=lambda name: CreatedAtWindowQuery(docs))
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", _fake_auth(docs)), \
             patch.object(email_tasks.send_day1_help_center_task, "delay") as delay:
            result = email_tasks.check_welcome_sequence_day1_task()
        return result, delay

    def test_an_old_welcome_flag_does_not_hold_back_day_one(self):
        # 23 hours after signup is the run that used to skip the account for
        # good: within 24 hours of the flag, and the next run is past 28.
        now = datetime.now(timezone.utc)
        doc = FakeUserDoc(
            "uid1",
            {
                "displayName": "Ada",
                "createdAt": now - timedelta(hours=23),
                "emailsSent": {"welcome": now - timedelta(hours=22)},
            },
            auth_email="ada@example.org",
        )
        result, delay = self._run_day1([doc])
        self.assertEqual(result["emails_queued"], 1)
        self.assertEqual(delay.call_args.kwargs, {"user_name": "Ada", "user_id": "uid1"})
        doc.reference.update.assert_called_once()

    def test_a_recent_campaign_email_still_holds_back_day_one(self):
        now = datetime.now(timezone.utc)
        doc = FakeUserDoc(
            "uid1",
            {
                "createdAt": now - timedelta(hours=23),
                # a trial account that signed up just before the 1st-of-month recap
                "emailsSent": {"monthlyRecap": now - timedelta(hours=2)},
            },
            auth_email="ada@example.org",
        )
        result, delay = self._run_day1([doc])
        self.assertEqual(result["emails_queued"], 0)
        delay.assert_not_called()

    def test_nothing_here_sends_a_welcome_email(self):
        # Read the beat schedule from source: importing celery_app runs
        # sentry_sdk.init, which patches libraries for every later test.
        source = (Path(__file__).parent / "celery_app.py").read_text()
        scheduled = {
            value.value
            for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.Dict)
            for key, value in zip(node.keys, node.values)
            if isinstance(key, ast.Constant) and key.value == "task"
            and isinstance(value, ast.Constant)
        }
        self.assertIn("check_welcome_sequence_day1", scheduled)
        self.assertNotIn("check_welcome_instant", scheduled)
        registered = {
            getattr(email_tasks, name).name
            for name in dir(email_tasks)
            if name.endswith("_task") and hasattr(getattr(email_tasks, name), "name")
        }
        self.assertNotIn("send_welcome_email", registered)
        self.assertNotIn("welcome", email_tasks.MARKETING_EMAIL_FLAGS)


# ---------------------------------------------------------------------------
# Marketing consent: which emails check it, and the check itself
# ---------------------------------------------------------------------------

import email_tracking  # noqa: E402

# task name -> (email_service sender it calls, extra positional args after the name)
MARKETING_TASKS = {
    "send_winback_7day_task": ("send_winback_7day", ()),
    "send_winback_30day_task": ("send_winback_30day", ()),
    "send_day1_help_center_task": ("send_day1_help_center", ()),
    "send_day3_artifacts_task": ("send_day3_artifacts", ()),
    "send_day7_researcher_stories_task": ("send_day7_researcher_stories", ()),
    "send_reengagement_14day_task": ("send_reengagement_14day", ()),
    "send_signup_no_trial_nudge_task": ("send_signup_no_trial_nudge", ()),
    "send_feature_announcement_task": ("send_feature_announcement", ("Feature", "What it does", "✨")),
}
ACCOUNT_TASKS = {
    "send_trial_ending_task": ("send_trial_ending", (12,)),
    "send_renewal_reminder_task": ("send_renewal_reminder", (7, "$9.99")),
    "send_billing_issue_task": ("send_billing_issue", ()),
    "send_subscription_expired_task": ("send_subscription_expired", ()),
}


def _call(task_name, extra):
    task = getattr(email_tasks, task_name)
    with patch.object(email_tasks, "account_email", return_value="ada@example.org"):
        return task("ada@example.org", "Ada", *extra, user_id="uid1")


class ConsentGateTests(unittest.TestCase):
    def test_every_marketing_task_checks_consent_before_sending(self):
        for task_name, (sender, extra) in MARKETING_TASKS.items():
            with self.subTest(task=task_name), \
                 patch.object(email_tasks, "marketing_blocked", return_value="opted_out") as gate, \
                 patch.object(email_tasks.email_service, sender) as send:
                result = _call(task_name, extra)
            gate.assert_called_once_with("uid1", "ada@example.org")
            send.assert_not_called()
            self.assertEqual(result["reason"], "opted_out")

    def test_a_consenting_account_gets_the_marketing_email(self):
        for task_name, (sender, extra) in MARKETING_TASKS.items():
            with self.subTest(task=task_name), \
                 patch.object(email_tasks, "marketing_blocked", return_value=None), \
                 patch.object(email_tasks.email_service, sender, return_value={"id": "e1"}) as send, \
                 patch.object(email_tasks, "track_email_sent"):
                result = _call(task_name, extra)
            send.assert_called_once()
            self.assertEqual(result["status"], "sent")

    def test_an_unreadable_consent_never_sends(self):
        # Fail closed: the error reaches Celery's autoretry instead of a send.
        task_name, (sender, extra) = "send_day1_help_center_task", MARKETING_TASKS["send_day1_help_center_task"]
        boom = email_tracking.MarketingConsentUnavailable("firestore down")
        with patch.object(email_tasks, "account_email", return_value="ada@example.org"), \
             patch.object(email_tasks, "marketing_blocked", side_effect=boom), \
             patch.object(email_tasks.email_service, sender) as send:
            with self.assertRaises(Exception):
                email_tasks.send_day1_help_center_task.run("ada@example.org", "Ada", user_id="uid1")
        send.assert_not_called()

    def test_account_emails_ignore_marketing_opt_outs(self):
        # A billing warning or a renewal reminder is not marketing.
        for task_name, (sender, extra) in ACCOUNT_TASKS.items():
            with self.subTest(task=task_name), \
                 patch.object(email_tasks, "marketing_blocked", side_effect=AssertionError("checked consent")), \
                 patch.object(email_tasks.email_service, sender, return_value={"id": "e1"}) as send, \
                 patch.object(email_tasks, "track_email_sent"):
                result = _call(task_name, extra)
            send.assert_called_once()
            self.assertEqual(result["status"], "sent")


class FakeConsentDB:
    """users/{uid} and emailUnsubscribes/{id} docs, by path."""

    def __init__(self, docs, fail=False):
        self.docs = docs
        self.fail = fail

    def collection(self, name):
        return SimpleNamespace(document=lambda doc_id: SimpleNamespace(get=lambda: self._get(f"{name}/{doc_id}")))

    def _get(self, path):
        if self.fail:
            raise RuntimeError("unavailable")
        data = self.docs.get(path)
        return SimpleNamespace(exists=data is not None, to_dict=lambda: data)


class MarketingBlockedTests(unittest.TestCase):
    def _blocked(self, docs, uid="u1", email="Ada@Example.org", fail=False):
        with patch.object(email_tracking, "db", FakeConsentDB(docs, fail)):
            return email_tracking.marketing_blocked(uid, email)

    def test_a_consenting_account_may_be_emailed(self):
        self.assertIsNone(self._blocked({"users/u1": {"isSubscribedToEmails": True}}))
        self.assertIsNone(self._blocked({"users/u1": {}}))  # a missing field is consent

    def test_the_settings_switch_blocks(self):
        self.assertEqual(self._blocked({"users/u1": {"isSubscribedToEmails": False}}), "opted_out")

    def test_an_address_record_blocks_in_any_letter_case(self):
        for record in ("emailUnsubscribes/ada@example.org", "emailUnsubscribes/Ada@Example.org"):
            with self.subTest(record=record):
                self.assertEqual(self._blocked({"users/u1": {}, record: {}}), "unsubscribed")

    def test_an_opt_out_under_the_doc_address_still_blocks(self):
        # Marketing used to go to users/{uid}.email, so unsubscribe links
        # carried that address; the email now goes to the Auth address.
        docs = {"users/u1": {"email": "Old@Example.org"}, "emailUnsubscribes/old@example.org": {}}
        self.assertEqual(self._blocked(docs, email="new@example.org"), "unsubscribed")
        self.assertIsNone(self._blocked({"users/u1": {"email": "old@example.org"}}, email="new@example.org"))
        self.assertIsNone(self._blocked({"users/u1": {"email": 42}}, email="new@example.org"))

    def test_no_uid_or_no_account_blocks(self):
        self.assertEqual(self._blocked({}, uid=None), "no_user_id")
        self.assertEqual(self._blocked({}), "no_account")

    def test_a_failed_read_raises_instead_of_allowing(self):
        with self.assertRaises(email_tracking.MarketingConsentUnavailable):
            self._blocked({}, fail=True)


class SenderTests(unittest.TestCase):
    def _send(self, email_type, to="ada+chunk@example.org", secret="test-secret"):
        sent = {}
        env = {"EMAIL_UNSUBSCRIBE_SECRET": secret} if secret else {}
        with patch.dict("os.environ", env, clear=False), \
             patch.object(email_service.httpx, "post",
                          side_effect=lambda url, **kw: sent.update(kw) or MagicMock(status_code=200, json=lambda: {"id": "e1"})):
            if not secret:
                os_environ = __import__("os").environ
                os_environ.pop("EMAIL_UNSUBSCRIBE_SECRET", None)
            email_service.send_email(to, "s", "<p>{UNSUBSCRIBE_LINK_PLACEHOLDER}</p>", "t", email_type=email_type)
        return sent["json"]

    def test_marketing_comes_from_the_marketing_mailbox(self):
        for email_type in sorted(email_service.MARKETING_EMAIL_TYPES):
            with self.subTest(email_type=email_type):
                payload = self._send(email_type)
                self.assertEqual(payload["from"], email_service.MARKETING_FROM_EMAIL)
                self.assertEqual(payload["reply_to"], email_service.MARKETING_REPLY_TO)
        self.assertIn("meetchunk@chunkapp.com", email_service.MARKETING_FROM_EMAIL)

    def test_account_email_stays_on_info(self):
        for email_type in ("trial_ending", "renewal_reminder", "billing_issue", "subscription_expired"):
            with self.subTest(email_type=email_type):
                payload = self._send(email_type)
                self.assertEqual(payload["from"], email_service.FROM_EMAIL)
                self.assertNotIn("reply_to", payload)

    def test_a_plus_address_survives_the_unsubscribe_link(self):
        payload = self._send("day1_help_center")
        self.assertIn("email=ada%2Bchunk@example.org&", payload["headers"]["List-Unsubscribe"])
        self.assertIn("email=ada%2Bchunk@example.org&amp;token=", payload["html"])
        self.assertEqual(payload["headers"]["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")

    def test_without_the_secret_there_is_no_unsubscribe_link(self):
        payload = self._send("day1_help_center", secret=None)
        self.assertEqual(payload["html"], "<p></p>")
        self.assertNotIn("headers", payload)


# ---------------------------------------------------------------------------
# The 14-day re-engagement email: who counts as 14 days idle
# ---------------------------------------------------------------------------

import account_activity  # noqa: E402
from firebase_admin import auth as firebase_auth  # noqa: E402

DAY_MS = 24 * 3600 * 1000


def _auth_user(uid, idle_days, email="", disabled=False, signed_in_days=None):
    """A Firebase Auth record whose last token refresh was idle_days ago.
    It was created and last signed in a month before that, unless given."""
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    signed_in_days = idle_days + 30 if signed_in_days is None else signed_in_days
    return SimpleNamespace(
        uid=uid,
        email=f"{uid}@real.org" if email == "" else email,
        disabled=disabled,
        user_metadata=SimpleNamespace(
            creation_timestamp=int(now_ms - (idle_days + 30) * DAY_MS),
            last_sign_in_timestamp=int(now_ms - signed_in_days * DAY_MS),
            last_refresh_timestamp=int(now_ms - idle_days * DAY_MS),
        ),
    )


def _list_users(records):
    return lambda *_args, **_kwargs: SimpleNamespace(iterate_all=lambda: iter(records))


class FakeSnap:
    def __init__(self, uid, data):
        self.id = uid
        self.exists = data is not None
        self._data = data
        self.reference = MagicMock()

    def to_dict(self):
        return self._data


class FakeUserDocsDB:
    """users/{uid} docs read by reference through get_all. There are no
    queries: the beat must not pick accounts by a users-doc field."""

    def __init__(self, docs):
        self.snaps = {uid: FakeSnap(uid, data) for uid, data in docs.items()}
        self.read = []

    def collection(self, name):
        assert name == "users"
        return SimpleNamespace(document=lambda uid: uid)

    def get_all(self, refs):
        refs = list(refs)
        self.read.extend(refs)
        return [self.snaps.get(uid) or FakeSnap(uid, None) for uid in refs]


class ReengagementBeatTests(unittest.TestCase):
    """users.lastActiveAt has no writer and no prod doc carries it, so the
    beat that selected by it never sent (0 sent as of 2026-10-03). It selects
    by Firebase Auth activity now."""

    def _run(self, records, docs, used=(), dry_run=False, limit=None):
        db = FakeUserDocsDB(docs)
        since = []

        def used_since(_db, uid, when):
            since.append(when)
            return uid in used

        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(firebase_auth, "list_users", _list_users(records)), \
             patch.object(email_tasks, "used_since", side_effect=used_since), \
             patch.object(email_tasks, "REENGAGEMENT_DAILY_LIMIT", limit or email_tasks.REENGAGEMENT_DAILY_LIMIT), \
             patch.object(email_tasks.send_reengagement_14day_task, "delay") as delay:
            result = email_tasks.check_reengagement_14day_task(dry_run=dry_run)
        return result, delay, db, since

    def test_emails_an_account_last_used_fourteen_days_ago(self):
        result, delay, db, _ = self._run([_auth_user("uid1", 14)], {"uid1": {"displayName": "Ada"}})
        self.assertEqual(result, {"status": "completed", "emails_queued": 1})
        delay.assert_called_once_with(user_name="Ada", user_id="uid1")
        db.snaps["uid1"].reference.update.assert_called_once_with({"emailsSent.reengagement14Day": ANY})

    def test_only_one_day_of_idle_accounts_qualifies(self):
        # No backlog on the first run: 15 days, a month and a year idle are
        # past the window, and 13 days isn't there yet.
        records = [_auth_user(f"uid{days}", days) for days in (1, 13, 14, 15, 30, 365)]
        result, delay, db, _ = self._run(records, {r.uid: {} for r in records})
        self.assertEqual(result["emails_queued"], 1)
        delay.assert_called_once_with(user_name="there", user_id="uid14")
        self.assertEqual(db.read, ["uid14"])

    def test_an_app_still_refreshing_its_token_is_in_use(self):
        # Signed in 14 days ago; the app has refreshed its token since.
        result, delay, _, _ = self._run([_auth_user("uid1", 2, signed_in_days=14)], {"uid1": {}})
        self.assertEqual(result["emails_queued"], 0)
        delay.assert_not_called()

    def test_a_left_over_last_active_at_means_nothing(self):
        now = datetime.now(timezone.utc)
        records = [_auth_user("uid1", 3)]
        result, delay, _, _ = self._run(records, {"uid1": {"lastActiveAt": now - timedelta(days=14)}})
        self.assertEqual(result["emails_queued"], 0)
        delay.assert_not_called()

    def test_a_capture_since_the_window_counts_as_use(self):
        # The share sheet, the web clipper and email-in never refresh a token.
        records = [_auth_user("uid1", 14), _auth_user("uid2", 14)]
        result, delay, _, since = self._run(records, {"uid1": {}, "uid2": {}}, used={"uid1"})
        self.assertEqual(result["emails_queued"], 1)
        delay.assert_called_once_with(user_name="there", user_id="uid2")
        # activity after the window's end: newer than 13.5 days
        window_end = datetime.now(timezone.utc) - timedelta(days=13, hours=12)
        for when in since:
            self.assertLess(abs((when - window_end).total_seconds()), 60)

    def test_keeps_every_guard(self):
        now = datetime.now(timezone.utc)
        records = [
            _auth_user("sent", 14),
            _auth_user("cooldown", 14),
            _auth_user("stale", 14),
            _auth_user("nodoc", 14),
            _auth_user("noaddress", 14, email=None),
            _auth_user("testdomain", 14, email="qa@example.com"),
            _auth_user("disabled", 14, disabled=True),
            _auth_user("ok", 14),
        ]
        docs = {
            "sent": {"emailsSent": {"reengagement14Day": now - timedelta(days=200)}},  # once ever
            "cooldown": {"emailsSent": {"welcomeDay7": now - timedelta(hours=3)}},
            "stale": {"createdAt": now - timedelta(days=400)},
            "noaddress": {},
            "testdomain": {},
            "disabled": {},
            "ok": {"emailsSent": None},
        }
        result, delay, db, _ = self._run(records, docs)
        self.assertEqual(result["emails_queued"], 1)
        delay.assert_called_once_with(user_name="there", user_id="ok")
        for uid, snap in db.snaps.items():
            if uid != "ok":
                snap.reference.update.assert_not_called()

    def test_the_send_still_checks_marketing_consent(self):
        self.assertIn("send_reengagement_14day_task", MARKETING_TASKS)
        self.assertIn("reengagement_14day", email_service.MARKETING_EMAIL_TYPES)

    def test_dry_run_dispatches_and_marks_nothing(self):
        records = [_auth_user("uid1", 14, email="ada@real.org")]
        result, delay, db, _ = self._run(records, {"uid1": {}}, dry_run=True)
        self.assertEqual(result, {"status": "dry_run", "candidates": [{"uid": "uid1", "email": "ada@real.org"}]})
        delay.assert_not_called()
        db.snaps["uid1"].reference.update.assert_not_called()

    def test_a_run_stops_at_the_daily_limit(self):
        records = [_auth_user(f"uid{i}", 14) for i in range(3)]
        result, delay, _, _ = self._run(records, {r.uid: {} for r in records}, limit=2)
        self.assertEqual(result["emails_queued"], 2)
        self.assertEqual(delay.call_count, 2)


class AccountActivityTests(unittest.TestCase):
    def test_last_seen_is_the_latest_auth_timestamp(self):
        user = SimpleNamespace(user_metadata=SimpleNamespace(
            creation_timestamp=1_000, last_sign_in_timestamp=3_000, last_refresh_timestamp=2_000,
        ))
        self.assertEqual(account_activity.last_seen(user), datetime.fromtimestamp(3, timezone.utc))

    def test_an_account_without_timestamps_is_never_idle(self):
        user = SimpleNamespace(uid="u1", email="u1@real.org", disabled=False, user_metadata=SimpleNamespace(
            creation_timestamp=None, last_sign_in_timestamp=None, last_refresh_timestamp=None,
        ))
        self.assertIsNone(account_activity.last_seen(user))
        with patch.object(firebase_auth, "list_users", _list_users([user])):
            found = account_activity.accounts_last_seen_between(
                datetime(2000, 1, 1, tzinfo=timezone.utc), datetime.now(timezone.utc),
            )
        self.assertEqual(found, {})

    def test_lists_enabled_accounts_in_the_window_with_their_auth_address(self):
        now = datetime.now(timezone.utc)
        records = [
            _auth_user("in", 14, email="in@real.org"),
            _auth_user("no-email", 14, email=None),
            _auth_user("disabled", 14, disabled=True),
            _auth_user("before", 20),
            _auth_user("after", 5),
        ]
        with patch.object(firebase_auth, "list_users", _list_users(records)):
            found = account_activity.accounts_last_seen_between(now - timedelta(days=15), now - timedelta(days=13))
        self.assertEqual(found, {"in": "in@real.org", "no-email": None})


class TypedRangeQuery:
    """where(field, ">=", bound) → limit → stream. Like Firestore, a range
    filter matches only values of the bound's own type."""

    def __init__(self, rows):
        self._rows = rows

    def where(self, field, op, bound):
        assert op == ">="

        def same_type(value):
            if isinstance(bound, datetime):
                return isinstance(value, datetime)
            if isinstance(bound, (int, float)):
                return isinstance(value, (int, float)) and not isinstance(value, bool)
            return isinstance(value, type(bound))

        return TypedRangeQuery([r for r in self._rows if same_type(r.get(field)) and r[field] >= bound])

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._rows)


def _activity_db(subcollections):
    """users/{uid}/{name} rows for one account."""
    user = SimpleNamespace(collection=lambda name: TypedRangeQuery(subcollections.get(name, [])))
    return SimpleNamespace(collection=lambda _name: SimpleNamespace(document=lambda _uid: user))


class UsedSinceTests(unittest.TestCase):
    SINCE = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)

    def test_each_signal_that_never_refreshes_a_token_counts(self):
        after = self.SINCE + timedelta(hours=1)
        signals = {
            "a capture through cerebral": {"inbox": [{"createdAt": after}]},
            "a share-sheet capture (epoch seconds)": {"inbox": [{"createdAt": after.timestamp()}]},
            "an inbox ISO string": {"inbox": [{"createdAt": after.isoformat()}]},
            "a chat counted in usage_monthly": {"usage_monthly": [{"updated_at": after.isoformat()}]},
            "an App Intents job": {"intent_jobs": [{"updated_at": after.isoformat().replace("+00:00", "Z")}]},
        }
        for label, subcollections in signals.items():
            with self.subTest(label):
                self.assertTrue(account_activity.used_since(_activity_db(subcollections), "uid1", self.SINCE))

    def test_older_activity_does_not(self):
        before = self.SINCE - timedelta(hours=1)
        db = _activity_db({
            "inbox": [{"createdAt": before}, {"createdAt": before.timestamp()}, {"createdAt": before.isoformat()}],
            "usage_monthly": [{"updated_at": before.isoformat()}],
            "intent_jobs": [{"updated_at": before.isoformat().replace("+00:00", "Z")}],
        })
        self.assertFalse(account_activity.used_since(db, "uid1", self.SINCE))


# ---------------------------------------------------------------------------
# Win-back and the no-trial nudge: both spellings of a cancellation
# ---------------------------------------------------------------------------


class ChurnWindowQuery:
    """users where(subscriptionStatus in) → where(expirationDate >= / <=) →
    limit(n) → stream(), filtered for real."""

    def __init__(self, docs):
        self._docs = docs

    def where(self, field, op, value):
        if (field, op) == ("subscriptionStatus", "in"):
            # Firestore rejects an `in` filter with more than 30 values
            assert 0 < len(value) <= 30, value
            keep = lambda doc: doc.to_dict().get(field) in value  # noqa: E731
        elif (field, op) == ("expirationDate", ">="):
            keep = lambda doc: doc.to_dict()[field] >= value  # noqa: E731
        elif (field, op) == ("expirationDate", "<="):
            keep = lambda doc: doc.to_dict()[field] <= value  # noqa: E731
        else:
            raise AssertionError(f"unexpected filter: {field} {op}")
        return ChurnWindowQuery([doc for doc in self._docs if keep(doc)])

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._docs)


class WinbackSpellingTests(unittest.TestCase):
    """cerebral's webhook writes subscriptionStatus "cancelled"; the Cloud
    Function updateSubscriptionStatus writes "canceled", on EXPIRATION too.
    On 2026-10-03, 457 prod accounts read "canceled", and none had a win-back:
    the beats matched only "expired" and "cancelled"."""

    BEATS = {
        "check_churned_users_7day_task": ("send_winback_7day_task", "winback7Day", 7),
        "check_churned_users_30day_task": ("send_winback_30day_task", "winback30Day", 30),
    }

    def _churned(self, uid, status, days_ago, **extra):
        data = {
            "subscriptionStatus": status,
            "expirationDate": datetime.now(timezone.utc) - timedelta(days=days_ago),
            "displayName": "U",
        }
        data.update(extra)
        return FakeUserDoc(uid, data, auth_email=f"{uid}@real.org")

    def _run(self, beat_name, docs):
        send_task = getattr(email_tasks, self.BEATS[beat_name][0])
        db = SimpleNamespace(collection=lambda name: ChurnWindowQuery(docs))
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", _fake_auth(docs)), \
             patch.object(send_task, "delay") as delay:
            result = getattr(email_tasks, beat_name)()
        return result, sorted(c.kwargs["user_id"] for c in delay.call_args_list)

    def test_both_spellings_of_a_cancellation_get_the_winback(self):
        for beat_name, (_, flag, days) in self.BEATS.items():
            with self.subTest(beat_name):
                churned = [self._churned(status, status, days) for status in ("canceled", "cancelled", "expired")]
                renewed = self._churned("active", "active", days)
                result, queued = self._run(beat_name, churned + [renewed])
                self.assertEqual(queued, ["canceled", "cancelled", "expired"])
                self.assertEqual(result["emails_queued"], 3)
                for doc in churned:
                    doc.reference.update.assert_called_once_with({f"emailsSent.{flag}": ANY})
                renewed.reference.update.assert_not_called()

    def test_the_first_run_mails_no_backlog(self):
        # Each beat's window is one day wide, so an account that churned
        # before this change never matches it. The flag still holds a repeat.
        for beat_name, (_, flag, days) in self.BEATS.items():
            with self.subTest(beat_name):
                docs = [
                    self._churned("a-day-earlier", "canceled", days + 1),
                    self._churned("a-day-later", "canceled", days - 1),
                    self._churned("july-batch", "canceled", 80),
                    self._churned("already-sent", "canceled", days, emailsSent={flag: datetime(2026, 7, 1, tzinfo=timezone.utc)}),
                ]
                result, queued = self._run(beat_name, docs)
                self.assertEqual(queued, [])
                self.assertEqual(result["emails_queued"], 0)
                for doc in docs:
                    doc.reference.update.assert_not_called()

    def test_no_trial_nudge_skips_both_spellings_of_a_cancelled_trial(self):
        signed_up = datetime.now(timezone.utc) - timedelta(days=3, hours=12)
        docs = [
            FakeUserDoc(uid, {"subscriptionStatus": status, "createdAt": signed_up}, auth_email=f"{uid}@real.org")
            for uid, status in (("canceled", "canceled"), ("cancelled", "cancelled"), ("expired", "expired"), ("never-started", ""))
        ]
        db = SimpleNamespace(collection=lambda name: CreatedAtWindowQuery(docs))
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", _fake_auth(docs)), \
             patch.object(email_tasks.send_signup_no_trial_nudge_task, "delay") as delay:
            result = email_tasks.check_signup_no_trial_task()
        self.assertEqual([c.kwargs["user_id"] for c in delay.call_args_list], ["never-started"])
        self.assertEqual(result["emails_queued"], 1)


if __name__ == "__main__":
    unittest.main()
