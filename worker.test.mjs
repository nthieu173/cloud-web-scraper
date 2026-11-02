// Run: node --test worker.test.mjs
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import worker from "./worker.js";

const env = {
  SCRAPER_FUNCTION_URL: "https://abc.lambda-url.ap-southeast-1.on.aws/",
  SCRAPER_SHARED_SECRET: "test-secret",
};
const realFetch = globalThis.fetch;
let upstreamRequests = [];

function stubUpstream(response) {
  upstreamRequests = [];
  globalThis.fetch = async (url, init) => {
    upstreamRequests.push({ url: String(url), init });
    return response;
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function scrapeRequest(headers = {}) {
  return new Request("https://scraper.wizllc.org/scrape/media", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: "url=https%3A%2F%2Fexample.com",
  });
}

test("forwards the scrape with the shared secret and only allowed headers", async () => {
  stubUpstream(new Response("<article></article>", { headers: { "content-type": "text/html", "set-cookie": "a=b" } }));

  const response = await worker.fetch(
    scrapeRequest({ "hx-request": "true", cookie: "session=1", "x-scraper-secret": "forged" }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<article></article>");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(upstreamRequests.length, 1);
  const { url, init } = upstreamRequests[0];
  assert.equal(url, "https://abc.lambda-url.ap-southeast-1.on.aws/scrape/media");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.get("x-scraper-secret"), "test-secret");
  assert.equal(init.headers.get("hx-request"), "true");
  assert.equal(init.headers.get("cookie"), null);
  assert.equal(await new Response(init.body).text(), "url=https%3A%2F%2Fexample.com");
});

test("passes upstream errors through", async () => {
  stubUpstream(new Response("bad gateway", { status: 502, headers: { "content-type": "text/html" } }));
  const response = await worker.fetch(scrapeRequest(), env);
  assert.equal(response.status, 502);
});

test("rejects other paths and methods without calling the Lambda", async () => {
  stubUpstream(new Response("unexpected"));
  const other = await worker.fetch(new Request("https://scraper.wizllc.org/scrape/other", { method: "POST" }), env);
  const get = await worker.fetch(new Request("https://scraper.wizllc.org/scrape/media"), env);
  assert.equal(other.status, 404);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal(upstreamRequests.length, 0);
});
