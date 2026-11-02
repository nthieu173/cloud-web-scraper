// Serves scraper.wizllc.org. Static assets answer every other path before this
// code runs; only /scrape/* reaches it (assets.config.run_worker_first).
//
// Bindings, set by wiz-vm's infra/modules/cloud_web_scraper:
//   SCRAPER_FUNCTION_URL   the Lambda function URL, ending in a slash
//   SCRAPER_SHARED_SECRET  sent as x-scraper-secret; the Lambda rejects requests
//                          without it, so its public URL is useless on its own

const ROUTES = new Map([["/scrape/media", "POST"]]);

// Only what the scraper reads is forwarded; visitor headers stay at the edge.
const FORWARDED_HEADERS = ["content-type", "hx-request", "hx-current-url"];

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = ROUTES.get(pathname);
    if (method === undefined) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== method) {
      return new Response("Method not allowed", { status: 405, headers: { allow: method } });
    }

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }
    headers.set("x-scraper-secret", env.SCRAPER_SHARED_SECRET);

    const upstream = await fetch(new URL(pathname.slice(1), env.SCRAPER_FUNCTION_URL), {
      method,
      headers,
      body: request.body,
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
};
