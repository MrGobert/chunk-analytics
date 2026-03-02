import { MixpanelEvent } from '@/types/mixpanel';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TTL = 5 * 60 * 1000; // 5 minutes

// In addition to memory cache (for same worker), use temp directory cache
const eventCache = new Map<string, { events: MixpanelEvent[]; timestamp: number }>();

function buildKey(fromDate: string, toDate: string): string {
  return `${fromDate}_${toDate}`;
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
export async function getCachedEventsAsync(fromDate: string, toDate: string): Promise<MixpanelEvent[] | null> {
  const key = buildKey(fromDate, toDate);

  // 1. Check Memory Cache
  const memoryCached = eventCache.get(key);
  if (memoryCached && Date.now() - memoryCached.timestamp <= TTL) {
    return memoryCached.events;
  }

  // 2. Wait for Lock if another worker is currently downloading the 39MB file
  const lockFile = getLockFilePath(key);
  let trys = 0;
  while (fs.existsSync(lockFile) && trys < 60) {
    await sleep(500); // Poll every 500ms
    trys++;
  }

  // 3. Check Disk Cache
  const diskFile = getCacheFilePath(key);
  if (fs.existsSync(diskFile)) {
    try {
      const stat = fs.statSync(diskFile);
      if (Date.now() - stat.mtimeMs <= TTL) {
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

export async function getStaleCachedEvents(fromDate: string, toDate: string): Promise<MixpanelEvent[] | null> {
  const key = buildKey(fromDate, toDate);
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

export function acquireLock(fromDate: string, toDate: string): boolean {
  const key = buildKey(fromDate, toDate);
  const lockFile = getLockFilePath(key);
  if (fs.existsSync(lockFile)) return false;

  try {
    fs.writeFileSync(lockFile, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch {
    return false; // Someone else created it first
  }
}

export function releaseLock(fromDate: string, toDate: string): void {
  const key = buildKey(fromDate, toDate);
  const lockFile = getLockFilePath(key);
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch { }
  }
}

export async function setCachedEventsAsync(fromDate: string, toDate: string, events: MixpanelEvent[]): Promise<void> {
  const key = buildKey(fromDate, toDate);
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
