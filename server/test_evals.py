import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evals import assertions as A
from evals import config as eval_config
from evals import runner as eval_runner
from evals.cases import (
    ALL_CASES,
    DETAILED_REPORT_HARD_FLOOR_WORDS,
    RESEARCH_SOFT_BUDGET_S,
    STANDARD_REPORT_TARGET_WORDS,
    get_case,
)
from evals.chat_client import ChatClient, ChatResult, default_chat_body
from evals.judge import JudgeSpec, judge_answer
from evals.stream_parser import ZERO_WIDTH_SPACE, parse_stream


def _chunked(text, size=7):
    """Split a stream at arbitrary byte offsets to exercise line reassembly."""
    return [text[i : i + size] for i in range(0, len(text), size)]


class TestStreamParser(unittest.TestCase):
    def test_full_production_shape(self):
        stream = (
            " \n"
            '[SOURCES][{"url": "https://example.com/a", "title": "A"}, '
            '{"url": "https://example.com/b", "title": "B"}]\n'
            '[GROUNDED]{"items": [{"object_type": "note", "object_id": "n1", "title": "My note"}]}\n'
            "Here is the answer.\n"
            "\n"
            "It has two paragraphs.\n"
            '\n[RELATED]{"items": [{"object_type": "document", "object_id": "d1"}]}\n'
            '\n[MONITOR:suggest]{"query": "track x", "cadence": "weekly", "kind": "watcher"}\n'
            '\n[QUESTIONS]["One?", "Two?"]\n'
        )
        parsed = parse_stream(_chunked(stream))
        self.assertEqual(len(parsed.sources), 2)
        self.assertEqual(len(parsed.grounded), 1)
        self.assertEqual(len(parsed.related), 1)
        self.assertEqual(parsed.questions, ["One?", "Two?"])
        self.assertEqual(parsed.monitor_suggest["kind"], "watcher")
        self.assertEqual(parsed.heartbeats, 1)
        self.assertIn("Here is the answer.", parsed.answer_text)
        self.assertIn("It has two paragraphs.", parsed.answer_text)
        self.assertNotIn("[SOURCES]", parsed.answer_text)
        self.assertEqual(parsed.leaked_sentinels, [])
        self.assertEqual(parsed.parse_errors, [])

    def test_related_used_in_answer_routes_to_grounded(self):
        stream = (
            '[RELATED]{"items": [{"object_id": "a", "used_in_answer": true}, '
            '{"object_id": "b"}]}\n'
        )
        parsed = parse_stream([stream])
        self.assertEqual(len(parsed.grounded), 1)
        self.assertEqual(len(parsed.related), 1)

    def test_image_token_lifecycle(self):
        stream = (
            "Painting your image now.\n"
            "\n\n__IMAGE_GENERATION_STARTED__\n"
            "__IMAGE_URL__https://cdn.example.com/img.png__FORMAT__png__\n"
            "\n__IMAGE_GENERATION_COMPLETE__\n"
        )
        parsed = parse_stream(_chunked(stream, 11))
        events = [e["event"] for e in parsed.image_events]
        self.assertEqual(events, ["started", "url", "complete"])
        self.assertEqual(parsed.image_url, "https://cdn.example.com/img.png")
        self.assertEqual(parsed.image_events[1]["format"], "png")

    def test_image_error_and_timeout(self):
        stream = (
            "__IMAGE_GENERATION_ERROR__something broke__\n"
            "__IMAGE_GENERATION_TIMEOUT_RETRYING__\n"
            "__IMAGE_GENERATION_TIMEOUT__\n"
        )
        parsed = parse_stream([stream])
        events = [e["event"] for e in parsed.image_events]
        self.assertEqual(events, ["error", "retrying", "timeout"])
        self.assertEqual(parsed.image_events[0]["error"], "something broke")

    def test_connector_events(self):
        stream = (
            "[CONNECTOR:notion:generating]\n"
            '[CONNECTOR:notion:sources][{"url": "https://notion.so/x"}]\n'
            '[CONNECTOR:notion:complete]{"summary": "done"}\n'
            "[CONNECTOR:gamma:subscription_required]\n"
        )
        parsed = parse_stream(_chunked(stream, 13))
        notion = parsed.connector_events_for("notion")
        self.assertEqual([e[1] for e in notion], ["generating", "sources", "complete"])
        self.assertEqual(notion[2][2], {"summary": "done"})
        gamma = parsed.connector_events_for("gamma")
        self.assertEqual([e[1] for e in gamma], ["subscription_required"])

    def test_action_suggest_and_done(self):
        stream = (
            "Answer text.\n"
            '[ACTION:suggest]{"kind": "note", "title": "Study guide"}\n'
            "[DONE]\n"
        )
        parsed = parse_stream([stream])
        self.assertEqual(parsed.action_suggest["kind"], "note")
        self.assertNotIn("[DONE]", parsed.answer_text)

    def test_malformed_sentinel_json_is_recorded_not_raised(self):
        parsed = parse_stream(['[SOURCES]{"broken": \n', "real text\n"])
        self.assertEqual(parsed.sources, [])
        self.assertEqual(len(parsed.parse_errors), 1)
        self.assertIn("real text", parsed.answer_text)

    def test_chartdata_fence_extraction(self):
        stream = (
            "Here's your chart:\n"
            "```chartdata\n"
            '{"type": "bar", "data": [1, 2, 3]}\n'
            "```\n"
            "Done.\n"
        )
        parsed = parse_stream(_chunked(stream, 9))
        self.assertEqual(len(parsed.chart_blocks), 1)
        self.assertIn('"bar"', parsed.chart_blocks[0])

    def test_neutralized_sentinel_is_not_a_leak(self):
        stream = f"The [{ZERO_WIDTH_SPACE}SOURCES] sentinel is neutralized here.\n"
        parsed = parse_stream([stream])
        self.assertEqual(parsed.leaked_sentinels, [])

    def test_indented_raw_sentinel_is_a_leak(self):
        parsed = parse_stream(['  [SOURCES][{"url": "http://x"}]\n'])
        self.assertEqual(len(parsed.leaked_sentinels), 1)

    def test_sse_data_prefix_stripped(self):
        parsed = parse_stream(['data: [QUESTIONS]["Q?"]\n'])
        self.assertEqual(parsed.questions, ["Q?"])

    def test_heartbeat_only_stream(self):
        parsed = parse_stream([" \n", " \n", " \n"])
        self.assertEqual(parsed.heartbeats, 3)
        self.assertEqual(parsed.answer_text, "")

    def test_standalone_heartbeat_between_content_lines_is_dropped(self):
        # Post line-boundary-fix wire shape: cerebral only synthesizes " \n"
        # after a chunk ending in "\n", so it always arrives as its own line —
        # even mid-chartdata-fence it must not corrupt the JSON.
        parsed = parse_stream(
            ['```chartdata\n{"type": "bar",\n', " \n", '"data": [1]}\n```\n']
        )
        self.assertEqual(parsed.heartbeats, 1)
        self.assertEqual(len(parsed.chart_blocks), 1)
        json.loads(parsed.chart_blocks[0])  # must parse cleanly

    def test_heartbeat_glued_to_open_line_is_preserved_like_web_client(self):
        # Pre-fix corruption shape (the chartdata eval failure of 2026-07-24):
        # a keepalive emitted after a chunk with NO trailing newline glues onto
        # the open line. The real web client renders exactly this corruption,
        # so the parser must preserve it — the strict chartdata assertion then
        # catching it is the point of the eval.
        parsed = parse_stream(['```chartdata\n{"category', " \n", '": "NYC"}\n```\n'])
        self.assertEqual(parsed.heartbeats, 0)
        self.assertEqual(len(parsed.chart_blocks), 1)
        self.assertIn('{"category \n"', parsed.chart_blocks[0])
        with self.assertRaises(ValueError):
            json.loads(parsed.chart_blocks[0])

    def test_whitespace_only_lines_dropped_like_web_client(self):
        # chat.ts drops ANY whitespace-only non-empty line via line.trim() —
        # including the backend's "\n \n" midline-escalation shape.
        parsed = parse_stream(["foo\n", "  \n", "bar"])
        self.assertEqual(parsed.answer_text, "foo\nbar")
        self.assertEqual(parsed.heartbeats, 1)

        parsed = parse_stream(["dangling", "\n \n", "rest\n"])
        self.assertEqual(parsed.answer_text, "dangling\nrest")
        self.assertEqual(parsed.heartbeats, 1)


def _stream_result(stream_text, **kwargs):
    parsed = parse_stream([stream_text])
    defaults = dict(kind="stream", status_code=200, parsed=parsed, ttfb_ms=800, total_ms=3000)
    defaults.update(kwargs)
    return ChatResult(**defaults)


class TestAssertions(unittest.TestCase):
    def _execution(self, stream_text, **kwargs):
        execution = A.CaseExecution()
        execution.results.append(_stream_result(stream_text, **kwargs))
        return execution

    def test_stream_ok_pass_and_error(self):
        passed, _ = A.stream_ok().evaluate(self._execution("hello\n"))
        self.assertTrue(passed)
        error_execution = A.CaseExecution()
        error_execution.results.append(
            ChatResult(kind="error", status_code=503, error_body="boom")
        )
        passed, detail = A.stream_ok().evaluate(error_execution)
        self.assertFalse(passed)
        self.assertIn("503", detail)

    def test_answer_contains(self):
        execution = self._execution("Your codename is ZEPHYR-42.\n")
        passed, _ = A.answer_contains(["zephyr"]).evaluate(execution)
        self.assertTrue(passed)
        passed, _ = A.answer_contains(["missing-token"]).evaluate(execution)
        self.assertFalse(passed)

    def test_sources_min_counts_only_valid_urls(self):
        execution = self._execution(
            '[SOURCES][{"url": "https://a.com"}, {"url": "not-a-url"}, {"title": "no url"}]\n'
        )
        passed, detail = A.sources_min(1).evaluate(execution)
        self.assertTrue(passed)
        passed, _ = A.sources_min(2).evaluate(execution)
        self.assertFalse(passed)

    def test_sources_domain_contains(self):
        execution = self._execution(
            '[SOURCES][{"url": "https://www.youtube.com/watch?v=1"}, {"url": "https://a.com"}]\n'
        )
        passed, _ = A.sources_domain_contains(["youtube.com", "youtu.be"]).evaluate(execution)
        self.assertTrue(passed)

    def test_questions_well_formed(self):
        good = self._execution('[QUESTIONS]["A?", "B?"]\n')
        self.assertTrue(A.questions_well_formed().evaluate(good)[0])
        missing = self._execution("no questions here\n")
        self.assertFalse(A.questions_well_formed().evaluate(missing)[0])

    def test_chartdata_valid(self):
        good = self._execution('```chartdata\n{"type": "bar"}\n```\n')
        self.assertTrue(A.chartdata_valid().evaluate(good)[0])
        bad = self._execution("```chartdata\nnot json\n```\n")
        self.assertFalse(A.chartdata_valid().evaluate(bad)[0])

    def test_not_rate_limited(self):
        limited = self._execution("Daily search limit reached (6). Try again tomorrow.\n")
        self.assertFalse(A.not_rate_limited().evaluate(limited)[0])
        fine = self._execution("Canberra is the capital.\n")
        self.assertTrue(A.not_rate_limited().evaluate(fine)[0])

    def test_image_delivered_from_task_result(self):
        execution = A.CaseExecution()
        execution.results.append(
            ChatResult(kind="task", status_code=202, task_json={"task_id": "t1"})
        )
        execution.image_task = {
            "state": "SUCCESS",
            "result": {"image": {"url": "https://cdn.example.com/i.png"}},
        }
        passed, _ = A.image_delivered().evaluate(execution)
        self.assertTrue(passed)
        self.assertEqual(execution.image_url, "https://cdn.example.com/i.png")

    def test_connector_terminal_ok(self):
        good = self._execution(
            '[CONNECTOR:notion:generating]\n[CONNECTOR:notion:complete]{"ok": true}\n'
        )
        self.assertTrue(A.connector_terminal_ok("notion").evaluate(good)[0])
        bad = self._execution("[CONNECTOR:notion:error]{}\n")
        self.assertFalse(A.connector_terminal_ok("notion").evaluate(bad)[0])
        paywalled = self._execution("[CONNECTOR:notion:subscription_required]\n")
        self.assertFalse(A.connector_terminal_ok("notion").evaluate(paywalled)[0])

    def test_research_assertions(self):
        execution = A.CaseExecution()
        execution.research = {"report": "x" * 600, "sources": [{"url": "https://a.com"}]}
        self.assertTrue(A.research_report_min_length(500).evaluate(execution)[0])
        self.assertTrue(A.research_sources_nonempty().evaluate(execution)[0])
        execution.research = {"state": "TIMEOUT"}
        self.assertFalse(A.research_report_min_length(500).evaluate(execution)[0])

    def test_research_succeeded_separates_failure_from_short_report(self):
        timed_out = A.CaseExecution()
        timed_out.research = {"state": "TIMEOUT", "last": {}}
        self.assertFalse(A.research_succeeded().evaluate(timed_out)[0])

        empty = A.CaseExecution()
        empty.research = {"report": "   ", "sources": []}
        passed, detail = A.research_succeeded().evaluate(empty)
        self.assertFalse(passed)
        self.assertIn("no report", detail)

        good = A.CaseExecution()
        good.research = {"report": "a real report", "sources": []}
        self.assertTrue(A.research_succeeded().evaluate(good)[0])

    def test_research_sources_min_accepts_strings_and_dicts(self):
        execution = A.CaseExecution()
        execution.research = {
            "report": "x",
            "sources": [
                "https://a.com/1",
                {"url": "https://b.com/2"},
                "not-a-url",
                {"title": "no url"},
            ],
        }
        self.assertTrue(A.research_sources_min(2).evaluate(execution)[0])
        self.assertFalse(A.research_sources_min(3).evaluate(execution)[0])

    def test_research_word_count_min(self):
        execution = A.CaseExecution()
        execution.research = {"report": " ".join(["word"] * 1900)}
        self.assertTrue(A.research_word_count_min(1800).evaluate(execution)[0])
        self.assertFalse(A.research_word_count_min(3000).evaluate(execution)[0])

    def test_research_within_budget(self):
        execution = A.CaseExecution()
        execution.research = {"report": "x"}
        execution.extra["research_elapsed_s"] = 612.4
        self.assertTrue(A.research_within_budget(900).evaluate(execution)[0])
        self.assertFalse(A.research_within_budget(600).evaluate(execution)[0])

        # A missing timing is a harness bug, not a pass.
        unmeasured = A.CaseExecution()
        unmeasured.research = {"report": "x"}
        self.assertFalse(A.research_within_budget(900).evaluate(unmeasured)[0])

    def test_research_report_type_echo(self):
        deep = A.CaseExecution()
        deep.research = {"report": "x", "report_type": "deep", "is_deep_research": True}
        self.assertTrue(A.research_report_type("deep", deep=True).evaluate(deep)[0])

        # The exact 2026-08-10 regression: "detailed_report" silently served as
        # a plain research_report.
        degraded = A.CaseExecution()
        degraded.research = {
            "report": "x",
            "report_type": "research_report",
            "is_deep_research": False,
        }
        passed, detail = A.research_report_type("detailed_report", deep=False).evaluate(degraded)
        self.assertFalse(passed)
        self.assertIn("research_report", detail)

        # Right label, but the deep pipeline never engaged.
        shallow = A.CaseExecution()
        shallow.research = {"report": "x", "report_type": "deep", "is_deep_research": False}
        self.assertFalse(A.research_report_type("deep", deep=True).evaluate(shallow)[0])

    def test_assertion_crash_is_failure_not_raise(self):
        def broken(_execution):
            raise RuntimeError("boom")

        passed, detail = A.Assertion("broken", broken).evaluate(A.CaseExecution())
        self.assertFalse(passed)
        self.assertIn("boom", detail)


class TestJudge(unittest.TestCase):
    def test_missing_api_key_degrades_to_error(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            result = judge_answer("q", "a", JudgeSpec())
        self.assertIn("error", result)

    def test_empty_answer_scores_zero_without_api_call(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            result = judge_answer("q", "   ", JudgeSpec(min_score=6))
        self.assertEqual(result["score"], 0)
        self.assertIn("empty", result["flags"])


class TestCases(unittest.TestCase):
    def test_case_ids_unique(self):
        ids = [case.id for case in ALL_CASES]
        self.assertEqual(len(ids), len(set(ids)))

    def test_expected_case_count(self):
        # 21 executed cases + 2 virtual (computed by the runner) = 23 total
        self.assertEqual(len(ALL_CASES), 21)

    def test_every_case_has_turns_and_hard_assertions(self):
        for case in ALL_CASES:
            self.assertTrue(case.turns, f"{case.id} has no turns")
            self.assertTrue(case.hard, f"{case.id} has no hard assertions")

    def test_get_case(self):
        self.assertIsNotNone(get_case("web_search"))
        self.assertIsNone(get_case("nope"))

    def test_every_selectable_research_type_has_exactly_one_case(self):
        by_type = {}
        for case in ALL_CASES:
            if case.research_type:
                by_type.setdefault(case.research_type, []).append(case.id)
        self.assertEqual(
            sorted(by_type), sorted(eval_config.SELECTABLE_RESEARCH_TYPES)
        )
        for research_type, ids in by_type.items():
            self.assertEqual(len(ids), 1, f"{research_type} covered by {ids}")

    def test_research_cases_send_their_report_type_and_outlive_the_task_budget(self):
        for case in ALL_CASES:
            if not case.research_type:
                continue
            overrides = case.turns[-1].overrides
            self.assertEqual(overrides.get("search_mode"), "RESEARCH", case.id)
            self.assertEqual(overrides.get("reportType"), case.research_type, case.id)
            self.assertEqual(case.kind, "research", case.id)
            # The full-report types can legitimately run to the edge of
            # cerebral's soft limit, so their poll has to outlive it — otherwise
            # the runner reports its own TIMEOUT instead of the real outcome.
            # The quick outline never gets near it and keeps a tighter leash.
            if case.research_type != eval_config.RESEARCH_TYPE_QUICK:
                self.assertGreaterEqual(case.timeout_s, RESEARCH_SOFT_BUDGET_S, case.id)

    def test_detailed_floor_sits_between_outline_and_standard_target(self):
        self.assertLess(DETAILED_REPORT_HARD_FLOOR_WORDS, STANDARD_REPORT_TARGET_WORDS)

    def test_default_chat_body_safety_fields(self):
        body = default_chat_body("uid123", "run1", "case1")
        self.assertEqual(body["platform"], "web")
        self.assertFalse(body["memoryEnabled"])
        self.assertEqual(body["conversation_id"], "eval-run1-case1")
        self.assertTrue(body["request_id"])


class TestResearchTypeSelection(unittest.TestCase):
    def test_normalize_defaults_and_filtering(self):
        self.assertEqual(
            eval_config.normalize_research_types(None),
            list(eval_config.DEFAULT_RESEARCH_TYPES),
        )
        # Deep is on by default; detailed is opt-in.
        self.assertIn(eval_config.RESEARCH_TYPE_DEEP, eval_config.DEFAULT_RESEARCH_TYPES)
        self.assertNotIn(
            eval_config.RESEARCH_TYPE_DETAILED, eval_config.DEFAULT_RESEARCH_TYPES
        )

        # An explicit empty selection is honoured, not replaced by defaults.
        self.assertEqual(eval_config.normalize_research_types([]), [])

        # Unknown entries are dropped, order is canonical, junk falls back.
        self.assertEqual(
            eval_config.normalize_research_types(["deep", "nope", "outline_report"]),
            ["outline_report", "deep"],
        )
        self.assertEqual(
            eval_config.normalize_research_types("deep"), ["deep"]
        )
        self.assertEqual(
            eval_config.normalize_research_types(42),
            list(eval_config.DEFAULT_RESEARCH_TYPES),
        )


class TestResearchCoverageGate(unittest.TestCase):
    """run_suite must skip research cases whose type wasn't selected."""

    def _run(self, **kwargs) -> list:
        executed: list = []

        def fake_execute(client, case, identity, run_id):
            executed.append(case.id)
            return (
                {
                    "status": "pass",
                    "assertions": [],
                    "judge": None,
                    "latency": {"ttfb_ms": 0, "total_ms": 0},
                    "response": {},
                    "attempts": 1,
                },
                A.CaseExecution(),
            )

        identity = Mock()
        identity.uid = "eval-uid"
        with patch("evals.runner.sign_in", return_value=identity), patch(
            "evals.runner.check_requirements", return_value={}
        ), patch("evals.runner.ChatClient"), patch(
            "evals.runner.execute_case", side_effect=fake_execute
        ):
            eval_runner.run_suite("test-run", dry=True, **kwargs)
        return [case_id for case_id in executed if case_id.startswith("research_")]

    def test_defaults_run_quick_and_deep_only(self):
        self.assertEqual(self._run(), ["research_quick", "research_deep"])

    def test_selection_is_honoured(self):
        self.assertEqual(
            self._run(research_types=["detailed_report"]), ["research_detailed"]
        )
        self.assertEqual(self._run(research_types=[]), [])

    def test_explicit_case_filter_bypasses_the_gate(self):
        # --case research_detailed must run it even though it is off by default.
        self.assertEqual(self._run(case_filter=["research_detailed"]), ["research_detailed"])

    def test_skipped_research_cases_are_recorded_not_dropped(self):
        writes: dict = {}

        def fake_write_case(self_writer, case_id, fields):
            writes[case_id] = fields

        with patch.object(eval_runner.RunWriter, "write_case", fake_write_case), patch(
            "evals.runner.sign_in", return_value=Mock(uid="eval-uid")
        ), patch("evals.runner.check_requirements", return_value={}), patch(
            "evals.runner.ChatClient"
        ), patch(
            "evals.runner.execute_case",
            side_effect=lambda *a, **k: (
                {
                    "status": "pass",
                    "assertions": [],
                    "judge": None,
                    "latency": {"ttfb_ms": 0, "total_ms": 0},
                    "response": {},
                    "attempts": 1,
                },
                A.CaseExecution(),
            ),
        ):
            eval_runner.run_suite("test-run", dry=True)

        skipped = writes.get("research_detailed", {})
        self.assertEqual(skipped.get("status"), "skipped")
        self.assertIn("detailed_report", skipped.get("skip_reason", ""))


class TestResearchPoll(unittest.TestCase):
    """poll_research_result must ride out transient 5xx (router errors and
    web-dyno restarts mid-deploy) and only treat cerebral's Celery-FAILURE
    body as terminal."""

    @staticmethod
    def _response(status, json_body=None, text=""):
        resp = Mock()
        resp.status_code = status
        resp.text = text
        if json_body is None:
            resp.json.side_effect = ValueError("not json")
        else:
            resp.json.return_value = json_body
        return resp

    def test_transient_5xx_keeps_polling(self):
        client = ChatClient("https://cerebral.test", identity=None)
        responses = [
            self._response(503, text="<html>upstream connect error</html>"),
            self._response(202, json_body={"state": "PROGRESS"}),
            self._response(200, json_body={"report": "done", "sources": []}),
        ]
        with patch("evals.chat_client.httpx.get", side_effect=responses), patch(
            "evals.chat_client.time.sleep"
        ):
            result = client.poll_research_result("task-1", timeout_s=60, interval_s=0)
        self.assertEqual(result.get("report"), "done")

    def test_celery_failure_body_is_terminal(self):
        client = ChatClient("https://cerebral.test", identity=None)
        body = {
            "error": "Research task failed",
            "details": "Worker exited prematurely: signal 15 (SIGTERM) Job: 96.",
        }
        with patch(
            "evals.chat_client.httpx.get",
            side_effect=[self._response(500, json_body=body, text=json.dumps(body))],
        ), patch("evals.chat_client.time.sleep"):
            result = client.poll_research_result("task-2", timeout_s=60, interval_s=0)
        self.assertEqual(result["state"], "FAILURE")
        self.assertEqual(result["status_code"], 500)


if __name__ == "__main__":
    unittest.main()
