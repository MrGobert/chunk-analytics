'use client';

import { Fragment, useState } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { EvalCaseStatusPill } from '@/components/evals/EvalStatusPill';
import type { EvalCaseResult } from '@/types/evals';

function formatMs(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AssertionRow({ assertion }: { assertion: EvalCaseResult['assertions'][number] }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-line/50 last:border-0">
      {assertion.passed ? (
        <Check size={14} className="text-sage-deep mt-0.5 shrink-0" />
      ) : (
        <X
          size={14}
          className={`${assertion.severity === 'hard' ? 'text-ember-deep' : 'text-ink-soft'} mt-0.5 shrink-0`}
        />
      )}
      <div className="min-w-0">
        <span className="text-xs font-mono text-ink">{assertion.name}</span>
        <span
          className={`ml-2 text-[0.65rem] font-mono uppercase tracking-wide ${
            assertion.severity === 'hard' ? 'text-ink-faint' : 'text-ink-faint/70'
          }`}
        >
          {assertion.severity}
        </span>
        <p className="text-xs text-ink-soft break-words">{assertion.detail}</p>
      </div>
    </div>
  );
}

function CaseDetail({ caseResult }: { caseResult: EvalCaseResult }) {
  const { request, response, judge } = caseResult;
  return (
    <div className="px-4 pb-5 pt-1 grid gap-5 lg:grid-cols-2">
      <div>
        <h4 className="eyebrow mb-2">Assertions</h4>
        {caseResult.assertions.length === 0 ? (
          <p className="text-xs text-ink-faint font-mono">
            {caseResult.skip_reason ? `Skipped — ${caseResult.skip_reason}` : 'None recorded'}
          </p>
        ) : (
          caseResult.assertions.map((assertion, index) => (
            <AssertionRow key={`${assertion.name}-${index}`} assertion={assertion} />
          ))
        )}

        {judge && (
          <div className="mt-4">
            <h4 className="eyebrow mb-2">Judge</h4>
            {judge.error ? (
              <p className="text-xs text-ink-soft font-mono">unavailable: {judge.error}</p>
            ) : (
              <div className="text-xs text-ink-soft">
                <span className="font-mono text-ink">
                  {judge.score}/10{' '}
                  <span className="text-ink-faint">(min {judge.min_score})</span>
                </span>
                {judge.flags && judge.flags.length > 0 && (
                  <span className="ml-2 font-mono text-ember-deep">{judge.flags.join(', ')}</span>
                )}
                {judge.rationale && <p className="mt-1">{judge.rationale}</p>}
              </div>
            )}
          </div>
        )}

        {request && (
          <div className="mt-4">
            <h4 className="eyebrow mb-2">Request</h4>
            <p className="text-xs font-mono text-ink-soft break-words">
              {request.search_mode} · {request.model_name}
            </p>
            <p className="text-xs text-ink-faint mt-1 break-words">“{request.user_input}”</p>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {response?.answer_snippet && (
          <>
            <h4 className="eyebrow mb-2">Response</h4>
            <pre className="text-xs text-ink-soft bg-paper border border-line rounded-btn p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {response.answer_snippet}
            </pre>
          </>
        )}
        {response?.image_url && (
          <p className="text-xs font-mono text-ink-soft mt-2 break-all">
            image:{' '}
            <a
              href={response.image_url}
              target="_blank"
              rel="noreferrer"
              className="text-ember-deep underline"
            >
              {response.image_url.slice(0, 80)}…
            </a>
          </p>
        )}
        {response?.sentinel_summary && (
          <p className="text-xs font-mono text-ink-faint mt-3">
            sources {response.sources_count ?? 0} · grounded{' '}
            {response.sentinel_summary.grounded ?? 0} · related{' '}
            {response.sentinel_summary.related ?? 0} · heartbeats{' '}
            {response.sentinel_summary.heartbeats ?? 0}
            {response.reasoning_effort ? ` · effort ${response.reasoning_effort}` : ''}
          </p>
        )}
        {response?.error && (
          <p className="text-xs font-mono text-ember-deep mt-2 break-words">{response.error}</p>
        )}
      </div>
    </div>
  );
}

export default function EvalCaseTable({ cases }: { cases: EvalCaseResult[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (cases.length === 0) {
    return (
      <p className="text-sm text-ink-faint font-mono py-8 text-center">
        No case results yet — they appear live as the run progresses.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="eyebrow py-3 pr-2 w-8" />
            <th className="eyebrow py-3 pr-4">Status</th>
            <th className="eyebrow py-3 pr-4">Case</th>
            <th className="eyebrow py-3 pr-4 hidden md:table-cell">Category</th>
            <th className="eyebrow py-3 pr-4 text-right">TTFB</th>
            <th className="eyebrow py-3 pr-4 text-right">Total</th>
            <th className="eyebrow py-3 pr-4 text-right hidden sm:table-cell">Judge</th>
            <th className="eyebrow py-3 text-right hidden sm:table-cell">Tries</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((caseResult) => {
            const isOpen = expanded === caseResult.id;
            return (
              <Fragment key={caseResult.id}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : caseResult.id)}
                  className={`border-b border-line/60 cursor-pointer transition-colors hover:bg-paper ${
                    caseResult.status === 'running' ? 'animate-pulse' : ''
                  }`}
                >
                  <td className="py-3 pr-2 text-ink-faint">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td className="py-3 pr-4">
                    <EvalCaseStatusPill status={caseResult.status} />
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-sm text-ink">{caseResult.name}</span>
                    <span className="block text-[0.7rem] font-mono text-ink-faint">
                      {caseResult.id}
                    </span>
                  </td>
                  <td className="py-3 pr-4 hidden md:table-cell">
                    <span className="text-xs font-mono text-ink-soft">{caseResult.category}</span>
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-xs text-ink-soft tabular-nums">
                    {formatMs(caseResult.latency?.ttfb_ms ?? 0)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-xs text-ink-soft tabular-nums">
                    {formatMs(caseResult.latency?.total_ms ?? 0)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-xs text-ink-soft tabular-nums hidden sm:table-cell">
                    {caseResult.judge && caseResult.judge.score !== undefined
                      ? `${caseResult.judge.score}/10`
                      : '—'}
                  </td>
                  <td className="py-3 text-right font-mono text-xs text-ink-faint tabular-nums hidden sm:table-cell">
                    {caseResult.attempts ?? '—'}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line/60 bg-paper/50">
                    <td colSpan={8}>
                      <CaseDetail caseResult={caseResult} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
