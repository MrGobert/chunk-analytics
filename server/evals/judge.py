"""
LLM judge — scores whether an answer actually addresses the prompt.

Uses OpenAI with a strict JSON schema response. Judge infrastructure problems
(missing key, API errors) degrade to a warn on the case, never a failure —
the deterministic assertions carry the hard pass/fail signal.
"""

import json
import logging
from dataclasses import dataclass

from evals import config

JUDGE_SYSTEM_PROMPT = """You are grading the output of an AI assistant for an automated \
sanity-check suite. Score how well the ANSWER addresses the USER PROMPT on a 0-10 scale:

- 9-10: directly and completely addresses the prompt, coherent and well formatted
- 6-8: addresses the prompt with minor gaps, verbosity, or formatting issues
- 3-5: partially relevant, significant gaps, or awkward/broken formatting
- 0-2: irrelevant, refusal, error text, empty, or incoherent

Also flag structural problems in `flags` (e.g. "refusal", "error_text",
"truncated", "raw_markup_leak", "wrong_language"). Judge only what is present —
do not penalize an answer for lacking sources or images; other checks cover those."""

JUDGE_SCHEMA = {
    "name": "eval_judgement",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 10},
            "rationale": {"type": "string"},
            "flags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["score", "rationale", "flags"],
        "additionalProperties": False,
    },
}

MAX_ANSWER_CHARS = 6000


@dataclass
class JudgeSpec:
    min_score: int = 6
    extra_criteria: str = ""


def judge_answer(question: str, answer: str, spec: JudgeSpec) -> dict:
    """Return {"model", "score", "min_score", "rationale", "flags", "tokens"}
    or {"error": ...} when the judge infrastructure is unavailable."""
    if not config.openai_api_key():
        return {"error": "OPENAI_API_KEY not configured"}
    if not answer.strip():
        return {
            "model": config.judge_model(),
            "score": 0,
            "min_score": spec.min_score,
            "rationale": "empty answer",
            "flags": ["empty"],
            "tokens": 0,
        }

    user_content = f"USER PROMPT:\n{question}\n\nANSWER:\n{answer[:MAX_ANSWER_CHARS]}"
    if spec.extra_criteria:
        user_content += f"\n\nADDITIONAL CRITERIA FOR THIS CASE:\n{spec.extra_criteria}"

    last_error = None
    for _ in range(2):  # one retry on API error
        try:
            from openai import OpenAI

            client = OpenAI(api_key=config.openai_api_key())
            response = client.chat.completions.create(
                model=config.judge_model(),
                messages=[
                    {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_schema", "json_schema": JUDGE_SCHEMA},
            )
            payload = json.loads(response.choices[0].message.content)
            usage = getattr(response, "usage", None)
            return {
                "model": config.judge_model(),
                "score": int(payload.get("score", 0)),
                "min_score": spec.min_score,
                "rationale": str(payload.get("rationale", ""))[:500],
                "flags": payload.get("flags", []),
                "tokens": getattr(usage, "total_tokens", 0) if usage else 0,
            }
        except Exception as exc:
            last_error = exc
            logging.warning(f"[EVALS] judge call failed: {exc}")

    return {"error": f"judge unavailable: {last_error}"}
