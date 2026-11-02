# cloud-web-scraper

Lists the audio and video files linked from a web page. It runs at
<https://scraper.wizllc.org>:

- A React page posts a URL to `/scrape/media` as JSON, and renders the result.
- A Cloudflare Worker serves the page. It answers `/scrape/*` itself: it
  rejects malformed requests and non-http(s) URLs before they cost a Lambda
  invocation, forwards the rest to the Lambda's function URL with a shared
  secret, and passes on only a response it has validated.
- A Rust AWS Lambda fetches the page, streams it through
  [lol_html](https://github.com/cloudflare/lol-html) without building a DOM,
  and returns the media links as JSON.

This repository only builds and publishes a release bundle. The
[WizLLC/wiz-vm](https://github.com/WizLLC/wiz-vm) Terraform downloads it,
checks a pinned SHA-256 and deploys it; no AWS or Cloudflare credentials live
here.

## Layout

- `src/main.rs`: the Lambda (`lambda_http`, function URL payload 2.0; reqwest
  and lol_html).
- `src/mime.types`: Apache httpd's media type table, vendored unmodified at the
  commit `src/main.rs` names. Its `audio/` and `video/` extensions decide which
  links count as media. To update, replace the file and the commit link.
- `web/`: one npm project (Vite, React, TypeScript, Vitest, ESLint):
  - `src/`: the page; `src/api/wire.ts` decodes the JSON the page and the
    Worker exchange, matching the Lambda's types; `src/api/cache.ts` keeps
    successful results in the visitor's localStorage for 7 days (50 pages at
    most), so repeat scrapes skip the Worker until "Scrape again".
  - `worker/`: the Cloudflare Worker, built to one ES module.
  - `public/`: static files copied into the page's build.
- `scripts/gate.sh`: every check, run by `make gate` and CI.
- `scripts/bundle.sh`: packs the release bundle, run by `make bundle` and release CI.
- `build-requirements.txt`: hash-pinned cargo-lambda and Zig for the arm64 build.

## Develop

[direnv](https://direnv.net) loads Make, Clang and Node 24 from Guix
(`manifest.scm`) and prek from uv (`pyproject.toml`). Rust comes from rustup,
pinned by `rust-toolchain.toml`; web/'s packages from `web/package-lock.json`.

```sh
direnv allow
make setup-dev   # tools, crates, npm packages and the prek pre-commit hook
make gate        # fmt, Clippy, rustdoc, cargo test, tsc, ESLint, Vitest, vite build
make bundle      # target/bundle/cloud-web-scraper.tar.gz and .sha256
```

To try the page locally, run `make run` (the Lambda under
`cargo lambda watch`, on port 9000) and `make web-dev` (Vite on
<http://localhost:5173>) side by side. Vite forwards `/scrape/` to the Lambda
with the development secret, standing in for the Worker without its checks.

Without the shell hook, prefix commands with `direnv exec .`. `make help` lists
every target.

## Release

1. Bump `version` in `Cargo.toml` (and `Cargo.lock`), and merge to `main`.
2. Tag that commit on `main` and push the tag:
   `git tag -a v<version> -m v<version> && git push origin v<version>`.

The tag push runs the **Release** workflow. It fails unless the tag is
`v<version>` for `Cargo.toml`'s version and points at a commit on `main`, or if
the release already exists. Otherwise it runs the gate, builds the bundle and
publishes it as release `v<version>` on the tag, with the bundle's SHA-256 in
the job summary. Pin that release and digest in wiz-vm.

## Bundle contract

wiz-vm depends on this exactly.

- Release tag: `vX.Y.Z`, equal to the `Cargo.toml` version.
- Assets:
  - `cloud-web-scraper.tar.gz`
  - `cloud-web-scraper.tar.gz.sha256`, in `sha256sum` format for that file.
- Tarball top level: `bootstrap.zip` (the `provided.al2023` arm64 Lambda zip),
  `worker.js` (`web/worker/` built to one ES module) and `public/` (the page's
  build, `web/dist/`). Nothing else, and no leading directory.
- Runtime interface:
  - Lambda environment: `SCRAPER_SHARED_SECRET`.
  - Worker bindings: `SCRAPER_FUNCTION_URL` (plain text, ending in `/`) and
    `SCRAPER_SHARED_SECRET` (secret).
  - The Worker's main module is `worker.js`; assets use
    `run_worker_first = ["/scrape/*"]`.

Rebuilding a commit gives the same bytes on the same machine. Dependency source
paths are embedded in the binary, so a local build need not match CI's.
