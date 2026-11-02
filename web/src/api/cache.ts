/**
 * Successful scrapes, kept in this browser's localStorage so scraping a page
 * again within a week costs no request. Errors are never kept.
 *
 * Storage is best-effort: private windows, blocked storage or a full quota
 * leave the page working without a cache.
 */

import { type ScrapeResult, decodeScrapeResult, isRecord, parseJson } from "./wire";

/** Safari clears a site's storage after 7 days without a visit anyway. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Results are a few kilobytes each, far inside the ~5 MB per-site quota. */
export const CACHE_MAX_ENTRIES = 50;

const STORAGE_KEY = "cloud-web-scraper:scrapes";

export interface CachedScrape {
  /** The normalized URL that was scraped; the cache key. */
  readonly url: string;
  /** When the scrape finished, in milliseconds since the epoch. */
  readonly scrapedAt: number;
  readonly result: ScrapeResult;
}

function decodeEntry(value: unknown): CachedScrape | undefined {
  if (!isRecord(value) || typeof value["url"] !== "string" || typeof value["scrapedAt"] !== "number") {
    return undefined;
  }
  const result = decodeScrapeResult(value["result"]);
  return result === undefined ? undefined : { url: value["url"], scrapedAt: value["scrapedAt"], result };
}

/** Unexpired entries, newest first. Unreadable storage counts as empty. */
function load(now: number): CachedScrape[] {
  let text: string | null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  const value = text === null ? undefined : parseJson(text);
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: readonly unknown[] = value;
  return entries.flatMap((item) => {
    const entry = decodeEntry(item);
    return entry !== undefined && now - entry.scrapedAt < CACHE_MAX_AGE_MS ? [entry] : [];
  });
}

export function cachedScrape(url: URL, now: number): CachedScrape | undefined {
  return load(now).find((entry) => entry.url === url.href);
}

/** Stores a result, dropping expired entries and the oldest beyond the limit. */
export function cacheScrape(url: URL, result: ScrapeResult, now: number): void {
  const entries = [
    { url: url.href, scrapedAt: now, result },
    ...load(now).filter((entry) => entry.url !== url.href),
  ].slice(0, CACHE_MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Blocked storage or a full quota: this result just isn't cached.
  }
}
