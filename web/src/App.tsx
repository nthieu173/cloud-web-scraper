import { type JSX, type SubmitEvent, startTransition, useActionState } from "react";

import { CACHE_MAX_AGE_MS, RESCRAPE_AFTER_MS, cacheScrape, cachedScrape } from "./api/cache";
import { scrapeMedia } from "./api/client";
import { type ErrorCode, type ScrapeOutcome, parseWebsiteUrl } from "./api/wire";
import { mediaName } from "./mediaName";

interface Scrape {
  /** The normalized URL, or the input as typed when it is invalid; unique in the list. */
  readonly key: string;
  /** The URL as typed. */
  readonly url: string;
  readonly outcome: ScrapeOutcome;
}

const UNAVAILABLE = "The scraper is unavailable right now. Try again later.";

const MESSAGES: Record<ErrorCode, string> = {
  invalid_url: "Only http and https URLs can be scraped.",
  unreachable: "This website could not be reached.",
  not_html: "This URL is not a web page.",
  too_large: "This page is too large to scrape.",
  forbidden: UNAVAILABLE,
  not_found: UNAVAILABLE,
  invalid_request: UNAVAILABLE,
  unavailable: UNAVAILABLE,
};

/**
 * Newest first, each page once; a repeated page moves to the top. The cache
 * answers a page already in the list for an hour, and any other page for a
 * week; after that the page is scraped again.
 */
async function scrape(previous: readonly Scrape[], input: string): Promise<readonly Scrape[]> {
  const url = input.trim();
  const parsed = parseWebsiteUrl(url);
  const key = parsed?.href ?? url;
  const rest = previous.filter((entry) => entry.key !== key);
  if (parsed === undefined) {
    return [{ key, url, outcome: { ok: false, error: "invalid_url" } }, ...rest];
  }
  const listed = rest.length !== previous.length;
  const cached = cachedScrape(parsed, Date.now(), listed ? RESCRAPE_AFTER_MS : CACHE_MAX_AGE_MS);
  if (cached !== undefined) {
    return [{ key, url, outcome: { ok: true, result: cached.result } }, ...rest];
  }
  const outcome = await scrapeMedia(url);
  if (outcome.ok) {
    cacheScrape(parsed, outcome.result, Date.now());
  }
  return [{ key, url, outcome }, ...rest];
}

function ScrapePanel({ scrape: { url, outcome } }: { readonly scrape: Scrape }): JSX.Element {
  if (!outcome.ok) {
    return (
      <article className="panel panel-error">
        <h2>{url}</h2>
        <p role="alert">{MESSAGES[outcome.error]}</p>
      </article>
    );
  }
  const { links } = outcome.result;
  return (
    <article className="panel">
      <h2>{url}</h2>
      {links.length === 0 ? (
        <p>No audio or video links found.</p>
      ) : (
        <ul>
          {links.map((link) => {
            const name = mediaName(link);
            return (
              <li key={link}>
                <a href={link} target="_blank" rel="noopener noreferrer" download={name}>
                  {name}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

export default function App(): JSX.Element {
  const [scrapes, dispatch, pending] = useActionState(scrape, []);

  // Dispatched from onSubmit rather than passed as the form's action, so React
  // does not reset the form and the URL stays for editing.
  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("url");
    startTransition(() => {
      dispatch(typeof input === "string" ? input : "");
    });
  }

  return (
    <>
      <header className="site-header">
        <img src="/seal-fishing.png" alt="" width="40" height="40" />
        <span>Website Media Scraper</span>
      </header>
      <main>
        <h1>Paste the URL of the website you want to scrape</h1>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={pending}>
            <label htmlFor="website-url">URL</label>
            <div className="field">
              <input id="website-url" name="url" type="url" required placeholder="https://example.com" />
              <button type="submit" aria-busy={pending}>
                {pending ? "Scraping…" : "Scrape"}
              </button>
            </div>
          </fieldset>
        </form>
        <section aria-label="Results" className="results">
          {scrapes.map((entry) => (
            <ScrapePanel key={entry.key} scrape={entry} />
          ))}
        </section>
      </main>
    </>
  );
}
