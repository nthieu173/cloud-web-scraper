import { SCRAPE_PATH, type ScrapeOutcome, readScrapeResponse } from "./wire";

/** Asks the Worker for a page's media links. Never rejects. */
export async function scrapeMedia(url: string): Promise<ScrapeOutcome> {
  let response: Response;
  try {
    response = await fetch(SCRAPE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { ok: false, error: "unavailable" };
  }
  return readScrapeResponse(response);
}
