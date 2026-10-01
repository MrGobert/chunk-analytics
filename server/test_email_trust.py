"""Campaign email never trusts what a client can write.

firestore.rules lets the signed-in owner write their own users/{uid} doc, so:
- every recipient is the account's Firebase Auth address, looked up by uid
  (account_email.py), never users/{uid}.email;
- every user-supplied value is escaped before it lands in email HTML, and
  subjects stay on one line.

Run:
    python -m pytest server/test_email_trust.py -v
"""

import inspect
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from firebase_admin import auth  # noqa: E402

import account_email  # noqa: E402
import email_service  # noqa: E402
import email_tasks  # noqa: E402

HOSTILE = '<img src=x onerror="alert(1)">&'
ESCAPED = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;"
AUTH_ADDRESS = "ada@example.org"
DOC_ADDRESS = "victim@example.net"  # what a client wrote into users/{uid}.email

_AUTH_GUARDS = []


def setUpModule():
    # Firebase is initialized with this machine's default credentials, so an
    # unpatched Auth lookup would reach the real project. Fail it instead.
    for name in ("get_user", "get_users"):
        patcher = patch.object(auth, name, side_effect=AssertionError(f"real Firebase Auth {name} call"))
        patcher.start()
        _AUTH_GUARDS.append(patcher)


def tearDownModule():
    while _AUTH_GUARDS:
        _AUTH_GUARDS.pop().stop()


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

# One value per template parameter. A template taking a parameter that isn't
# here fails the tests below until someone decides what a hostile value is.
_ARGS = {
    "user_name": HOSTILE,
    "feature_name": HOSTILE,
    "feature_description": HOSTILE,
    "feature_emoji": HOSTILE,
    "amount": HOSTILE,  # carries users/{uid}.subscriptionCurrency
    "hours_remaining": 12,
    "days_until_renewal": 7,
    # Recap counts are ints by the time they reach the template:
    # _compute_recap_stats casts every Firestore value.
    "searches": 3, "documents": 3, "images": 3, "notes": 3,
    "collections": 3, "captures": 3, "automations": 3, "artifacts": 3,
}
TEMPLATES = sorted(
    name for name, fn in inspect.getmembers(email_service, inspect.isfunction)
    if name.startswith("get_") and name.endswith("_email")
)


def _render(name, **overrides):
    fn = getattr(email_service, name)
    params = inspect.signature(fn).parameters
    missing = [p for p in params if p not in _ARGS]
    assert not missing, f"{name} takes {missing}: add a hostile value to _ARGS"
    return fn(**{**{p: _ARGS[p] for p in params}, **overrides})


def _takes(name, param):
    return param in inspect.signature(getattr(email_service, name)).parameters


class TemplateEscapingTests(unittest.TestCase):
    def test_the_template_list_is_not_empty(self):
        self.assertGreaterEqual(len(TEMPLATES), 15)

    def test_every_template_escapes_what_users_supply(self):
        for name in TEMPLATES:
            with self.subTest(template=name):
                subject, html, _ = _render(name)
                self.assertNotIn('<img src=x onerror="alert(1)">', html)
                self.assertNotIn("\n", subject)
                self.assertNotIn("\r", subject)

    def test_a_display_name_is_shown_escaped(self):
        for name in [n for n in TEMPLATES if _takes(n, "user_name")]:
            with self.subTest(template=name):
                _, html, _ = _render(name)
                self.assertIn(f"Hey {ESCAPED},", html)

    def test_a_feature_announcement_escapes_its_copy(self):
        _, html, _ = _render("get_feature_announcement_email")
        # the name, the card's emoji, title and description, the preheader
        # and the hero title, besides the greeting
        self.assertGreaterEqual(html.count(ESCAPED), 7)

    def test_a_feature_name_cannot_break_the_subject_line(self):
        subject, *_ = _render(
            "get_feature_announcement_email",
            feature_emoji="✨", feature_name="Price watch\r\nBcc: someone@example.com",
        )
        self.assertEqual(subject, "✨ New in Chunk: Price watch Bcc: someone@example.com")

    def test_the_renewal_amount_is_escaped(self):
        _, html, _ = _render("get_renewal_reminder_email")
        self.assertIn(f">{ESCAPED}</p>", html)  # the amount card
        self.assertIn(f"({ESCAPED}) renews", html)  # the preheader

    def test_ordinary_values_render_unchanged(self):
        _, html, _ = email_service.get_renewal_reminder_email("Ada Lovelace", 7, "249,000 VND")
        self.assertIn("Hey Ada Lovelace,", html)
        self.assertIn(">249,000 VND</p>", html)
        _, html, _ = email_service.get_welcome_email("there")
        self.assertIn('href="https://chunkapp.com/chat?source=welcome_email"', html)


# ---------------------------------------------------------------------------
# Send tasks: the address comes from Firebase Auth at send time
# ---------------------------------------------------------------------------

# send task -> (email_service sender it calls, extra positional args after the name)
SEND_TASKS = {
    "send_trial_ending_task": ("send_trial_ending", (12,)),
    "send_winback_7day_task": ("send_winback_7day", ()),
    "send_winback_30day_task": ("send_winback_30day", ()),
    "send_subscription_expired_task": ("send_subscription_expired", ()),
    "send_day1_help_center_task": ("send_day1_help_center", ()),
    "send_day3_artifacts_task": ("send_day3_artifacts", ()),
    "send_day7_researcher_stories_task": ("send_day7_researcher_stories", ()),
    "send_billing_issue_task": ("send_billing_issue", ()),
    "send_reengagement_14day_task": ("send_reengagement_14day", ()),
    "send_feature_announcement_task": ("send_feature_announcement", ("Feature", "What it does", "✨")),
    "send_signup_no_trial_nudge_task": ("send_signup_no_trial_nudge", ()),
    "send_renewal_reminder_task": ("send_renewal_reminder", (7, "$9.99")),
}
# Covered separately: the recap computes stats first, and send_welcome_task
# raises NameError (_extract_first_name) after the lookup, before it sends.
OTHER_SEND_TASKS = {"send_monthly_recap_task", "send_welcome_task"}


class SendTaskRecipientTests(unittest.TestCase):
    def _send(self, task_name, auth_address=AUTH_ADDRESS, user_id="uid1"):
        sender, extra = SEND_TASKS[task_name]
        with patch.object(email_tasks, "account_email", return_value=auth_address) as lookup, \
             patch.object(email_tasks, "marketing_blocked", return_value=None) as gate, \
             patch.object(email_tasks.email_service, sender, return_value={"id": "e1"}) as send, \
             patch.object(email_tasks, "track_email_sent") as track:
            # Called the way messages queued before this change are: with the
            # users/{uid}.email the beat read first.
            result = getattr(email_tasks, task_name)(DOC_ADDRESS, "Ada", *extra, user_id=user_id)
        return result, lookup, gate, send, track

    def test_every_send_task_is_covered(self):
        tasks = {n for n in dir(email_tasks) if n.startswith("send_") and n.endswith("_task")}
        self.assertEqual(tasks, set(SEND_TASKS) | OTHER_SEND_TASKS)

    def test_every_send_goes_to_the_auth_address_not_the_one_it_was_handed(self):
        for task_name in SEND_TASKS:
            with self.subTest(task=task_name):
                result, lookup, gate, send, track = self._send(task_name)
                lookup.assert_called_once_with("uid1")
                self.assertEqual(send.call_args[0][0], AUTH_ADDRESS)
                self.assertNotIn(DOC_ADDRESS, repr(send.call_args))
                track.assert_called_once_with("uid1", AUTH_ADDRESS, ANY, "e1")
                if gate.called:  # marketing checks consent for the address it mails
                    gate.assert_called_once_with("uid1", AUTH_ADDRESS)
                self.assertEqual(result["status"], "sent")

    def test_without_a_uid_nothing_is_sent(self):
        for task_name in SEND_TASKS:
            with self.subTest(task=task_name):
                result, lookup, _, send, _ = self._send(task_name, user_id=None)
                self.assertEqual(result["reason"], "no_user_id")
                lookup.assert_not_called()
                send.assert_not_called()

    def test_an_account_without_an_auth_address_gets_nothing(self):
        for task_name in SEND_TASKS:
            with self.subTest(task=task_name):
                result, _, _, send, _ = self._send(task_name, auth_address=None)
                self.assertEqual(result["reason"], "no_account_email")
                send.assert_not_called()

    def test_test_domains_and_malformed_auth_addresses_get_nothing(self):
        for address in ("qa@example.com", "qa@staging.test.com", "not-an-address"):
            with self.subTest(address=address):
                result, _, _, send, _ = self._send("send_billing_issue_task", auth_address=address)
                self.assertEqual(result["reason"], "invalid_email")
                send.assert_not_called()

    def test_a_failed_lookup_raises_so_autoretry_tries_again(self):
        with patch.object(email_tasks, "account_email", side_effect=RuntimeError("auth unavailable")), \
             patch.object(email_tasks.email_service, "send_billing_issue") as send:
            with self.assertRaises(RuntimeError):
                email_tasks.send_billing_issue_task.run(DOC_ADDRESS, "Ada", user_id="uid1")
        send.assert_not_called()

    def test_the_monthly_recap_goes_to_the_auth_address(self):
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=object())}), \
             patch.object(email_tasks, "account_email", return_value=AUTH_ADDRESS), \
             patch.object(email_tasks, "marketing_blocked", return_value=None) as gate, \
             patch.object(email_tasks, "_compute_recap_stats", return_value={"searches": 5}), \
             patch.object(email_tasks.email_service, "send_monthly_recap", return_value={"id": "e1"}) as send, \
             patch.object(email_tasks, "track_email_sent"):
            result = email_tasks.send_monthly_recap_task(DOC_ADDRESS, "Ada", user_id="uid1")
        self.assertEqual(result["status"], "sent")
        self.assertEqual(send.call_args[0][0], AUTH_ADDRESS)
        gate.assert_called_once_with("uid1", AUTH_ADDRESS)

    def test_a_hostile_profile_reaches_only_its_own_inbox_escaped(self):
        sent = {}

        def post(url, **kwargs):
            sent.update(kwargs["json"])
            return MagicMock(status_code=200, json=lambda: {"id": "e1"})

        with patch.object(email_tasks, "account_email", return_value=AUTH_ADDRESS), \
             patch.object(email_tasks, "marketing_blocked", return_value=None), \
             patch.object(email_tasks, "track_email_sent"), \
             patch.object(email_service.httpx, "post", side_effect=post):
            email_tasks.send_day1_help_center_task(DOC_ADDRESS, HOSTILE, user_id="uid1")

        self.assertEqual(sent["to"], [AUTH_ADDRESS])
        self.assertIn(f"Hey {ESCAPED},", sent["html"])
        self.assertNotIn(HOSTILE, sent["html"])


# ---------------------------------------------------------------------------
# Beat tasks: one batched Auth lookup, and no address on the queued message
# ---------------------------------------------------------------------------

NOW = datetime.now(timezone.utc)

# beat task -> (send task it queues, emailsSent flag it sets, doc fields its own checks need)
BEATS = {
    "check_trials_ending_soon_task": ("send_trial_ending_task", "trialEnding", {"trialEndDate": NOW + timedelta(hours=6)}),
    "check_churned_users_7day_task": ("send_winback_7day_task", "winback7Day", {}),
    "check_churned_users_30day_task": ("send_winback_30day_task", "winback30Day", {}),
    "check_welcome_instant_task": ("send_welcome_task", "welcome", {}),
    "check_welcome_sequence_day1_task": ("send_day1_help_center_task", "welcomeDay1", {}),
    "check_welcome_sequence_day3_task": ("send_day3_artifacts_task", "welcomeDay3", {}),
    "check_welcome_sequence_day7_task": ("send_day7_researcher_stories_task", "welcomeDay7", {}),
    "check_monthly_recap_task": ("send_monthly_recap_task", "monthlyRecap", {}),
    "check_renewal_reminders_task": ("send_renewal_reminder_task", "renewalReminder", {}),
    "check_reengagement_14day_task": ("send_reengagement_14day_task", "reengagement14Day", {}),
    "check_signup_no_trial_task": ("send_signup_no_trial_nudge_task", "signupNoTrialNudge", {}),
}


class FakeDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.reference = MagicMock()

    def to_dict(self):
        return dict(self._data)


class AnyQuery:
    """Stands in for the beat's Firestore query: the docs already match it."""

    def __init__(self, docs):
        self._docs = docs

    def where(self, *_args):
        return self

    def order_by(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def start_after(self, *_args):
        return AnyQuery([])

    def stream(self):
        return iter(list(self._docs))


class BeatRecipientTests(unittest.TestCase):
    def _run_beat(self, beat_name, docs, auth_addresses):
        send_task_name = BEATS[beat_name][0]
        db = SimpleNamespace(collection=lambda name: AnyQuery(docs) if name == "users" else None)
        lookups = []

        def account_emails(uids):
            uids = list(uids)
            lookups.append(uids)
            return {uid: auth_addresses[uid] for uid in uids if uid in auth_addresses}

        send_task = getattr(email_tasks, send_task_name)
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", side_effect=account_emails), \
             patch.object(email_tasks, "account_email", side_effect=AssertionError("per-user lookup in a beat")), \
             patch.object(send_task, "delay") as delay, \
             patch.object(send_task, "apply_async") as apply_async:
            result = getattr(email_tasks, beat_name)()
        queued = [c.kwargs for c in delay.call_args_list]
        queued += [c.kwargs["kwargs"] for c in apply_async.call_args_list]
        positional = [c.args for c in delay.call_args_list] + [c.kwargs.get("args") for c in apply_async.call_args_list]
        return result, lookups, queued, positional

    def test_every_beat_is_covered(self):
        beats = {n for n in dir(email_tasks) if n.startswith("check_") and n.endswith("_task")}
        self.assertEqual(beats, set(BEATS))

    def test_each_beat_mails_the_auth_address_and_skips_accounts_without_one(self):
        for beat_name, (_, flag, fields) in BEATS.items():
            with self.subTest(beat=beat_name):
                mailed = FakeDoc("uid-ok", {"email": DOC_ADDRESS, "displayName": "  Ada \n Lovelace ", **fields})
                no_auth = FakeDoc("uid-gone", {"email": "someone@example.org", "displayName": "Bo", **fields})
                result, lookups, queued, positional = self._run_beat(
                    beat_name, [mailed, no_auth], {"uid-ok": AUTH_ADDRESS},
                )
                # one batched lookup for the run's users
                self.assertEqual(lookups, [["uid-ok", "uid-gone"]])
                # the message names the account; the send task looks the address up
                self.assertEqual(len(queued), 1)
                self.assertEqual(queued[0]["user_id"], "uid-ok")
                self.assertEqual(queued[0]["user_name"], "Ada Lovelace")
                self.assertTrue(all(not args for args in positional))
                self.assertNotIn(DOC_ADDRESS, repr(queued))
                # dedupe flags as before: set for the queued account only
                mailed.reference.update.assert_called_once_with({f"emailsSent.{flag}": ANY})
                no_auth.reference.update.assert_not_called()
                self.assertEqual(result["emails_queued"], 1)

    def test_a_beat_skips_test_domains_by_their_auth_address(self):
        doc = FakeDoc("uid-qa", {"email": "real-person@example.org"})
        result, _, queued, _ = self._run_beat("check_welcome_sequence_day1_task", [doc], {"uid-qa": "qa@example.com"})
        self.assertEqual(queued, [])
        doc.reference.update.assert_not_called()

    def test_the_recap_dry_run_lists_auth_addresses(self):
        doc = FakeDoc("uid-ok", {"email": DOC_ADDRESS})
        db = SimpleNamespace(collection=lambda name: AnyQuery([doc]))
        with patch.dict(sys.modules, {"firebase_setup": SimpleNamespace(db=db)}), \
             patch.object(email_tasks, "account_emails", return_value={"uid-ok": AUTH_ADDRESS}):
            result = email_tasks.check_monthly_recap_task(dry_run=True)
        self.assertEqual(result["candidates"], [{"uid": "uid-ok", "email": AUTH_ADDRESS}])

    def test_nothing_reads_an_address_off_the_user_doc(self):
        # A tripwire for new senders: the address is account_email's job.
        source = Path(email_tasks.__file__).read_text()
        self.assertIsNone(re.search(r"""\.get\(\s*["']email["']""", source))


class DisplayNameTests(unittest.TestCase):
    def test_blank_or_non_text_names_fall_back_to_there(self):
        for data in ({}, {"displayName": None}, {"displayName": "  "}, {"displayName": 42}):
            with self.subTest(data=data):
                self.assertEqual(email_tasks._display_name(data), "there")

    def test_name_is_the_fallback_and_whitespace_collapses(self):
        self.assertEqual(email_tasks._display_name({"displayName": "", "name": "Ada"}), "Ada")
        self.assertEqual(email_tasks._display_name({"displayName": "Ada\r\n  Lovelace"}), "Ada Lovelace")


# ---------------------------------------------------------------------------
# account_email.py
# ---------------------------------------------------------------------------


class AccountEmailTests(unittest.TestCase):
    def test_the_auth_email(self):
        with patch.object(auth, "get_user", return_value=SimpleNamespace(email=AUTH_ADDRESS)) as get_user:
            self.assertEqual(account_email.account_email("uid1"), AUTH_ADDRESS)
        get_user.assert_called_once_with("uid1")

    def test_no_account_or_no_email_is_none(self):
        with patch.object(auth, "get_user", side_effect=auth.UserNotFoundError("no such user")):
            self.assertIsNone(account_email.account_email("uid1"))
        with patch.object(auth, "get_user", return_value=SimpleNamespace(email=None)):
            self.assertIsNone(account_email.account_email("uid1"))

    def test_a_failed_lookup_raises(self):
        # "couldn't check" must not read as "no address"
        with patch.object(auth, "get_user", side_effect=RuntimeError("503")):
            with self.assertRaises(RuntimeError):
                account_email.account_email("uid1")

    def test_a_value_that_cannot_be_a_uid_is_not_looked_up(self):
        with patch.object(auth, "get_user") as get_user:
            for uid in (None, "", "x" * 129, 42):
                self.assertIsNone(account_email.account_email(uid))
        get_user.assert_not_called()

    def test_batches_hold_at_most_100_uids(self):
        calls = []

        def get_users(identifiers):
            calls.append([i.uid for i in identifiers])
            return SimpleNamespace(users=[
                SimpleNamespace(uid=i.uid, email=None if i.uid == "uid007" else f"{i.uid}@example.org")
                for i in identifiers
            ])

        uids = [f"uid{i:03d}" for i in range(250)]
        with patch.object(auth, "get_users", side_effect=get_users):
            found = account_email.account_emails(iter(uids + ["uid001", "", None, "x" * 129]))

        self.assertEqual([len(batch) for batch in calls], [100, 100, 50])
        self.assertEqual(len(found), 249)  # uid007 has no email
        self.assertEqual(found["uid001"], "uid001@example.org")
        self.assertNotIn("uid007", found)

    def test_no_uids_no_call(self):
        with patch.object(auth, "get_users") as get_users:
            self.assertEqual(account_email.account_emails([]), {})
        get_users.assert_not_called()


if __name__ == "__main__":
    unittest.main()
