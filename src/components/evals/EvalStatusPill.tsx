import type { EvalCaseStatus, EvalRunStatus } from '@/types/evals';

const CASE_STYLES: Record<EvalCaseStatus, { label: string; className: string; pulse?: boolean }> = {
  pass: { label: 'Pass', className: 'bg-sage-tint text-sage-deep border-sage/30' },
  fail: { label: 'Fail', className: 'bg-ember-tint text-ember-deep border-ember/30' },
  error: { label: 'Error', className: 'bg-ember-tint text-ember-deep border-ember/30' },
  warn: { label: 'Warn', className: 'bg-butter-tint text-ink-soft border-butter/50' },
  skipped: { label: 'Skipped', className: 'bg-paper text-ink-faint border-line' },
  running: { label: 'Running', className: 'bg-butter-tint text-ink-soft border-butter/50', pulse: true },
};

const RUN_STYLES: Record<EvalRunStatus, { label: string; className: string; pulse?: boolean }> = {
  queued: { label: 'Queued', className: 'bg-butter-tint text-ink-soft border-butter/50', pulse: true },
  running: { label: 'Running', className: 'bg-butter-tint text-ink-soft border-butter/50', pulse: true },
  complete: { label: 'Complete', className: 'bg-sage-tint text-sage-deep border-sage/30' },
  timeout: { label: 'Timeout', className: 'bg-ember-tint text-ember-deep border-ember/30' },
  error: { label: 'Error', className: 'bg-ember-tint text-ember-deep border-ember/30' },
};

function Pill({ label, className, pulse }: { label: string; className: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${className}`}
    >
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-butter animate-pulse" />}
      {label}
    </span>
  );
}

export function EvalCaseStatusPill({ status }: { status: EvalCaseStatus }) {
  const style = CASE_STYLES[status] ?? CASE_STYLES.skipped;
  return <Pill {...style} />;
}

export function EvalRunStatusPill({ status }: { status: EvalRunStatus }) {
  const style = RUN_STYLES[status] ?? RUN_STYLES.error;
  return <Pill {...style} />;
}
