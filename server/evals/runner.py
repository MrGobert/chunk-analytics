"""
Eval suite runner.

Executes cases sequentially (predictable rate-limit usage against production),
persists per-case results to Firestore as they finish, computes cross-case
virtual cases (sentinel_leakage, latency_budget), and writes the run summary.

CLI (for debugging without Celery):
    python -m evals.runner --case assistant_basic --dry
    python -m evals.runner            # full suite, persists a run with trigger=cli
"""

import argparse
import json
import logging
import secrets
import sys
import time
import uuid
from datetime import datetime, timezone
from statistics import median

import httpx

from evals import config, documents
from evals.assertions import CaseExecution
from evals.auth import EvalIdentity, sign_in
from evals.cases import ALL_CASES, SEED_DOC_NAME, EvalCase, get_case
from evals.chat_client import ChatClient, ChatResult, default_chat_body
from evals.judge import judge_answer

ANSWER_SNIPPET_CHARS = 1500
LATENCY_TTFB_BUDGET_MS = 15_000


def _db():
    from firebase_setup import db

    return db


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- requirements ----


def check_requirements(identity: EvalIdentity) -> dict:
    """Resolve which optional prerequisites are available for this run."""
    met = {}

    try:
        docs = list(
            _db()
            .collection("document_metadata")
            .document(identity.uid)
            .collection("files_metadata")
            .where("originalFileName", "==", SEED_DOC_NAME)
            .limit(1)
            .stream()
        )
        met["seeded_docs"] = bool(docs)
    except Exception as exc:
        logging.warning(f"[EVALS] seeded_docs check failed: {exc}")
        met["seeded_docs"] = False

    try:
        response = httpx.get(
            f"{config.target_url()}/api/connectors/user",
            headers={"Authorization": f"Bearer {identity.token()}"},
            timeout=15.0,
        )
        connected = []
        if response.status_code == 200:
            payload = response.json()
            items = payload.get("connectors", payload) if isinstance(payload, dict) else payload
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        connected.append(item.get("id") or item.get("connector_id"))
                    elif isinstance(item, str):
                        connected.append(item)
        met["notion"] = "notion" in connected
    except Exception as exc:
        logging.warning(f"[EVALS] notion connection check failed: {exc}")
        met["notion"] = False

    return met


# ---- case execution ----


def _build_body(
    case: EvalCase,
    turn_index: int,
    identity: EvalIdentity | None,
    run_id: str,
    history: list,
    user_input_override: str | None = None,
) -> dict:
    turn = case.turns[turn_index]
    uid = identity.uid if identity else "guest-user"
    body = default_chat_body(uid, run_id, case.id)
    if case.kind == "guest":
        body["isSubscribed"] = False
        body["model_name"] = "gpt-5.4-mini"
    body.update(turn.overrides)
    body["user_input"] = user_input_override or turn.user_input
    body["previous_messages"] = history
    body["peak_message_count"] = len(history)
    body["request_id"] = str(uuid.uuid4())  # fresh per attempt
    return body


def _run_turns(
    client: ChatClient,
    case: EvalCase,
    identity: EvalIdentity | None,
    run_id: str,
    execution: CaseExecution,
    user_input_override: str | None = None,
) -> None:
    history: list = []
    for index in range(len(case.turns)):
        body = _build_body(case, index, identity, run_id, list(history), user_input_override)
        result = client.chat(body, timeout_s=case.timeout_s)
        execution.results.append(result)
        answer = result.parsed.answer_text.strip() if result.parsed else ""
        history.append({"sender": "User", "message": body["user_input"]})
        history.append({"sender": "AI", "message": answer})
        if result.kind != "stream":
            break  # task/error responses end the turn loop


def _execute_once(
    client: ChatClient,
    case: EvalCase,
    identity: EvalIdentity | None,
    run_id: str,
) -> CaseExecution:
    execution = CaseExecution()

    if case.kind == "document_upload":
        nonce = secrets.token_hex(3).upper()
        token = f"KESTREL-{secrets.token_hex(4).upper()}"
        execution.extra["expected_token"] = token
        content = (
            f"Eval Upload Fixture — Operation {nonce}\n\n"
            f"This temporary document verifies the upload/indexing pipeline.\n"
            f"The vault code for Operation {nonce} is {token}.\n"
        )
        question = (
            f"Search my documents: what is the vault code for Operation {nonce}? "
            f"Reply with the exact code."
        )
        upload = None
        try:
            upload = documents.upload_document(
                identity, f"eval-upload-{run_id}.txt", content
            )
            execution.extra["upload"] = upload
            execution.extra["indexing"] = documents.wait_for_indexing(
                upload["document_id"], timeout_s=240
            )
            if execution.extra["indexing"].get("status") == "completed":
                _run_turns(client, case, identity, run_id, execution, question)
        except Exception as exc:
            execution.extra["upload_error"] = str(exc)
            logging.warning(f"[EVALS] document upload failed: {exc}")
        finally:
            if upload:
                try:
                    execution.extra["cleanup"] = documents.delete_document(
                        identity, upload["document_id"], upload.get("storage_path", "")
                    )
                except Exception as exc:
                    execution.extra["cleanup"] = {"error": str(exc)}
        return execution

    _run_turns(client, case, identity, run_id, execution)
    result = execution.results[-1] if execution.results else None

    if case.kind == "image" and result and result.kind == "task":
        task_id = (result.task_json or {}).get("task_id", "")
        if task_id:
            execution.image_task = client.poll_task_status(task_id, timeout_s=case.timeout_s)

    if case.kind == "research":
        if result and result.kind == "task":
            task_id = (result.task_json or {}).get("task_id", "")
            if task_id:
                execution.research = client.poll_research_result(
                    task_id, timeout_s=case.timeout_s
                )
            else:
                execution.research = {"state": "FAILURE", "error": "202 without task_id"}
        else:
            # Research must come back as an async task; a plain stream means the
            # backend downgraded the mode (e.g. subscription not recognized).
            execution.research = {
                "state": "FAILURE",
                "error": f"expected 202 task, got {result.kind if result else 'nothing'}",
            }

    return execution


def _evaluate(case: EvalCase, execution: CaseExecution) -> dict:
    """Run assertions + judge over an execution. Returns the case-doc fields."""
    assertion_rows = []
    hard_failed = False
    soft_failed = False

    for severity, assertion_list in (("hard", case.hard), ("soft", case.soft)):
        for assertion in assertion_list:
            passed, detail = assertion.evaluate(execution)
            assertion_rows.append(
                {"name": assertion.name, "severity": severity, "passed": passed, "detail": detail}
            )
            if not passed:
                if severity == "hard":
                    hard_failed = True
                else:
                    soft_failed = True

    judge_result = None
    if case.judge is not None:
        question = case.turns[-1].user_input
        if case.kind == "research":
            answer = str((execution.research or {}).get("report", ""))
        else:
            answer = execution.answer
        judge_result = judge_answer(question, answer, case.judge)
        if "error" in judge_result:
            soft_failed = True
        elif judge_result["score"] < case.judge.min_score:
            soft_failed = True

    status = "fail" if hard_failed else ("warn" if soft_failed else "pass")

    result = execution.result
    response_summary = {}
    if result is not None:
        parsed = result.parsed
        response_summary = {
            "answer_snippet": execution.answer[:ANSWER_SNIPPET_CHARS],
            "sources_count": len(parsed.sources) if parsed else 0,
            "questions": parsed.questions if parsed else None,
            "reasoning_effort": result.reasoning_effort,
            "sentinel_summary": {
                "grounded": len(parsed.grounded) if parsed else 0,
                "related": len(parsed.related) if parsed else 0,
                "connector_events": [e[1] for e in parsed.connector_events] if parsed else [],
                "image_events": [e.get("event") for e in parsed.image_events] if parsed else [],
                "heartbeats": parsed.heartbeats if parsed else 0,
                "parse_errors": parsed.parse_errors[:5] if parsed else [],
            },
        }
        if case.kind == "research" and execution.research:
            report = str(execution.research.get("report", ""))
            response_summary["answer_snippet"] = report[:ANSWER_SNIPPET_CHARS]
            response_summary["research_state"] = execution.research.get("state", "SUCCESS")
            response_summary["research_sources"] = len(execution.research.get("sources") or [])
        if execution.image_url:
            response_summary["image_url"] = execution.image_url
    if execution.extra:
        extra = dict(execution.extra)
        extra.pop("expected_token", None)  # not interesting in the dashboard
        response_summary["pipeline"] = json.loads(json.dumps(extra, default=str))

    return {
        "status": status,
        "assertions": assertion_rows,
        "judge": judge_result,
        "latency": {
            "ttfb_ms": result.ttfb_ms if result else 0,
            "total_ms": result.total_ms if result else 0,
        },
        "response": response_summary,
    }


def execute_case(
    client: ChatClient,
    case: EvalCase,
    identity: EvalIdentity | None,
    run_id: str,
) -> tuple[dict, CaseExecution]:
    """Execute a case (with one flaky retry) and evaluate it."""
    attempts = 1
    execution = _execute_once(client, case, identity, run_id)
    evaluation = _evaluate(case, execution)

    if evaluation["status"] == "fail" and case.retry_flaky:
        logging.info(f"[EVALS] retrying flaky case {case.id}")
        time.sleep(5)
        attempts = 2
        execution = _execute_once(client, case, identity, run_id)
        evaluation = _evaluate(case, execution)

    evaluation["attempts"] = attempts
    return evaluation, execution


# ---- virtual cases ----


def _virtual_cases(executions: dict, case_docs: dict) -> list:
    rows = []

    leaks = []
    for case_id, execution in executions.items():
        for result in execution.results:
            if result.parsed:
                leaks.extend(
                    f"{case_id}: {leak}" for leak in result.parsed.leaked_sentinels
                )
    rows.append(
        {
            "id": "sentinel_leakage",
            "name": "Sentinel hygiene (all cases)",
            "category": "sentinels",
            "status": "fail" if leaks else "pass",
            "assertions": [
                {
                    "name": "no_leaked_sentinels",
                    "severity": "hard",
                    "passed": not leaks,
                    "detail": f"leaks: {leaks[:5]}" if leaks else "no raw sentinels leaked into any answer",
                }
            ],
            "judge": None,
            "latency": {"ttfb_ms": 0, "total_ms": 0},
            "response": {},
            "attempts": 1,
        }
    )

    ttfbs = [
        doc["latency"]["ttfb_ms"]
        for doc in case_docs.values()
        if doc["latency"]["ttfb_ms"] > 0
    ]
    median_ttfb = int(median(ttfbs)) if ttfbs else 0
    within = median_ttfb <= LATENCY_TTFB_BUDGET_MS
    rows.append(
        {
            "id": "latency_budget",
            "name": "Latency budget (all cases)",
            "category": "performance",
            "status": "pass" if within else "warn",
            "assertions": [
                {
                    "name": f"median_ttfb_under_{LATENCY_TTFB_BUDGET_MS}ms",
                    "severity": "soft",
                    "passed": within,
                    "detail": f"median TTFB {median_ttfb}ms across {len(ttfbs)} streamed cases",
                }
            ],
            "judge": None,
            "latency": {"ttfb_ms": median_ttfb, "total_ms": 0},
            "response": {},
            "attempts": 1,
        }
    )
    return rows


# ---- persistence ----


class RunWriter:
    """Writes run/case docs to Firestore; no-ops entirely in dry mode."""

    def __init__(self, run_id: str, dry: bool):
        self.run_id = run_id
        self.dry = dry

    def _ref(self):
        return _db().collection("eval_runs").document(self.run_id)

    def update_run(self, fields: dict):
        if self.dry:
            return
        try:
            self._ref().set(fields, merge=True)
        except Exception as exc:
            logging.error(f"[EVALS] run doc write failed: {exc}")

    def write_case(self, case_id: str, fields: dict):
        if self.dry:
            return
        try:
            self._ref().collection("cases").document(case_id).set(fields, merge=True)
        except Exception as exc:
            logging.error(f"[EVALS] case doc write failed: {exc}")


# ---- suite ----


def run_suite(
    run_id: str,
    trigger: str = "manual",
    case_filter: list | None = None,
    dry: bool = False,
) -> dict:
    """Run the suite. Returns the final run summary dict."""
    writer = RunWriter(run_id, dry)
    started = _now()
    started_monotonic = time.monotonic()

    cases = [c for c in ALL_CASES if not case_filter or c.id in case_filter]
    total = len(cases) + (2 if not case_filter else 0)  # + virtual cases on full runs

    writer.update_run(
        {
            "status": "running",
            "trigger": trigger,
            "target_url": config.target_url(),
            "started_at": started,
            "progress": {"total": total, "completed": 0, "current_case": ""},
        }
    )

    try:
        identity = sign_in()
    except Exception as exc:
        summary = {"error": f"eval account sign-in failed: {exc}"}
        writer.update_run(
            {"status": "error", "summary": summary, "finished_at": _now()}
        )
        return summary

    writer.update_run({"eval_uid": identity.uid})
    requirements = check_requirements(identity)
    logging.info(f"[EVALS] requirements: {requirements}")

    client = ChatClient(config.target_url(), identity)
    guest_client = ChatClient(config.target_url(), None)

    case_docs: dict = {}
    executions: dict = {}
    case_index: list = []
    judge_tokens = 0

    for position, case in enumerate(cases):
        writer.update_run(
            {"progress": {"total": total, "completed": position, "current_case": case.id}}
        )

        unmet = [req for req in case.requires if not requirements.get(req)]
        if unmet:
            doc = {
                "idx": position,
                "name": case.name,
                "category": case.category,
                "status": "skipped",
                "skip_reason": f"requires {', '.join(unmet)}",
                "assertions": [],
                "judge": None,
                "latency": {"ttfb_ms": 0, "total_ms": 0},
                "response": {},
                "attempts": 0,
            }
            case_docs[case.id] = doc
            writer.write_case(case.id, doc)
            case_index.append(_index_row(case.id, doc))
            continue

        writer.write_case(
            case.id,
            {
                "idx": position,
                "name": case.name,
                "category": case.category,
                "status": "running",
                "started_at": _now(),
            },
        )
        try:
            evaluation, execution = execute_case(
                guest_client if case.kind == "guest" else client,
                case,
                None if case.kind == "guest" else identity,
                run_id,
            )
            executions[case.id] = execution
        except Exception as exc:
            logging.error(f"[EVALS] case {case.id} crashed: {exc}", exc_info=True)
            evaluation = {
                "status": "error",
                "assertions": [],
                "judge": None,
                "latency": {"ttfb_ms": 0, "total_ms": 0},
                "response": {"error": str(exc)[:500]},
                "attempts": 1,
            }

        judge = evaluation.get("judge")
        if judge and "tokens" in judge:
            judge_tokens += judge["tokens"]

        last_turn = case.turns[-1]
        doc = {
            "idx": position,
            "name": case.name,
            "category": case.category,
            "finished_at": _now(),
            "request": {
                "search_mode": last_turn.overrides.get("search_mode", "ASSISTANT"),
                "model_name": last_turn.overrides.get(
                    "model_name",
                    "gpt-5.4-mini" if case.kind == "guest" else "gpt-5.6-sol",
                ),
                "user_input": last_turn.user_input[:300],
                "conversation_id": f"eval-{run_id}-{case.id}",
            },
            **evaluation,
        }
        case_docs[case.id] = doc
        writer.write_case(case.id, doc)
        case_index.append(_index_row(case.id, doc))

    if not case_filter:
        for position, doc in enumerate(_virtual_cases(executions, case_docs)):
            doc["idx"] = len(cases) + position
            case_docs[doc["id"]] = doc
            writer.write_case(doc["id"], doc)
            case_index.append(_index_row(doc["id"], doc))

    # ---- summary ----
    statuses = [doc["status"] for doc in case_docs.values()]
    passed = statuses.count("pass")
    failed = statuses.count("fail") + statuses.count("error")
    warned = statuses.count("warn")
    skipped = statuses.count("skipped")
    graded = passed + failed
    ttfbs = [
        doc["latency"]["ttfb_ms"] for doc in case_docs.values() if doc["latency"]["ttfb_ms"] > 0
    ]
    judge_scores = [
        doc["judge"]["score"]
        for doc in case_docs.values()
        if doc.get("judge") and "score" in (doc.get("judge") or {})
    ]
    summary = {
        "passed": passed,
        "failed": failed,
        "warned": warned,
        "skipped": skipped,
        "pass_rate": round(passed / graded, 3) if graded else 0.0,
        "median_ttfb_ms": int(median(ttfbs)) if ttfbs else 0,
        "judge_avg": round(sum(judge_scores) / len(judge_scores), 1) if judge_scores else None,
        "judge_tokens": judge_tokens,
        "requirements": requirements,
    }

    writer.update_run(
        {
            "status": "complete",
            "finished_at": _now(),
            "duration_s": int(time.monotonic() - started_monotonic),
            "progress": {"total": total, "completed": total, "current_case": ""},
            "summary": summary,
            "case_index": case_index,
        }
    )
    logging.info(f"[EVALS] run {run_id} complete: {summary}")
    return summary


def _index_row(case_id: str, doc: dict) -> dict:
    judge = doc.get("judge") or {}
    return {
        "id": case_id,
        "name": doc["name"],
        "category": doc["category"],
        "status": doc["status"],
        "total_ms": doc["latency"]["total_ms"],
        "judge_score": judge.get("score"),
    }


# ---- CLI ----


def main():
    parser = argparse.ArgumentParser(description="Run the Chunk AI chat eval suite")
    parser.add_argument("--case", action="append", help="run only this case id (repeatable)")
    parser.add_argument("--dry", action="store_true", help="don't write Firestore run docs")
    parser.add_argument("--list", action="store_true", help="list case ids and exit")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.list:
        for case in ALL_CASES:
            print(f"{case.id:28s} [{case.category}] {case.name}")
        return

    if args.case:
        unknown = [case_id for case_id in args.case if get_case(case_id) is None]
        if unknown:
            print(f"unknown case ids: {unknown}", file=sys.stderr)
            sys.exit(2)

    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    if not args.dry:
        _db().collection("eval_runs").document(run_id).set(
            {"status": "queued", "trigger": "cli", "created_at": _now()}
        )
    print(f"run_id: {run_id}  target: {config.target_url()}  dry: {args.dry}")

    summary = run_suite(run_id, trigger="cli", case_filter=args.case, dry=args.dry)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
