// @vitest-environment node

import worker, { type Env } from "./index";

const env: Env = {
  SCRAPER_FUNCTION_URL: "https://abc.lambda-url.ap-southeast-1.on.aws/",
  SCRAPER_SHARED_SECRET: "test-secret",
};

function stubLambda(response: Response): ReturnType<typeof vi.fn<typeof fetch>> {
  const lambda = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", lambda);
  return lambda;
}

function scrapeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://scraper.wizllc.org/scrape/media", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("forwards a valid scrape with the shared secret and nothing of the visitor's", async () => {
  const lambda = stubLambda(
    Response.json(
      { url: "https://example.com/", links: ["https://example.com/a.mp3"] },
      { headers: { "set-cookie": "a=b" } },
    ),
  );

  const response = await worker.fetch(
    scrapeRequest({ url: " https://example.com " }, { cookie: "session=1", "x-scraper-secret": "forged" }),
    env,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ url: "https://example.com/", links: ["https://example.com/a.mp3"] });

  expect(lambda).toHaveBeenCalledOnce();
  const [url, init] = lambda.mock.calls[0] ?? [];
  expect(url).toEqual(new URL("https://abc.lambda-url.ap-southeast-1.on.aws/scrape/media"));
  const headers = new Headers(init?.headers);
  expect(headers.get("x-scraper-secret")).toBe("test-secret");
  expect(headers.get("cookie")).toBeNull();
  expect(init?.body).toBe(JSON.stringify({ url: "https://example.com/" }));
});

test("passes the Lambda's error codes through", async () => {
  stubLambda(Response.json({ error: "too_large" }, { status: 502 }));
  const response = await worker.fetch(scrapeRequest({ url: "https://example.com" }), env);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "too_large" });
});

test.each([
  ["a runtime error", Response.json({ Message: "Internal Server Error" }, { status: 502 })],
  ["a non-JSON body", new Response("<html>", { status: 200 })],
  ["a script link", Response.json({ url: "https://example.com/", links: ["javascript:alert(1)//a.mp3"] })],
])("reports the Lambda as unavailable for %s", async (_, upstream) => {
  stubLambda(upstream);
  const response = await worker.fetch(scrapeRequest({ url: "https://example.com" }), env);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "unavailable" });
});

test("reports the Lambda as unavailable when it cannot be reached", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("network"))));
  const response = await worker.fetch(scrapeRequest({ url: "https://example.com" }), env);
  expect(response.status).toBe(503);
});

test.each([
  { name: "a file URL", body: { url: "file:///etc/passwd" }, error: "invalid_url" },
  { name: "a bare host", body: { url: "example.com" }, error: "invalid_url" },
  { name: "a missing URL", body: { link: "https://example.com" }, error: "invalid_request" },
])("rejects $name without calling the Lambda", async ({ body, error }) => {
  const lambda = stubLambda(Response.json({}));
  const response = await worker.fetch(scrapeRequest(body), env);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error });
  expect(lambda).not.toHaveBeenCalled();
});

test("rejects other paths and methods without calling the Lambda", async () => {
  const lambda = stubLambda(Response.json({}));
  const other = await worker.fetch(new Request("https://scraper.wizllc.org/scrape/other", { method: "POST" }), env);
  const get = await worker.fetch(new Request("https://scraper.wizllc.org/scrape/media"), env);
  const malformed = await worker.fetch(
    new Request("https://scraper.wizllc.org/scrape/media", { method: "POST", body: "url=x" }),
    env,
  );
  expect(other.status).toBe(404);
  expect(get.status).toBe(405);
  expect(get.headers.get("allow")).toBe("POST");
  expect(malformed.status).toBe(400);
  expect(lambda).not.toHaveBeenCalled();
});
