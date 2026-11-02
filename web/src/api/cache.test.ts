import { CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES, RESCRAPE_AFTER_MS, cacheScrape, cachedScrape } from "./cache";

const NOW = Date.UTC(2026, 10, 1);
const page = new URL("https://a.example/");
const result = { url: "https://a.example/", links: ["https://a.example/song.mp3"] };

test("returns a result until it is seven days old", () => {
  cacheScrape(page, result, NOW);
  expect(cachedScrape(new URL("https://A.example"), NOW + CACHE_MAX_AGE_MS - 1)).toEqual({
    url: "https://a.example/",
    scrapedAt: NOW,
    result,
  });
  expect(cachedScrape(page, NOW + CACHE_MAX_AGE_MS)).toBeUndefined();
});

test("can ask for a younger result", () => {
  cacheScrape(page, result, NOW);
  expect(cachedScrape(page, NOW + RESCRAPE_AFTER_MS - 1, RESCRAPE_AFTER_MS)?.result).toEqual(result);
  expect(cachedScrape(page, NOW + RESCRAPE_AFTER_MS, RESCRAPE_AFTER_MS)).toBeUndefined();
});

test("a new scrape of the same page replaces the old one", () => {
  cacheScrape(page, result, NOW);
  cacheScrape(page, { url: "https://a.example/", links: [] }, NOW + 1);
  expect(cachedScrape(page, NOW + 1)?.result.links).toEqual([]);
});

test("keeps only the most recent pages", () => {
  for (let index = 0; index <= CACHE_MAX_ENTRIES; index += 1) {
    cacheScrape(new URL(`https://a.example/${String(index)}`), result, NOW + index);
  }
  expect(cachedScrape(new URL("https://a.example/0"), NOW + CACHE_MAX_ENTRIES)).toBeUndefined();
  expect(cachedScrape(new URL("https://a.example/1"), NOW + CACHE_MAX_ENTRIES)).toBeDefined();
});

test.each([
  ["not JSON", "{"],
  ["not a list", JSON.stringify({ url: "https://a.example/" })],
  ["a script link", JSON.stringify([{ url: "https://a.example/", scrapedAt: NOW, result: { ...result, links: ["javascript:alert(1)"] } }])],
])("treats storage holding %s as empty", (_, stored) => {
  localStorage.setItem("cloud-web-scraper:scrapes", stored);
  expect(cachedScrape(page, NOW)).toBeUndefined();
  cacheScrape(page, result, NOW);
  expect(cachedScrape(page, NOW)?.result).toEqual(result);
});

test("works without storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(() => {
    cacheScrape(page, result, NOW);
  }).not.toThrow();
  expect(cachedScrape(page, NOW)).toBeUndefined();
});
