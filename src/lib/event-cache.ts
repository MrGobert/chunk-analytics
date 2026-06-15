import { MixpanelEvent } from '@/types/mixpanel';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TTL = 5 * 60 * 1000; // 5 minutes (default — fresh windows)
const LOCK_MAX_AGE = 5 * 60 * 1000; // 5 minutes — stale locks are auto-cleaned

// How long a concurrent caller waits for the lock-holder's fetch before giving up.
// A cold full export (~39MB over 30+ days) can take 30-45s; the wait MUST exceed
// that so simultaneous callers (e.g. the Engagement page's 4 full-export requests)
// share the single in-flight fetch instead of timing out to an empty "no data"
// response. Kept under the routes' 60s maxDuration. Stuck locks are still cleared
// by LOCK_MAX_AGE, so a longer wait can't hang on a crashed worker.
const LOCK_WAIT_MS = 50 * 1000;
const LOCK_POLL_INTERVAL = 500;

// In addition to memory cache (for same worker), use temp directory cache
const eventCache = new Map<string, { events: MixpanelEvent[]; timestamp: number }>();

/**
 * Cache key. `variant` distinguishes event-filtered fetches (a short hash of the
 * requested event names) from the full unfiltered export; empty string = full export
 * so existing full-export callers keep their original key shape.
 */
function buildKey(fromDate: string, toDate: string, variant = ''): string {
  return variant ? `${fromDate}_${toDate}_${variant}` : `${fromDate}_${toDate}`;
}

function getCacheFilePath(key: string): string {
  return path.join(os.tmpdir(), `chunk_analytics_cache_${key}.json`);
}

function getLockFilePath(key: string): string {
  return path.join(os.tmpdir(), `chunk_analytics_cache_${key}.lock`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Asynchronous event fetching that supports file locking
export async function getCachedEventsAsync(
  fromDate: string,
  toDate: string,
  variant = '',
  ttl: number = TTL
): Promise<MixpanelEvent[] | null> {
  const key = buildKey(fromDate, toDate, variant);

  // 1. Check Memory Cache. A filtered fetch can legitimately be empty (rare event
  //    over a short window), so an empty cached array is still a valid hit.
  const memoryCached = eventCache.get(key);
  if (memoryCached && Date.now() - memoryCached.timestamp <= ttl) {
    return memoryCached.events;
  }

  // 2. Wait for Lock if another worker is currently downloading the file
  const lockFile = getLockFilePath(key);
  // Clean up stale lock files from crashed workers
  if (fs.existsSync(lockFile)) {
    try {
      const lockStat = fs.statSync(lockFile);
      if (Date.now() - lockStat.mtimeMs > LOCK_MAX_AGE) {
        console.warn(`Removing stale lock file (age: ${Math.round((Date.now() - lockStat.mtimeMs) / 1000)}s): ${lockFile}`);
        fs.unlinkSync(lockFile);
      }
    } catch { /* lock was already removed */ }
  }
  let trys = 0;
  const maxTrys = Math.ceil(LOCK_WAIT_MS / LOCK_POLL_INTERVAL);
  while (fs.existsSync(lockFile) && trys < maxTrys) {
    await sleep(LOCK_POLL_INTERVAL); // Poll while the lock-holder fetches
    trys++;
  }

  // 3. Check Disk Cache
  const diskFile = getCacheFilePath(key);
  if (fs.existsSync(diskFile)) {
    try {
      const stat = fs.statSync(diskFile);
      if (Date.now() - stat.mtimeMs <= ttl) {
        const data = fs.readFileSync(diskFile, 'utf8');
        const parsed = JSON.parse(data) as MixpanelEvent[];
        // Populate memory cache for this worker
        eventCache.set(key, { events: parsed, timestamp: Date.now() });
        return parsed;
      }
    } catch (e) {
      console.error('Error reading disk cache', e);
    }
  }

  return null;
}

export async function getStaleCachedEvents(fromDate: string, toDate: string, variant = ''): Promise<MixpanelEvent[] | null> {
  const key = buildKey(fromDate, toDate, variant);
  const diskFile = getCacheFilePath(key);

  // Return disk cache regardless of TTL, to prevent page crashes during 429 rate limits
  if (fs.existsSync(diskFile)) {
    try {
      const data = fs.readFileSync(diskFile, 'utf8');
      const parsed = JSON.parse(data) as MixpanelEvent[];
      return parsed;
    } catch (e) {
      console.error('Error reading STALE disk cache', e);
    }
  }
  return null;
}

export function acquireLock(fromDate: string, toDate: string, variant = ''): boolean {
  const key = buildKey(fromDate, toDate, variant);
  const lockFile = getLockFilePath(key);

  if (fs.existsSync(lockFile)) {
    // Allow stealing stale locks from crashed workers
    try {
      const lockStat = fs.statSync(lockFile);
      if (Date.now() - lockStat.mtimeMs > LOCK_MAX_AGE) {
        console.warn(`Stealing stale lock (age: ${Math.round((Date.now() - lockStat.mtimeMs) / 1000)}s): ${lockFile}`);
        fs.unlinkSync(lockFile);
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  try {
    fs.writeFileSync(lockFile, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch {
    return false; // Someone else created it first
  }
}

export function releaseLock(fromDate: string, toDate: string, variant = ''): void {
  const key = buildKey(fromDate, toDate, variant);
  const lockFile = getLockFilePath(key);
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch { }
  }
}

export async function setCachedEventsAsync(fromDate: string, toDate: string, events: MixpanelEvent[], variant = ''): Promise<void> {
  // A full export is never legitimately empty, so an empty result there means a
  // soft failure — don't cache it. A filtered fetch (variant set) CAN be empty
  // (rare event over a short window); caching it avoids re-hitting the export on
  // every request. Errors throw before reaching here, so empty == real result.
  if (events.length === 0 && variant === '') {
    console.warn(`Skipping cache write for ${fromDate}:${toDate} — empty full export`);
    return;
  }

  const key = buildKey(fromDate, toDate, variant);
  const diskFile = getCacheFilePath(key);

  // Set memory
  eventCache.set(key, { events, timestamp: Date.now() });

  // Set disk
  try {
    fs.writeFileSync(diskFile, JSON.stringify(events), 'utf8');
  } catch (e) {
    console.error('Failed to write disk cache', e);
  }
}
