'use client';

// Polling hooks for the eval suite. useAnalytics's 5-minute SWR cache is the
// wrong tool while a run is live, so these hooks poll directly: the runs list
// every 10s while a run is active, and the selected run detail every 5s until
// it reaches a terminal status.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type EvalRun,
  type EvalRunDetail,
  isRunActive,
} from '@/types/evals';

const RUNS_POLL_MS = 10_000;
const DETAIL_POLL_MS = 5_000;

export interface StartRunResult {
  runId: string | null;
  attached: boolean; // true when a 409 pointed us at an already-active run
  error: string | null;
}

export function useEvalRuns(limit = 30) {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchRuns = useCallback(async () => {
    try {
      const response = await fetch(`/api/evals/runs?limit=${limit}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setRuns(data.runs ?? []);
      setLastUpdated(data.lastUpdated ?? '');
      setError(data.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll while any run in the list is queued/running.
  const hasActive = runs.some((run) => isRunActive(run.status));
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(fetchRuns, RUNS_POLL_MS);
    return () => clearInterval(interval);
  }, [hasActive, fetchRuns]);

  return { runs, isLoading, error, lastUpdated, refresh: fetchRuns };
}

export function useEvalRunDetail(runId: string | null) {
  const [run, setRun] = useState<EvalRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(false);

  const fetchDetail = useCallback(async () => {
    if (!runId) return;
    try {
      const response = await fetch(`/api/evals/runs/${encodeURIComponent(runId)}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.note || `HTTP ${response.status}`);
      }
      if (data.run) {
        setRun(data.run);
        activeRef.current = isRunActive(data.run.status);
        setError(null);
      } else {
        setError('Run not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run');
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    setRun(null);
    setError(null);
    if (!runId) return;
    setIsLoading(true);
    activeRef.current = true;
    fetchDetail();
    const interval = setInterval(() => {
      if (activeRef.current) fetchDetail();
      else clearInterval(interval);
    }, DETAIL_POLL_MS);
    return () => clearInterval(interval);
  }, [runId, fetchDetail]);

  return { run, isLoading, error, refresh: fetchDetail };
}

export function useStartEvalRun() {
  const [isStarting, setIsStarting] = useState(false);

  const startRun = useCallback(async (): Promise<StartRunResult> => {
    setIsStarting(true);
    try {
      const response = await fetch('/api/evals/run', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.run_id) {
        return { runId: data.run_id, attached: true, error: null };
      }
      if (!response.ok) {
        return { runId: null, attached: false, error: data.error || `HTTP ${response.status}` };
      }
      return { runId: data.run_id ?? null, attached: false, error: null };
    } catch (err) {
      return {
        runId: null,
        attached: false,
        error: err instanceof Error ? err.message : 'Failed to start run',
      };
    } finally {
      setIsStarting(false);
    }
  }, []);

  return { startRun, isStarting };
}
