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
             patch.object(email_tasks, "check_unsubscribed", return_value=False), \
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
        with patch.object(email_tasks, "check_unsubscribed", return_value=False):
            result = email_tasks.send_monthly_recap_task("james@example.org", "James")
        self.assertEqual(result["reason"], "no_user_id")


# ---------------------------------------------------------------------------
# check_monthly_recap_task — pagination, dedupe, cooldown, dry run
# ---------------------------------------------------------------------------


class FakeUserDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
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
    data = {"subscriptionStatus": "active", "email": email, "displayName": "U"}
    data.update(extra)
    return FakeUserDoc(doc_id, data)


class CheckTaskTests(unittest.TestCase):
    def _run_beat(self, docs, page_size=2, dry_run=False):
        db = FakeBeatDB(docs)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
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
        # user_id travels as a kwarg, stats do not travel at all
        _, kwargs = dispatch.call_args
        self.assertEqual(set(kwargs["kwargs"]), {"user_id"})

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
        self.assertEqual(dispatch.call_args[1]["args"][0], "c@real.org")

    def test_dry_run_dispatches_and_marks_nothing(self):
        docs = [_active_user("uid1", "a@real.org")]
        result, dispatch = self._run_beat(docs, dry_run=True)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(result["candidates"], [{"uid": "uid1", "email": "a@real.org"}])
        dispatch.assert_not_called()
        docs[0].reference.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
