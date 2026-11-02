# cloud-web-scraper

Lists the audio and video files linked from a web page. A small htmx page posts
a URL to a Rust AWS Lambda, which fetches the page and returns the links as an
HTML fragment. It runs at <https://scraper.wizllc.org>: a Cloudflare Worker
serves the page and forwards `/scrape/*` to the Lambda's function URL.

This repository only builds and publishes a release bundle. The
[WizLLC/wiz-vm](https://github.com/WizLLC/wiz-vm) Terraform downloads it,
checks a pinned SHA-256 and deploys it; no AWS or Cloudflare credentials live
here.

## Layout

- `src/main.rs`: the Lambda (axum on `lambda_http`, function URL payload 2.0).
- `worker.js`: the Cloudflare Worker; `worker.test.mjs` tests it with `node --test`.
- `public/`: the static page and its assets, served by the Worker.
- `scripts/gate.sh`: every check, run by `make gate` and CI.
- `scripts/bundle.sh`: packs the release bundle, run by `make bundle` and release CI.
- `build-requirements.txt`: hash-pinned cargo-lambda and Zig for the arm64 build.

## Develop

[direnv](https://direnv.net) loads Make, Clang and Node 24 from Guix
(`manifest.scm`) and prek from uv (`pyproject.toml`). Rust comes from rustup,
pinned by `rust-toolchain.toml`.

```sh
direnv allow
make setup-dev   # tools, crates and the prek pre-commit hook
make gate        # fmt, Clippy, rustdoc, cargo test, node --test
make bundle      # target/bundle/cloud-web-scraper.tar.gz and .sha256
```

Without the shell hook, prefix commands with `direnv exec .`. `make help` lists
every target.

## Release

1. Bump `version` in `Cargo.toml` (and `Cargo.lock`), and merge to `main`.
2. Run the **Release** workflow on `main`: `gh workflow run release.yml --ref main`.

It fails if tag `v<version>` or its release already exists. Otherwise it runs the
gate, builds the bundle and publishes it as release `v<version>` on the commit it
built, with the bundle's SHA-256 in the job summary. Pin that release and digest
in wiz-vm.

## Bundle contract

wiz-vm depends on this exactly.

- Release tag: `vX.Y.Z`, equal to the `Cargo.toml` version.
- Assets:
  - `cloud-web-scraper.tar.gz`
  - `cloud-web-scraper.tar.gz.sha256`, in `sha256sum` format for that file.
- Tarball top level: `bootstrap.zip` (the `provided.al2023` arm64 Lambda zip),
  `worker.js` and `public/`. Nothing else, and no leading directory.
- Runtime interface:
  - Lambda environment: `SCRAPER_SHARED_SECRET`.
  - Worker bindings: `SCRAPER_FUNCTION_URL` (plain text, ending in `/`) and
    `SCRAPER_SHARED_SECRET` (secret).
  - The Worker's main module is `worker.js`; assets use
    `run_worker_first = ["/scrape/*"]`.

Rebuilding a commit gives the same bytes on the same machine. Dependency source
paths are embedded in the binary, so a local build need not match CI's.
