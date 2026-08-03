'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LoaderCircle, Search, UserRoundSearch } from 'lucide-react';
import { customerDetailHref } from '@/lib/customer-links';
import type { CustomerSearchResult } from '@/types/mixpanel';

interface CustomerSearchError {
  error?: string;
}

export default function CustomerSearch() {
  const router = useRouter();
  const activeRequest = useRef<AbortController | null>(null);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    return () => activeRequest.current?.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchError('Enter a customer UID or email address.');
      return;
    }

    if (isSearching) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsSearching(true);
    setSearchError(null);

    try {
      const response = await fetch(
        `/api/rc/customer-search?q=${encodeURIComponent(normalizedQuery)}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      const payload = (await response.json().catch(() => ({}))) as
        | CustomerSearchResult
        | CustomerSearchError;

      if (!response.ok) {
        const fallback =
          response.status === 404
            ? `No customer found for “${normalizedQuery}”.`
            : 'Customer lookup failed. Please try again.';
        setSearchError('error' in payload && payload.error ? payload.error : fallback);
        return;
      }

      const uid = 'uid' in payload ? payload.uid?.trim() : '';
      if (!uid) {
        setSearchError('The customer record did not include a UID.');
        return;
      }

      router.push(customerDetailHref(uid));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setSearchError('Customer lookup failed. Check your connection and try again.');
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsSearching(false);
      }
    }
  }

  return (
    <section className="card-animate card-surface relative overflow-hidden p-5 sm:p-7 mb-8">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-ember" aria-hidden="true" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-chip border border-ember/20 bg-ember-tint text-ember-deep">
            <UserRoundSearch className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-xl text-ink">Find a customer</h2>
            <p className="mt-1 max-w-lg text-sm text-ink-soft">
              Look up an account across customer records by its exact UID or email address.
            </p>
          </div>
        </div>

        <form
          className="w-full lg:max-w-xl"
          onSubmit={handleSubmit}
          aria-busy={isSearching}
        >
          <label htmlFor="customer-search" className="sr-only">
            Customer UID or email address
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <input
                id="customer-search"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (searchError) setSearchError(null);
                }}
                placeholder="UID or customer@example.com"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={320}
                aria-describedby={searchError ? 'customer-search-error' : 'customer-search-hint'}
                aria-invalid={searchError ? true : undefined}
                className="input-paper h-11 w-full pl-10 pr-4 text-sm font-mono placeholder:text-ink-faint outline-none transition-colors focus:border-lake"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-chip bg-ember px-5 text-sm font-semibold text-white shadow-sm transition-[background-color,transform,opacity] hover:bg-ember-deep active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Finding…
                </>
              ) : (
                <>
                  Open customer
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
          {searchError ? (
            <p
              id="customer-search-error"
              role="alert"
              className="mt-2 text-sm text-ember-deep"
            >
              {searchError}
            </p>
          ) : (
            <p id="customer-search-hint" className="mt-2 text-xs font-mono text-ink-faint">
              Email matching is case-insensitive. UID matching is exact.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
