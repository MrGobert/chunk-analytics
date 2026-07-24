'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, Gauge, Play, Sparkles } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import LineChart from '@/components/charts/LineChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EvalCaseTable from '@/components/evals/EvalCaseTable';
import { EvalRunStatusPill } from '@/components/evals/EvalStatusPill';
import { useEvalRunDetail, useEvalRuns, useStartEvalRun } from '@/hooks/useEvalRun';
import { isRunActive, type EvalRun } from '@/types/evals';

function formatRunTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function runAge(run: EvalRun | undefined): string {
  const iso = run?.finished_at || run?.created_at;
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function EvalsPage() {
  const { runs, isLoading: runsLoading, lastUpdated, refresh: refreshRuns } = useEvalRuns();
  const { startRun, isStarting } = useStartEvalRun();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Default the detail view to the newest run once the list loads.
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].run_id);
    }
  }, [runs, selectedRunId]);

  const { run: detail } = useEvalRunDetail(selectedRunId);

  const activeRun = runs.find((run) => isRunActive(run.status));
  const lastFinished = runs.find((run) => !isRunActive(run.status));
  const summary = lastFinished?.summary ?? {};
  const graded = (summary.passed ?? 0) + (summary.failed ?? 0);

  const historyData = useMemo(
    () =>
      [...runs]
        .filter((run) => run.status === 'complete' && run.summary?.pass_rate !== undefined)
        .reverse()
        .map((run) => ({
          run: formatRunTime(run.finished_at || run.created_at),
          passRate: Math.round((run.summary.pass_rate ?? 0) * 100),
          warnings: run.summary.warned ?? 0,
        })),
    [runs]
  );

  const handleStart = async () => {
    setStartError(null);
    const result = await startRun();
    if (result.error) {
      setStartError(result.error);
      return;
    }
    if (result.runId) setSelectedRunId(result.runId);
    refreshRuns();
  };

  const detailProgress = detail?.progress;
  const showProgress = detail && isRunActive(detail.status);

  return (
    <div>
      <PageHeader
        title="Evals"
        subtitle="Post-deploy sanity suite for the production AI chat — searches, images, sentinels, research, connectors."
        lastUpdated={lastUpdated}
        isRefreshing={Boolean(activeRun)}
        controls={
          <button
            onClick={handleStart}
            disabled={isStarting || Boolean(activeRun)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-btn bg-ember text-white font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={15} />
            {activeRun ? 'Run in progress…' : isStarting ? 'Starting…' : 'Run eval suite'}
          </button>
        }
      />

      {startError && (
        <div className="card-surface border-ember/30 bg-ember-tint text-ember-deep text-sm p-4 mb-6 rounded-card">
          {startError}
        </div>
      )}

      {/* Stat row — last finished run */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Pass rate (last run)"
          value={(summary.pass_rate ?? 0) * 100}
          format="percentage"
          subtitle={graded ? `${summary.passed}/${graded} graded cases` : 'no completed runs yet'}
          icon={<CheckCircle2 size={18} />}
        />
        <StatCard
          title="Warnings"
          value={summary.warned ?? 0}
          format="number"
          subtitle={`${summary.skipped ?? 0} skipped`}
          icon={<FlaskConical size={18} />}
        />
        <StatCard
          title="Median TTFB"
          value={(summary.median_ttfb_ms ?? 0) / 1000}
          format="decimal"
          suffix="s"
          subtitle="time to first streamed byte"
          icon={<Gauge size={18} />}
        />
        <StatCard
          title="Judge average"
          value={summary.judge_avg ?? 0}
          format="decimal"
          suffix="/10"
          subtitle={`last run ${runAge(lastFinished)} · ${lastFinished?.trigger || ''}`}
          icon={<Sparkles size={18} />}
        />
      </div>

      {/* Live progress banner */}
      {showProgress && (
        <div className="card-surface p-4 mb-8 flex items-center gap-4 border-butter/50 bg-butter-tint rounded-card">
          <LoadingSpinner />
          <div>
            <p className="text-sm font-semibold text-ink">
              Running case {Math.min((detailProgress?.completed ?? 0) + 1, detailProgress?.total ?? 0)} of{' '}
              {detailProgress?.total ?? '…'}
              {detailProgress?.current_case ? (
                <span className="font-mono text-ink-soft"> — {detailProgress.current_case}</span>
              ) : null}
            </p>
            <p className="text-xs font-mono text-ink-faint mt-0.5">
              Results appear below as each case finishes. A full run takes 10–20 minutes.
            </p>
          </div>
        </div>
      )}

      {/* Case results for the selected run */}
      <div className="card-surface card-animate p-6 sm:p-8 mb-8">
        <div className="mb-4 border-b border-line pb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-display text-xl sm:text-2xl text-ink">Case results</h3>
            {detail && (
              <p className="text-sm font-mono text-ink-faint mt-2">
                {detail.run_id} · {detail.trigger}
                {detail.duration_s ? ` · ${Math.round(detail.duration_s / 60)}m` : ''}
              </p>
            )}
          </div>
          {detail && <EvalRunStatusPill status={detail.status} />}
        </div>
        {detail?.summary?.error && (
          <p className="text-sm text-ember-deep font-mono mb-4">{detail.summary.error}</p>
        )}
        <EvalCaseTable cases={detail?.cases ?? []} />
      </div>

      {/* History */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartCard title="Pass rate over time" subtitle="completed runs, oldest → newest">
          {historyData.length > 1 ? (
            <LineChart
              data={historyData}
              xKey="run"
              lines={[
                { key: 'passRate', color: 'var(--sage)', name: 'Pass rate %' },
                { key: 'warnings', color: 'var(--butter)', name: 'Warnings' },
              ]}
              showLegend
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-ink-faint font-mono">
              Trend appears after two completed runs.
            </div>
          )}
        </ChartCard>

        <div className="card-surface card-animate p-6 sm:p-8">
          <h3 className="font-display text-xl sm:text-2xl text-ink border-b border-line pb-4 mb-4">
            Recent runs
          </h3>
          {runsLoading ? (
            <div className="py-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-ink-faint font-mono py-6 text-center">
              No runs yet — click “Run eval suite” to start the first one.
            </p>
          ) : (
            <div className="divide-y divide-line/60">
              {runs.slice(0, 10).map((run) => {
                const runGraded = (run.summary?.passed ?? 0) + (run.summary?.failed ?? 0);
                return (
                  <button
                    key={run.run_id}
                    onClick={() => setSelectedRunId(run.run_id)}
                    className={`w-full flex items-center justify-between gap-3 py-3 px-2 text-left transition-colors hover:bg-paper rounded-btn ${
                      run.run_id === selectedRunId ? 'bg-paper' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink font-mono truncate">
                        {formatRunTime(run.finished_at || run.created_at)}
                      </p>
                      <p className="text-xs text-ink-faint font-mono">
                        {run.trigger}
                        {runGraded
                          ? ` · ${run.summary?.passed}/${runGraded} passed · ${run.summary?.warned ?? 0} warn`
                          : ''}
                      </p>
                    </div>
                    <EvalRunStatusPill status={run.status} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
