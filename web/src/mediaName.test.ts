import { mediaName } from "./mediaName";

test("names come from the last path segment", () => {
  expect(mediaName("https://example.com/shows/a.mp3")).toBe("a.mp3");
  expect(mediaName("https://example.com/My%20Song.mp3")).toBe("My Song.mp3");
  expect(mediaName("https://example.com/100%25.mp3")).toBe("100%.mp3");
  expect(mediaName("https://example.com/bad%E0%A4%A.mp3")).toBe("bad%E0%A4%A.mp3");
});
