"""The upload eval must wait for retrieval readiness, not just extracted text."""

import unittest
from unittest.mock import Mock, patch

import httpx

from evals import documents, runner
from evals.assertions import CaseExecution
from evals.cases import get_case
from evals.chat_client import ChatResult
from evals.stream_parser import parse_stream


class Clock:
    now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, duration):
        self.now += duration


def snapshot(**task):
    result = Mock(exists=True)
    result.to_dict.return_value = task
    return result


def ready(indexed):
    return httpx.Response(200, json={"document_id": "d1", "indexed": indexed})


class TestWaitForDocumentIndex(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.identity = Mock(uid="u1")
        self.identity.token.return_value = "eval-token"
        self.db = Mock()
        self.get = self.db.collection.return_value.document.return_value.get
        self.get.return_value = snapshot(status="completed")
        for target, value in [
            ("_db", Mock(return_value=self.db)),
            ("time", self.clock),
        ]:
            patcher = patch.object(documents, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(documents.httpx, "post")
        self.post = patcher.start()
        self.addCleanup(patcher.stop)

    def wait(self, timeout=20):
        return documents.wait_for_indexing(self.identity, "d1", timeout_s=timeout)

    def test_extraction_completion_waits_for_actual_stored_chunks(self):
        self.get.side_effect = [
            snapshot(status="processing"),
            snapshot(status="completed"),
            snapshot(status="completed"),
        ]
        self.post.side_effect = [ready(False), ready(True)]
        result = self.wait()
        self.assertEqual(result["status"], "completed")
        self.assertTrue(result["indexed"])
        self.assertEqual(result["stage"], "indexing")
        self.assertEqual(result["waited_s"], 10)
        self.assertEqual(self.post.call_count, 2)
        call = self.post.call_args
        self.assertTrue(call.args[0].endswith("/get-document-index-status"))
        self.assertEqual(call.kwargs["json"], {"document_id": "d1"})
        self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer eval-token")

    def test_failed_and_legacy_error_stop_without_chat_readiness_probe(self):
        for status in ["failed", "error"]:
            with self.subTest(status=status):
                self.get.side_effect = None
                self.get.return_value = snapshot(
                    status=status, error_code="corrupt_document"
                )
                result = self.wait()
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["error_code"], "corrupt_document")
                self.assertEqual(result["stage"], "extraction")
        self.post.assert_not_called()

    def test_indexing_failure_is_separate_from_completed_extraction(self):
        self.get.return_value = snapshot(
            status="completed",
            indexing_errors={
                "batch-1": None,
                "batch-2": {"error_code": "embedding_failed"},
            },
        )
        result = self.wait()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "embedding_failed")
        self.assertEqual(result["extraction_status"], "completed")
        self.assertEqual(result["stage"], "indexing")
        self.post.assert_not_called()

    def test_cleared_indexing_error_does_not_block_readiness(self):
        self.get.return_value = snapshot(
            status="completed", indexing_errors={"batch-1": None}
        )
        self.post.return_value = ready(True)
        self.assertEqual(self.wait()["status"], "completed")

    def test_transient_poll_outages_recover_within_same_deadline(self):
        self.get.side_effect = [
            TimeoutError("Firestore unavailable"),
            snapshot(status="completed"),
            snapshot(status="completed"),
        ]
        self.post.side_effect = [httpx.Response(503), ready(True)]
        result = self.wait()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["waited_s"], 10)

    def test_http_transport_outage_times_out_with_evidence(self):
        self.post.side_effect = httpx.ReadTimeout("Qdrant status unavailable")
        result = self.wait(timeout=12)
        self.assertEqual(result["status"], "timeout")
        self.assertEqual(result["waited_s"], 12)
        self.assertFalse(result["indexed"])
        self.assertIn("ReadTimeout", result["error"])
        self.assertEqual(result["document_id"], "d1")
        self.assertEqual(self.post.call_args.kwargs["timeout"], 2)

    def test_indexing_never_appears_times_out(self):
        self.post.return_value = ready(False)
        result = self.wait(timeout=12)
        self.assertEqual(result["status"], "timeout")
        self.assertEqual(result["stage"], "indexing")
        self.assertEqual(result["last"], "completed")

    def test_extraction_time_shares_indexing_deadline(self):
        self.get.side_effect = [
            snapshot(status="processing"),
            snapshot(status="processing"),
            snapshot(status="completed"),
        ]
        self.post.return_value = ready(False)
        result = self.wait(timeout=12)
        self.assertEqual(result["waited_s"], 12)
        self.post.assert_called_once()

    def test_refreshes_expired_auth(self):
        self.post.side_effect = [httpx.Response(401), ready(True)]
        self.assertEqual(self.wait()["status"], "completed")
        self.identity.force_refresh.assert_called_once()

    def test_backend_without_readiness_endpoint_fails_visibly(self):
        self.post.return_value = httpx.Response(404)
        result = self.wait()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "readiness_http_404")

    def test_malformed_or_wrong_document_response_cannot_pass(self):
        for payload in [
            {"document_id": "other", "indexed": True},
            {"document_id": "d1", "indexed": "true"},
        ]:
            self.post.return_value = httpx.Response(200, json=payload)
            self.assertEqual(self.wait()["error_code"], "invalid_readiness_response")


class TestUploadReadinessWiring(unittest.TestCase):
    def test_chat_runs_after_readiness_and_keeps_expected_token_out_of_question(self):
        identity = Mock(uid="u1")
        events = []
        client = Mock()

        def chat(body, **kwargs):
            events.append("chat")
            self.assertEqual(events, ["indexed", "chat"])
            self.assertEqual(body["search_mode"], "DOCUMENTS ONLY")
            self.assertEqual(body["context"], "")
            self.assertEqual(body["document_ids"], [])
            self.assertNotIn("KESTREL", body["user_input"])
            return ChatResult(
                kind="stream",
                status_code=200,
                parsed=parse_stream(["KESTREL-SECRET00"]),
            )

        client.chat.side_effect = chat

        def indexed(*args, **kwargs):
            self.assertEqual(args, (identity, "d1"))
            events.append("indexed")
            return {
                "status": "completed",
                "indexed": True,
                "document_id": "d1",
                "stage": "indexing",
                "waited_s": 10,
            }

        with patch.object(
            documents,
            "upload_document",
            return_value={"document_id": "d1", "storage_path": "fixture"},
        ), patch.object(
            documents, "wait_for_indexing", side_effect=indexed
        ), patch.object(
            documents,
            "delete_document",
            return_value={"qdrant": True, "storage": True, "firestore": True},
        ) as cleanup, patch.object(
            runner.secrets, "token_hex", side_effect=["nonce1", "secret00"]
        ):
            case = get_case("document_upload_search")
            execution = runner._execute_once(client, case, identity, "run")
            self.assertEqual(runner._evaluate(case, execution)["status"], "pass")
            cleanup.assert_called_once_with(identity, "d1", "fixture")

    def test_no_chat_before_readiness_and_cleanup_still_runs(self):
        for status in ["failed", "timeout"]:
            client = Mock()
            with patch.object(
                documents, "upload_document", return_value={"document_id": "d1"}
            ), patch.object(
                documents,
                "wait_for_indexing",
                return_value={"status": status, "indexed": False},
            ), patch.object(
                documents, "delete_document", return_value={}
            ) as cleanup:
                runner._execute_once(
                    client, get_case("document_upload_search"), Mock(), "run"
                )
                client.chat.assert_not_called()
                cleanup.assert_called_once()

    def test_assertion_requires_verified_index_evidence(self):
        assertion = get_case("document_upload_search").hard[0]
        execution = CaseExecution()
        execution.extra["indexing"] = {"status": "completed"}
        self.assertFalse(assertion.evaluate(execution)[0])


if __name__ == "__main__":
    unittest.main()
