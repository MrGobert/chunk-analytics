"""Monthly recap pipeline tests.

The stat-computation tests pin the timestamp FIELD NAME and VALUE TYPE per
collection (audited across web/native/cerebral writers, 2026-08). The fakes
compare bounds against realistically-typed stored values, so querying the
wrong field counts nothing and passing a wrong-typed bound raises TypeError —
either way the test fails if a future change breaks the contract.

Run:
    python -m pytest server/test_email_tasks.py -v
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import email_service
import email_tasks


_AUTH_GUARDS = []


def setUpModule():
    # Firebase is initialized with this machine's default credentials, so an
    # unpatched Auth lookup would reach the real project. Fail it instead;
    # tests patch email_tasks.account_email / account_emails where they need one.
    from firebase_admin import auth

    for name in ("get_user", "get_users"):
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
    # send_welcome_task is an account email too, but it raises NameError
    # (_extract_first_name) before it sends, so it can't be exercised here.
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
        for email_type in ("trial_ending", "renewal_reminder", "billing_issue", "subscription_expired", "welcome"):
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


if __name__ == "__main__":
    unittest.main()
