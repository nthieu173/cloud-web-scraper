import { decodeScrapeResult, parseWebsiteUrl, readScrapeResponse } from "./wire";

test("only absolute http(s) URLs are accepted", () => {
  expect(parseWebsiteUrl(" https://example.com/page ")?.href).toBe("https://example.com/page");
  expect(parseWebsiteUrl("http://example.com")?.href).toBe("http://example.com/");
  expect(parseWebsiteUrl("file:///etc/passwd")).toBeUndefined();
  expect(parseWebsiteUrl("ftp://example.com/a.mp3")).toBeUndefined();
  expect(parseWebsiteUrl("example.com")).toBeUndefined();
});

test("a result decodes only with string URLs and http(s) links", () => {
  const result = { url: "https://example.com/", links: ["https://example.com/a.mp3"] };
  expect(decodeScrapeResult(result)).toEqual(result);
  expect(decodeScrapeResult({ ...result, links: ["data:audio/mp3,x"] })).toBeUndefined();
  expect(decodeScrapeResult({ ...result, links: [1] })).toBeUndefined();
  expect(decodeScrapeResult({ url: 1, links: [] })).toBeUndefined();
  expect(decodeScrapeResult([])).toBeUndefined();
  expect(decodeScrapeResult(null)).toBeUndefined();
});

test("responses map to outcomes", async () => {
  await expect(readScrapeResponse(Response.json({ url: "https://a.example/", links: [] }))).resolves.toEqual({
    ok: true,
    result: { url: "https://a.example/", links: [] },
  });
  await expect(readScrapeResponse(Response.json({ error: "not_html" }, { status: 502 }))).resolves.toEqual({
    ok: false,
    error: "not_html",
  });
  await expect(readScrapeResponse(Response.json({ error: "toString" }, { status: 500 }))).resolves.toEqual({
    ok: false,
    error: "unavailable",
  });
  await expect(readScrapeResponse(new Response("Bad Gateway", { status: 502 }))).resolves.toEqual({
    ok: false,
    error: "unavailable",
  });
});
