// Serves scraper.wizllc.org. Static assets answer every other path before this
// code runs; only /scrape/* reaches it (assets.config.run_worker_first).
//
// The Worker validates the request before paying for a Lambda invocation, and
// passes on only a response it has decoded, so the page never sees the
// Lambda's raw output.

import {
  type ErrorCode,
  type ScrapeResult,
  SCRAPE_PATH,
  decodeScrapeRequest,
  parseWebsiteUrl,
  readScrapeResponse,
  statusOf,
} from "../src/api/wire";

/** Bindings, set by wiz-vm's infra/modules/cloud_web_scraper. */
export interface Env {
  /** The Lambda function URL, ending in a slash. */
  readonly SCRAPER_FUNCTION_URL: string;
  /**
   * Sent as x-scraper-secret. The Lambda rejects requests without it, so its
   * public URL is useless on its own.
   */
  readonly SCRAPER_SHARED_SECRET: string;
}

function json(status: number, body: ScrapeResult | { error: ErrorCode }, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function failure(error: ErrorCode, headers?: Record<string, string>): Response {
  return json(statusOf(error), { error }, headers);
}

async function scrape(url: URL, env: Env): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(new URL(SCRAPE_PATH.slice(1), env.SCRAPER_FUNCTION_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scraper-secret": env.SCRAPER_SHARED_SECRET,
      },
      body: JSON.stringify({ url: url.href }),
      redirect: "manual",
    });
  } catch {
    return failure("unavailable");
  }
  const outcome = await readScrapeResponse(upstream);
  return outcome.ok ? json(200, outcome.result) : failure(outcome.error);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== SCRAPE_PATH) {
      return failure("not_found");
    }
    if (request.method !== "POST") {
      return json(405, { error: "invalid_request" }, { allow: "POST" });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return failure("invalid_request");
    }
    const scrapeRequest = decodeScrapeRequest(payload);
    if (scrapeRequest === undefined) {
      return failure("invalid_request");
    }
    const url = parseWebsiteUrl(scrapeRequest.url);
    return url === undefined ? failure("invalid_url") : scrape(url, env);
  },
};

export default worker;
