// Types for the AI chat eval suite (mirrors the Firestore eval_runs schema
// served by cerebral-analytics /api/analytics/evals/*).

export type EvalRunStatus = 'queued' | 'running' | 'complete' | 'timeout' | 'error';

export type EvalCaseStatus = 'pass' | 'fail' | 'warn' | 'error' | 'skipped' | 'running';

export interface EvalAssertionResult {
  name: string;
  severity: 'hard' | 'soft';
  passed: boolean;
  detail: string;
}

export interface EvalJudgeResult {
  model?: string;
  score?: number;
  min_score?: number;
  rationale?: string;
  flags?: string[];
  tokens?: number;
  error?: string;
}

export interface EvalSentinelSummary {
  grounded?: number;
  related?: number;
  connector_events?: string[];
  image_events?: string[];
  heartbeats?: number;
  parse_errors?: string[];
}

export interface EvalCaseResponse {
  answer_snippet?: string;
  sources_count?: number;
  questions?: string[] | null;
  reasoning_effort?: string;
  sentinel_summary?: EvalSentinelSummary;
  research_state?: string;
  research_sources?: number;
  image_url?: string;
  pipeline?: Record<string, unknown>;
  error?: string;
}

export interface EvalCaseResult {
  id: string;
  idx: number;
  name: string;
  category: string;
  status: EvalCaseStatus;
  skip_reason?: string;
  attempts?: number;
  started_at?: string;
  finished_at?: string;
  latency: { ttfb_ms: number; total_ms: number };
  request?: {
    search_mode?: string;
    model_name?: string;
    user_input?: string;
    conversation_id?: string;
  };
  response?: EvalCaseResponse;
  assertions: EvalAssertionResult[];
  judge: EvalJudgeResult | null;
}

export interface EvalCaseIndexRow {
  id: string;
  name: string;
  category: string;
  status: EvalCaseStatus;
  total_ms: number;
  judge_score: number | null;
}

export interface EvalRunSummary {
  passed?: number;
  failed?: number;
  warned?: number;
  skipped?: number;
  pass_rate?: number;
  median_ttfb_ms?: number;
  judge_avg?: number | null;
  judge_tokens?: number;
  requirements?: Record<string, boolean>;
  error?: string;
}

export interface EvalRun {
  run_id: string;
  status: EvalRunStatus;
  trigger: string;
  target_url: string;
  eval_uid: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  duration_s: number | null;
  progress: { total?: number; completed?: number; current_case?: string };
  summary: EvalRunSummary;
  case_index: EvalCaseIndexRow[];
}

export interface EvalRunDetail extends EvalRun {
  cases: EvalCaseResult[];
}

export const TERMINAL_RUN_STATUSES: EvalRunStatus[] = ['complete', 'timeout', 'error'];

export function isRunActive(status: EvalRunStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}
