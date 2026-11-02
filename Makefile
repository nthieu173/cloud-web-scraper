# Cargo builds the Lambda; npm builds web/, the page and the Worker;
# scripts/bundle.sh packs both for release. `make help` lists the targets.

BUILD_VENV := target/build-venv
WEB := web
# npm writes this on every install, so it dates the last one.
WEB_INSTALLED := $(WEB)/node_modules/.package-lock.json
# `make run` starts the Lambda with it; web/vite.config.ts sends it.
DEV_SHARED_SECRET := local-development-secret

.DEFAULT_GOAL := build
.PHONY: build web-install fmt lint test bundle run web-dev gate gate-why gate-counts \
	gate-one setup-dev hooks-install hooks-check clean help

## build: compile the Lambda for the host and build web/ (default)
build: $(WEB_INSTALLED)
	cargo build --locked
	npm --prefix $(WEB) run build

$(WEB_INSTALLED): $(WEB)/package.json $(WEB)/package-lock.json
	npm --prefix $(WEB) ci

## web-install: install web/'s locked npm dependencies
web-install: $(WEB_INSTALLED)

## setup-dev: prepare locked development tools, dependencies, and Git hooks
setup-dev: $(WEB_INSTALLED)
	uv sync --locked
	cargo fmt --version
	cargo clippy --version
	cargo fetch --locked
	$(MAKE) hooks-install

## hooks-install: install this checkout's prek pre-commit hook
hooks-install:
	uv run --locked prek install

## hooks-check: run commit checks on all tracked files
hooks-check:
	uv run --locked prek run --all-files

# No Prettier or Biome: ESLint's stylistic rules are web/'s style gate.
## fmt: rustfmt checked, not applied; ESLint
fmt: $(WEB_INSTALLED)
	cargo fmt --check
	npm --prefix $(WEB) run lint

## lint: Clippy, warnings denied; tsc
lint: $(WEB_INSTALLED)
	cargo lint
	npm --prefix $(WEB) run typecheck

## test: the Rust suite, then Vitest over the page and the Worker
test: $(WEB_INSTALLED)
	cargo test --all-features --locked
	npm --prefix $(WEB) test -- --run

# The same hash-checked install release CI uses.
$(BUILD_VENV)/.installed: build-requirements.txt
	rm -rf $(BUILD_VENV)
	python3 -m venv $(BUILD_VENV)
	$(BUILD_VENV)/bin/pip install --require-hashes --only-binary=:all: -r build-requirements.txt
	touch $@

## bundle: build the release tarball and its .sha256 into target/bundle
bundle: $(BUILD_VENV)/.installed $(WEB_INSTALLED)
	PATH="$(CURDIR)/$(BUILD_VENV)/bin:$$PATH" scripts/bundle.sh

## run: serve the Lambda on 127.0.0.1:9000, rebuilding on change (pair with web-dev)
run: $(BUILD_VENV)/.installed
	SCRAPER_SHARED_SECRET=$(DEV_SHARED_SECRET) \
		PATH="$(CURDIR)/$(BUILD_VENV)/bin:$$PATH" cargo lambda watch

## web-dev: serve the page with Vite, forwarding /scrape/ to `make run`
web-dev: $(WEB_INSTALLED)
	npm --prefix $(WEB) run dev

## gate: every check in one pass, with test counts (use this, not a second run)
gate: $(WEB_INSTALLED)
	./scripts/gate.sh

## gate-why: reprint the failing gates' output from the last run (no re-run)
gate-why:
	@test -f target/gate/summary.tsv \
		|| { echo "no gate run recorded; run \`make gate\` first"; exit 1; }
	@awk -F'\t' '$$2!="pass" {printf "\n=== %s (%s) ===\n", $$1, $$4; \
		while ((getline line < $$4) > 0) print line; close($$4); n++} \
		END {if (n == 0) print "every gate passed in the last run"}' \
		target/gate/summary.tsv

## gate-counts: the last run's table again, without re-running a suite
gate-counts:
	@test -f target/gate/summary.tsv \
		|| { echo "no gate run recorded; run \`make gate\` first"; exit 1; }
	@awk -F'\t' 'BEGIN {printf "%-20s %-6s %s\n", "GATE", "RESULT", "DETAIL"} \
		{printf "%-20s %-6s %s\n", $$1, $$2, $$3}' target/gate/summary.tsv

## gate-one: run a single gate, e.g. make gate-one GATE=vitest
gate-one:
	@test -n "$(GATE)" || { echo "usage: make gate-one GATE=<substring>"; exit 1; }
	GATE='$(GATE)' ./scripts/gate.sh

## clean: drop build output, including the bundle, its build tools and node_modules
clean:
	cargo clean
	rm -rf $(WEB)/dist $(WEB)/dist-worker $(WEB)/node_modules

help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  make /' | sort
