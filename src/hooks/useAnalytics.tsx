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
const SESSION_STORAGE_KEY = 'chunk-analytics-cache';
const MAX_CACHE_AGE = 30 * 60 * 1000; // 30 minutes max — discard anything older
const FETCH_TIMEOUT = 30_000; // 30s client-side fetch timeout — prevents indefinite skeleton on Vercel 504s

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

function loadCacheFromSession(): Map<string, CacheEntry<unknown>> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as [string, CacheEntry<unknown>][];
    const now = Date.now();
    // Filter out entries older than MAX_CACHE_AGE
    const valid = parsed.filter(([, entry]) => now - entry.timestamp < MAX_CACHE_AGE);
    return new Map(valid);
  } catch {
    return new Map();
  }
}

function saveCacheToSession(cache: Map<string, CacheEntry<unknown>>): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Array.from(cache.entries());
    // Only persist the 50 most recent entries to keep sessionStorage small
    const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, 50);
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

export function AnalyticsCacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry<unknown>>>(loadCacheFromSession());

  const cacheValue = useRef<AnalyticsCache>({
    get<T>(key: string): CacheEntry<T> | undefined {
      return cacheRef.current.get(key) as CacheEntry<T> | undefined;
    },
    set<T>(key: string, entry: CacheEntry<T>): void {
      cacheRef.current.set(key, entry as CacheEntry<unknown>);
      saveCacheToSession(cacheRef.current);
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

let globalIsHydrated = false;

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

  // Check cache for initial state (exact match)
  const cached = cache.get<T>(cacheKey);
  const isFresh = cached ? Date.now() - cached.timestamp < STALE_TIME : false;

  // Find any cached data for this endpoint (any params) to show while loading new params.
  // This prevents the UI going blank when switching e.g. 30d → 7d.
  const endpointPrefix = `${endpoint}:`;
  const fallbackData = (() => {
    if (cached?.data) return cached.data;
    // Search all cache entries for this endpoint
    const allEntries = (cache as unknown as { get: (k: string) => CacheEntry<T> | undefined });
    // We store entries by key, so iterate via the provider's internal map
    // Use a ref-based approach: try the most common param variations
    for (const fallbackDays of ['30', '7', '90']) {
      const fallbackKey = buildCacheKey(endpoint, { ...params, days: fallbackDays });
      const fallback = cache.get<T>(fallbackKey);
      if (fallback?.data) return fallback.data;
    }
    return null;
  })();

  const [data, setData] = useState<T | null>(globalIsHydrated ? fallbackData : null);
  // Only show full loading skeleton if we have NO data at all (not even stale/fallback) or if we are hydrating
  const [isLoading, setIsLoading] = useState(globalIsHydrated ? !fallbackData : true);
  // Show refreshing indicator when we have data but are fetching fresh data
  const [isRefreshing, setIsRefreshing] = useState(globalIsHydrated ? (fallbackData ? !isFresh : false) : false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(
    globalIsHydrated && cached ? new Date(cached.timestamp).toISOString() : ''
  );

  // Track in-flight requests to avoid duplicates
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Keep a stable ref to params so the callback doesn't depend on the object reference
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // Keep a stable ref to data to avoid stale closure in fetchData
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    mountedRef.current = true;

    // If this is the initial hydration pass, we need to sync state with the cache
    // now that we are safely on the client to avoid SSR mismatch.
    if (!globalIsHydrated) {
      globalIsHydrated = true;
      setData(fallbackData);
      setIsLoading(!fallbackData);
      setIsRefreshing(fallbackData ? !isFresh : false);
      setLastUpdated(cached ? new Date(cached.timestamp).toISOString() : '');
    }

    return () => {
      mountedRef.current = false;
    };
    // We intentionally don't put fallbackData in the dep array because we only want 
    // this specific block to run once upon mount (hydration sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // No exact cache match — but we might have fallback data from different params
      // Keep whatever data we have, just mark as refreshing (not full loading)
      setIsRefreshing(true);
      if (!dataRef.current) {
        // Truly no data at all — first ever load
        setIsLoading(true);
        setIsRefreshing(false);
      }
    }

    // Auto-abort after FETCH_TIMEOUT to prevent indefinite skeleton loading
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const url = buildUrl(endpoint, paramsRef.current);
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json() as T;

      if (!mountedRef.current) return;

      // Check if the server returned partial data (e.g., 7d fallback for a 30d request)
      // Show the partial data immediately, then auto-retry for the full range
      const isPartial = (json as Record<string, unknown>)?.partial === true;

      if (!isPartial) {
        // Full data — cache it normally
        const entry: CacheEntry<T> = {
          data: json,
          timestamp: Date.now(),
          params: paramsKey,
        };
        cache.set(cacheKey, entry);
      }

      setData(json);
      setError(null);
      setLastUpdated(new Date().toISOString());

      // If partial, schedule a retry after a delay to get the full data
      // The server-side cache should be warm by then
      if (isPartial && mountedRef.current) {
        setIsRefreshing(true);
        setTimeout(() => {
          if (mountedRef.current && abortRef.current === controller) {
            fetchData();
          }
        }, 15_000); // Retry after 15s — gives server cache time to warm
        return; // Don't clear isRefreshing yet
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      // Distinguish between user-initiated aborts (param change / unmount) and timeouts
      if (err instanceof DOMException && err.name === 'AbortError') {
        // If this controller is still the current one, it was a timeout (not a param change)
        if (abortRef.current === controller) {
          setError('Request timed out. Try a shorter date range.');
          // Keep showing stale data on timeout — don't clear it
        }
        return;
      }

      const message = err instanceof Error ? err.message : 'Failed to fetch';
      setError(message);
      // Keep showing stale data on error — don't clear it
    } finally {
      clearTimeout(timeoutId);
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
    // Depend on paramsKey (stable string) not params (unstable object reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
