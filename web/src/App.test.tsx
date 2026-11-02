import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";

function stubWorker(...responses: Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const worker = vi.fn<typeof fetch>();
  for (const response of responses) {
    worker.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", worker);
  return worker;
}

async function submit(url: string): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByLabelText("URL");
  await user.clear(input);
  await user.type(input, url);
  await user.click(screen.getByRole("button", { name: "Scrape" }));
}

test("lists a page's media links, newest page first", async () => {
  const worker = stubWorker(
    Response.json({ url: "https://a.example/", links: ["https://a.example/My%20Song.mp3"] }),
    Response.json({ url: "https://b.example/", links: [] }),
  );
  render(<App />);

  await submit("https://a.example");
  const link = await screen.findByRole("link", { name: "My Song.mp3" });
  expect(link).toHaveAttribute("href", "https://a.example/My%20Song.mp3");
  expect(link).toHaveAttribute("download", "My Song.mp3");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(worker).toHaveBeenCalledWith("/scrape/media", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ url: "https://a.example" }),
  }));
  // The URL stays in the field for editing.
  expect(screen.getByLabelText("URL")).toHaveValue("https://a.example");

  await submit("https://b.example");
  await screen.findByText("No audio or video links found.");
  const panels = within(screen.getByRole("region", { name: "Results" })).getAllByRole("heading");
  expect(panels.map((heading) => heading.textContent)).toEqual(["https://b.example", "https://a.example"]);
});

test("shows the error for a failed scrape", async () => {
  stubWorker(Response.json({ error: "too_large" }, { status: 502 }));
  render(<App />);
  await submit("https://big.example");
  expect(await screen.findByRole("alert")).toHaveTextContent("This page is too large to scrape.");
});

test("reports an unreachable Worker", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));
  render(<App />);
  await submit("https://a.example");
  expect(await screen.findByRole("alert")).toHaveTextContent("The scraper is unavailable");
});

test("refuses non-http URLs without a request", async () => {
  const worker = stubWorker();
  render(<App />);
  await submit("ftp://a.example/file.mp3");
  expect(await screen.findByRole("alert")).toHaveTextContent("Only http and https URLs can be scraped.");
  expect(worker).not.toHaveBeenCalled();
});

test("disables the form while a scrape is pending", async () => {
  let respond: (response: Response) => void = () => undefined;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Promise<Response>((resolve) => {
    respond = resolve;
  })));
  render(<App />);

  await submit("https://a.example");
  expect(await screen.findByRole("button", { name: "Scraping…" })).toBeDisabled();
  expect(screen.getByLabelText("URL")).toBeDisabled();

  respond(Response.json({ url: "https://a.example/", links: [] }));
  expect(await screen.findByRole("button", { name: "Scrape" })).toBeEnabled();
});

test("answers a repeat scrape from this browser's cache until asked to scrape again", async () => {
  const worker = stubWorker(
    Response.json({ url: "https://a.example/", links: ["https://a.example/old.mp3"] }),
    Response.json({ url: "https://a.example/", links: ["https://a.example/new.mp3"] }),
  );
  render(<App />);

  await submit("https://a.example");
  await screen.findByRole("link", { name: "old.mp3" });
  expect(screen.queryByText(/^Cached from/u)).toBeNull();

  await submit("https://a.example/");
  expect(await screen.findByText(/^Cached from/u)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "old.mp3" })).toHaveLength(2);
  expect(worker).toHaveBeenCalledOnce();

  await userEvent.setup().click(screen.getByRole("button", { name: "Scrape again" }));
  expect(await screen.findByRole("link", { name: "new.mp3" })).toBeInTheDocument();
  expect(worker).toHaveBeenCalledTimes(2);

  // The fresh result replaced the cached one.
  await submit("https://a.example");
  expect(await screen.findAllByRole("link", { name: "new.mp3" })).toHaveLength(2);
  expect(worker).toHaveBeenCalledTimes(2);
});

test("does not cache errors", async () => {
  const worker = stubWorker(
    Response.json({ error: "unreachable" }, { status: 502 }),
    Response.json({ url: "https://a.example/", links: [] }),
  );
  render(<App />);
  await submit("https://a.example");
  await screen.findByRole("alert");
  await submit("https://a.example");
  await screen.findByText("No audio or video links found.");
  expect(worker).toHaveBeenCalledTimes(2);
});
