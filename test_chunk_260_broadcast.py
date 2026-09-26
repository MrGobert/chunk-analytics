"""Focused checks for accidental delivery, duplicates, and read-back failures."""

import unittest
from unittest.mock import Mock, patch

from create_chunk_260_broadcast import (
    BROADCAST_NAME, DraftError, FROM_EMAIL, REPLY_TO, Resend, SEGMENT_ID, save_draft,
)


class BroadcastDraftTests(unittest.TestCase):
    def setUp(self):
        self.saved = {
            "id": "draft-1", "name": BROADCAST_NAME, "status": "draft",
            "segment_id": SEGMENT_ID, "from": FROM_EMAIL, "reply_to": [REPLY_TO],
            "subject": "subject", "html": "html", "text": "text",
            "scheduled_at": None, "sent_at": None,
        }
        self.segment = {"id": SEGMENT_ID, "name": "General"}

    def test_creation_explicitly_disables_delivery_and_verifies_readback(self):
        client = Mock()
        client.request.side_effect = [self.segment, {"data": [], "has_more": False}, {"id": "draft-1"}, self.saved]
        receipt = save_draft(client, "subject", "html", "text")
        path, method, payload = client.request.call_args_list[2].args
        self.assertEqual((path, method), ("broadcasts", "POST"))
        self.assertIs(payload["send"], False)
        self.assertNotIn("scheduled_at", payload)
        self.assertEqual(receipt["status"], "draft")
        self.assertIsNone(receipt["sent_at"])

    def test_existing_draft_on_later_page_is_updated_without_duplicate(self):
        client = Mock()
        client.request.side_effect = [
            self.segment,
            {"data": [{"id": "older", "name": "Different campaign"}], "has_more": True},
            {"data": [self.saved], "has_more": False},
            self.saved, {"id": "draft-1"}, self.saved,
        ]
        receipt = save_draft(client, "subject", "html", "text")
        self.assertEqual(receipt["action"], "updated")
        self.assertIn("after=older", client.request.call_args_list[2].args[0])
        mutations = [call.args[1] for call in client.request.call_args_list if len(call.args) > 1]
        self.assertEqual(mutations, ["PATCH"])

    def test_ambiguous_sent_scheduled_and_canceled_matches_are_not_changed(self):
        cases = [
            [self.saved, self.saved],
            [{**self.saved, "status": "sent"}],
            [{**self.saved, "status": "scheduled"}],
            [{**self.saved, "status": "canceled"}],
            [{**self.saved, "scheduled_at": "2026-09-20T10:00:00Z"}],
        ]
        for rows in cases:
            with self.subTest(rows=rows):
                client = Mock()
                client.request.side_effect = [self.segment, {"data": rows, "has_more": False}]
                with self.assertRaises(DraftError):
                    save_draft(client, "subject", "html", "text")
                self.assertTrue(all(len(call.args) == 1 for call in client.request.call_args_list))

    def test_list_failure_does_not_fall_through_to_creation(self):
        client = Mock()
        client.request.side_effect = [self.segment, DraftError("Network failure")]
        with self.assertRaises(DraftError):
            save_draft(client, "subject", "html", "text")
        self.assertEqual(client.request.call_count, 2)

    def test_concurrent_status_change_and_wrong_audience_stop_updates(self):
        for changed in ({**self.saved, "status": "scheduled"}, {**self.saved, "segment_id": "wrong"}):
            with self.subTest(changed=changed):
                client = Mock()
                client.request.side_effect = [self.segment, {"data": [self.saved]}, changed]
                with self.assertRaises(DraftError):
                    save_draft(client, "subject", "html", "text")
                self.assertTrue(all(len(call.args) == 1 for call in client.request.call_args_list))

    def test_incomplete_readback_is_not_reported_as_verified(self):
        client = Mock()
        client.request.side_effect = [self.segment, {"data": []}, {"id": "draft-1"}, {**self.saved, "html": "stale"}]
        with self.assertRaisesRegex(DraftError, "html did not match"):
            save_draft(client, "subject", "html", "text")

    def test_send_schedule_and_transactional_routes_are_rejected_before_network(self):
        client = Resend("test-key")
        with patch("urllib.request.urlopen") as network:
            for path, payload in (
                ("broadcasts/draft-1/send", {}),
                ("emails", {}),
                ("broadcasts", {"send": True}),
                ("broadcasts", {}),
                ("broadcasts", {"send": False, "scheduled_at": "tomorrow"}),
            ):
                with self.subTest(path=path, payload=payload), self.assertRaises(DraftError):
                    client.request(path, "POST", payload)
            network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
