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
  research_report_type?: string;
  research_words?: number;
  research_elapsed_s?: number;
  /** gpt-researcher cost accounting — a number, or its per-stage breakdown. */
  research_cost?: number | Record<string, unknown> | null;
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

// Research report types the suite can cover, toggled per run. The ids are the
// `reportType` wire strings sent to cerebral and must match
// server/evals/config.py SELECTABLE_RESEARCH_TYPES.
export type EvalResearchType = 'outline_report' | 'deep' | 'detailed_report';

export interface EvalResearchTypeOption {
  id: EvalResearchType;
  label: string;
  description: string;
  estimate: string;
}

export const EVAL_RESEARCH_TYPES: EvalResearchTypeOption[] = [
  {
    id: 'outline_report',
    label: 'Quick outline',
    description: 'Single-pass outline report — the cheap end-to-end baseline.',
    estimate: '~4 min',
  },
  {
    id: 'deep',
    label: 'Deep',
    description:
      'Multi-level deep research pipeline: planner, sub-queries, source tree. The expensive one.',
    estimate: '~10 min',
  },
  {
    id: 'detailed_report',
    label: 'Detailed',
    description:
      'Standard report with the boosted 4,500-word budget — catches silent degradation to a plain report.',
    estimate: '~7 min',
  },
];

// Deep is on by default; detailed is opt-in (mirrors DEFAULT_RESEARCH_TYPES).
export const DEFAULT_EVAL_RESEARCH_TYPES: EvalResearchType[] = ['outline_report', 'deep'];

export function researchTypeLabel(id: string): string {
  return EVAL_RESEARCH_TYPES.find((option) => option.id === id)?.label ?? id;
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
  /** Per-run options recorded by the runner (research coverage today). */
  options?: { research_types?: string[] };
  case_index: EvalCaseIndexRow[];
}

export interface EvalRunDetail extends EvalRun {
  cases: EvalCaseResult[];
}

export const TERMINAL_RUN_STATUSES: EvalRunStatus[] = ['complete', 'timeout', 'error'];

export function isRunActive(status: EvalRunStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}
