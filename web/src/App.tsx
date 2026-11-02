import { type JSX, type SubmitEvent, startTransition, useActionState } from "react";

import { scrapeMedia } from "./api/client";
import { type ErrorCode, type ScrapeOutcome, parseWebsiteUrl } from "./api/wire";
import { mediaName } from "./mediaName";

interface Scrape {
  readonly id: number;
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

/** Newest first. The list only grows, so its length is a fresh key. */
async function scrape(previous: readonly Scrape[], form: FormData): Promise<readonly Scrape[]> {
  const input = form.get("url");
  const url = typeof input === "string" ? input.trim() : "";
  const outcome: ScrapeOutcome =
    parseWebsiteUrl(url) === undefined ? { ok: false, error: "invalid_url" } : await scrapeMedia(url);
  return [{ id: previous.length, url, outcome }, ...previous];
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
    const form = new FormData(event.currentTarget);
    startTransition(() => {
      dispatch(form);
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
            <ScrapePanel key={entry.id} scrape={entry} />
          ))}
        </section>
      </main>
    </>
  );
}
