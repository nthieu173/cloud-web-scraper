# Cargo builds the Lambda; Node tests the Worker. `make help` lists the targets.

.DEFAULT_GOAL := build
.PHONY: build fmt lint test gate gate-why gate-counts gate-one \
	setup-dev hooks-install hooks-check clean help

## build: compile the Lambda for the host (default)
build:
	cargo build --locked

## setup-dev: prepare locked development tools, dependencies, and Git hooks
setup-dev:
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

## fmt: rustfmt, checked not applied
fmt:
	cargo fmt --check

## lint: Clippy, warnings denied
lint:
	cargo lint

## test: the Rust suite and the Worker suite
test:
	cargo test --all-features --locked
	node --test worker.test.mjs

## gate: every check in one pass, with test counts (use this, not a second run)
gate:
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

## gate-one: run a single gate, e.g. make gate-one GATE=node
gate-one:
	@test -n "$(GATE)" || { echo "usage: make gate-one GATE=<substring>"; exit 1; }
	GATE='$(GATE)' ./scripts/gate.sh

## clean: drop build output
clean:
	cargo clean

help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  make /' | sort
