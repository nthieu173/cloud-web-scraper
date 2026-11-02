/**
 * The scrape API's wire shapes, shared by the page and the Worker. The Lambda
 * in `src/main.rs` (repository root) writes the same JSON.
 *
 * Every payload arrives as `unknown` and is validated completely before use;
 * ESLint forbids `JSON.parse` outside `parseJson` so nothing skips that.
 */

export const SCRAPE_PATH = "/scrape/media";

/**
 * The Lambda's error codes, plus `unavailable`, which the Worker and the page
 * use when the Lambda itself fails or answers with something unexpected.
 */
const ERROR_STATUSES = {
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  invalid_url: 400,
  unreachable: 502,
  not_html: 502,
  too_large: 502,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUSES;

export interface ScrapeRequest {
  readonly url: string;
}

export interface ScrapeResult {
  /** The page's final URL, after redirects. */
  readonly url: string;
  /** Absolute http(s) URLs of the page's audio and video files, in page order. */
  readonly links: readonly string[];
}

export type ScrapeOutcome =
  | { readonly ok: true; readonly result: ScrapeResult }
  | { readonly ok: false; readonly error: ErrorCode };

export function statusOf(error: ErrorCode): number {
  return ERROR_STATUSES[error];
}

/** `typeof` alone also admits `null` and arrays. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_STATUSES, value);
}

/** Parses JSON text as `unknown`, or `undefined` if it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Only absolute http(s) URLs with a host may be scraped or linked to. */
export function parseWebsiteUrl(input: string): URL | undefined {
  const url = URL.parse(input.trim());
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") {
    return undefined;
  }
  return url;
}

export function decodeScrapeRequest(value: unknown): ScrapeRequest | undefined {
  return isRecord(value) && typeof value["url"] === "string" ? { url: value["url"] } : undefined;
}

/** Links that are not http(s) URLs fail the whole result: they would be clickable. */
export function decodeScrapeResult(value: unknown): ScrapeResult | undefined {
  if (!isRecord(value) || typeof value["url"] !== "string" || !Array.isArray(value["links"])) {
    return undefined;
  }
  const links: string[] = [];
  for (const link of value["links"]) {
    if (typeof link !== "string" || parseWebsiteUrl(link) === undefined) {
      return undefined;
    }
    links.push(link);
  }
  return { url: value["url"], links };
}

/** Reads a scrape response, mapping anything malformed to `unavailable`. */
export async function readScrapeResponse(response: Response): Promise<ScrapeOutcome> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: "unavailable" };
  }
  if (response.ok) {
    const result = decodeScrapeResult(payload);
    return result === undefined ? { ok: false, error: "unavailable" } : { ok: true, result };
  }
  const error = isRecord(payload) ? payload["error"] : undefined;
  return { ok: false, error: isErrorCode(error) ? error : "unavailable" };
}
