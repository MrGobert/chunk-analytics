'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  params: string;
}

interface AnalyticsCache {
  get<T>(key: string): CacheEntry<T> | undefined;
  set<T>(key: string, entry: CacheEntry<T>): void;
  prefetch(endpoint: string, params: Record<string, string>): void;
}

export interface UseAnalyticsResult<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

// ─── Context ─────────────────────────────────────────────────────────────────

const AnalyticsCacheContext = createContext<AnalyticsCache | null>(null);

function buildCacheKey(endpoint: string, params: Record<string, string>): string {
  return `${endpoint}:${JSON.stringify(params)}`;
}

function buildUrl(endpoint: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `${endpoint}?${searchParams.toString()}`;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AnalyticsCacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry<unknown>>>(new Map());

  const cacheValue = useRef<AnalyticsCache>({
    get<T>(key: string): CacheEntry<T> | undefined {
      return cacheRef.current.get(key) as CacheEntry<T> | undefined;
    },
    set<T>(key: string, entry: CacheEntry<T>): void {
      cacheRef.current.set(key, entry as CacheEntry<unknown>);
    },
    prefetch(endpoint: string, params: Record<string, string>): void {
      const key = buildCacheKey(endpoint, params);
      const existing = cacheRef.current.get(key);
      const now = Date.now();

      // Don't prefetch if we have fresh data
      if (existing && now - existing.timestamp < STALE_TIME) {
        return;
      }

      const url = buildUrl(endpoint, params);
      fetch(url, { priority: 'low' as RequestPriority })
        .then((res) => {
          if (!res.ok) return;
          return res.json();
        })
        .then((data) => {
          if (data) {
            cacheRef.current.set(key, {
              data,
              timestamp: Date.now(),
              params: JSON.stringify(params),
            });
          }
        })
        .catch(() => {
          // Silently fail prefetch
        });
    },
  }).current;

  return (
    <AnalyticsCacheContext.Provider value={cacheValue}>
      {children}
    </AnalyticsCacheContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAnalytics<T>(
  endpoint: string,
  params: Record<string, string>
): UseAnalyticsResult<T> {
  const cache = useContext(AnalyticsCacheContext);
  if (!cache) {
    throw new Error('useAnalytics must be used within an AnalyticsCacheProvider');
  }

  const paramsKey = JSON.stringify(params);
  const cacheKey = buildCacheKey(endpoint, params);

  // Check cache for initial state
  const cached = cache.get<T>(cacheKey);
  const isFresh = cached ? Date.now() - cached.timestamp < STALE_TIME : false;

  const [data, setData] = useState<T | null>(cached?.data ?? null);
  const [isLoading, setIsLoading] = useState(!cached);
  const [isRefreshing, setIsRefreshing] = useState(cached ? !isFresh : false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(
    cached ? new Date(cached.timestamp).toISOString() : ''
  );

  // Track in-flight requests to avoid duplicates
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Keep a stable ref to params so the callback doesn't depend on the object reference
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Check cache before fetching
    const existing = cache.get<T>(cacheKey);
    const now = Date.now();

    if (existing) {
      // Always show cached data immediately
      setData(existing.data);
      setError(null);

      if (now - existing.timestamp < STALE_TIME) {
        // Fresh data — no fetch needed
        setIsLoading(false);
        setIsRefreshing(false);
        setLastUpdated(new Date(existing.timestamp).toISOString());
        return;
      }

      // Stale data — show it but revalidate in background
      setIsLoading(false);
      setIsRefreshing(true);
      setLastUpdated(new Date(existing.timestamp).toISOString());
    } else {
      // No cached data — first load
      setIsLoading(true);
      setIsRefreshing(false);
    }

    try {
      const url = buildUrl(endpoint, paramsRef.current);
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json() as T;

      if (!mountedRef.current) return;

      const entry: CacheEntry<T> = {
        data: json,
        timestamp: Date.now(),
        params: paramsKey,
      };

      cache.set(cacheKey, entry);
      setData(json);
      setError(null);
      setLastUpdated(new Date(entry.timestamp).toISOString());
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!mountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Failed to fetch';
      setError(message);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
    // Depend on paramsKey (stable string) not params (unstable object reference)
  }, [cache, cacheKey, endpoint, paramsKey]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchData]);

  return { data, isLoading, isRefreshing, error, lastUpdated };
}

// ─── Prefetch utility ────────────────────────────────────────────────────────

export function useAnalyticsPrefetch() {
  const cache = useContext(AnalyticsCacheContext);
  if (!cache) {
    throw new Error('useAnalyticsPrefetch must be used within an AnalyticsCacheProvider');
  }

  return useCallback(
    (endpoint: string, params: Record<string, string>) => {
      cache.prefetch(endpoint, params);
    },
    [cache]
  );
}
