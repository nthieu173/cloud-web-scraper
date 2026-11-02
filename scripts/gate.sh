#!/usr/bin/env bash
#
# Every gate the project ships on, in one pass. Each gate runs even after
# another fails, and its output goes to a file per gate.
#
# The summary table is always printed last, and each failing row carries the
# first line of the cause and its log path, so the tail of the run is enough.
# When exactly one gate fails, its output is also printed above the table.
#
# Exit status is 0 only when every gate passed.
#
# Environment:
#   GATE        run only gates whose name contains this substring
#   GATE_DIR    where per-gate output is written (default target/gate)
#   GATE_QUIET  set to 1 to never print gate output inline

set -uo pipefail

cd "$(dirname "$0")/.."

names=()
statuses=()
details=()
logs=()
failed=0
failed_names=""

# Under `target/` rather than the system temp directory, so a sandbox that
# allows writes only inside the tree does not turn every gate into a failure.
GATE_DIR="${GATE_DIR:-target/gate}"
if mkdir -p "$GATE_DIR" 2>/dev/null && [ -w "$GATE_DIR" ]; then
	rm -f "$GATE_DIR"/*.log "$GATE_DIR/summary.tsv" 2>/dev/null
	GATE_LOGGING=1
else
	printf '\033[33mnote: %s is not writable; printing gate output inline\033[0m\n' "$GATE_DIR"
	GATE_DIR=""
	GATE_LOGGING=0
fi

# Fixed-text extractors consume stdin so large gate output does not break the
# writer's pipe. `run` skips them on failure, where they would say nothing.
# Count-bearing extractors still run, so a failing `cargo test` row keeps its
# "N passed, M failed".
none='cat >/dev/null; printf ok'

# The first line of a failure, for the summary row: most specific pattern
# first, ANSI stripped, cargo's progress lines skipped in the fallback.
cause_line() {
	local file="$1" line
	line="$(sed $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$file" |
		grep -m1 -E '^(error(\[[A-Z0-9]+\])?:|error |failures:|error\[)|panicked at|^not ok |test result: FAILED')"
	if [ -z "$line" ]; then
		line="$(sed $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$file" |
			grep -vE '^\s*(Compiling|Checking|Finished|Blocking|Downloading|Updating|warning:|$)' |
			head -1)"
	fi
	printf '%s' "$line" | cut -c1-46
}

# run <name> <detail-extractor> <command...>
#
# The extractor is a shell snippet reading the output on stdin and printing one
# short line for the summary.
run() {
	local name="$1" extractor="$2"
	shift 2

	case "$name" in
	*"${GATE:-}"*) ;;
	*)
		return 0
		;;
	esac

	printf '\033[1m▸ %s\033[0m\n' "$name"

	local log status detail
	if [ "$GATE_LOGGING" -eq 1 ]; then
		log="$GATE_DIR/$(printf '%s' "$name" | tr -cs '[:alnum:]' '-' |
			tr '[:upper:]' '[:lower:]' | sed 's/^-*//;s/-*$//').log"
	else
		log=""
	fi

	local output
	output="$("$@" 2>&1)"
	status=$?
	if [ -n "$log" ]; then
		printf '%s\n' "$output" >"$log"
	fi

	names+=("$name")
	logs+=("$log")
	if [ "$status" -eq 0 ]; then
		statuses+=("pass")
		details+=("$(printf '%s\n' "$output" | eval "$extractor")")
	else
		statuses+=("FAIL")
		failed=$((failed + 1))
		failed_names="$failed_names${failed_names:+, }$name"

		detail=""
		if [ "$extractor" != "$none" ]; then
			detail="$(printf '%s\n' "$output" | eval "$extractor")"
		fi
		local cause=""
		if [ -n "$log" ]; then
			cause="$(cause_line "$log")"
		else
			cause="$(printf '%s\n' "$output" | grep -m1 -E '.' | cut -c1-46)"
		fi
		# The separator is ASCII because `cut -c` counts bytes, and a multi-byte
		# character would shift the LOG column out of line.
		if [ -n "$detail" ] && [ -n "$cause" ]; then
			details+=("$(printf '%s | %s' "$detail" "$cause" | cut -c1-46)")
		else
			details+=("$(printf '%s%s' "$detail" "$cause" | cut -c1-46)")
		fi

		if [ -z "$log" ]; then
			printf '\033[31m--- %s failed ---\033[0m\n' "$name"
			printf '%s\n' "$output"
			printf '\033[31m--- end %s ---\033[0m\n' "$name"
		fi
	fi
}

# `cargo test` prints one `test result:` line per binary; the suite total is
# their sum.
rust_total='awk "/^test result:/ {p += \$4; f += \$6} END {printf \"%d passed, %d failed\", p, f}"'

# `node --test` prints `ℹ pass N` and `ℹ fail N` once per run (`#` under TAP).
node_total='awk "/^(ℹ|#) pass / {p = \$3} /^(ℹ|#) fail / {f = \$3} END {printf \"%d passed, %d failed\", p, f}"'

run "cargo fmt --check" "$none" cargo fmt --check
run "cargo clippy" "$none" cargo lint
# Private items too, since every item here is private.
run "cargo doc" "$none" env RUSTDOCFLAGS="-D warnings" \
	cargo doc --no-deps --all-features --locked --document-private-items
run "cargo test" "$rust_total" cargo test --all-features --locked
run "node --test" "$node_total" node --test worker.test.mjs

if [ "${#names[@]}" -eq 0 ]; then
	printf '\n\033[31mno gate matched GATE=%s\033[0m\n' "${GATE:-}"
	exit 1
fi

# One failure: print its output inline (the iterating-on-one-gate case).
if [ "$failed" -eq 1 ] && [ "$GATE_LOGGING" -eq 1 ] && [ "${GATE_QUIET:-0}" != "1" ]; then
	for i in "${!names[@]}"; do
		if [ "${statuses[$i]}" != "pass" ]; then
			printf '\n\033[31m--- %s ---\033[0m\n' "${names[$i]}"
			cat "${logs[$i]}"
		fi
	done
fi

# Written before the table so the table is the last thing on the terminal.
if [ "$GATE_LOGGING" -eq 1 ]; then
	for i in "${!names[@]}"; do
		printf '%s\t%s\t%s\t%s\n' \
			"${names[$i]}" "${statuses[$i]}" "${details[$i]}" "${logs[$i]}" \
			>>"$GATE_DIR/summary.tsv"
	done
fi

printf '\n\033[1m%-20s %-6s %-46s %s\033[0m\n' "GATE" "RESULT" "DETAIL" "LOG"
for i in "${!names[@]}"; do
	if [ "${statuses[$i]}" = "pass" ]; then
		printf '%-20s \033[32m%-6s\033[0m %-46s\n' \
			"${names[$i]}" "pass" "${details[$i]}"
	else
		printf '%-20s \033[31m%-6s\033[0m %-46s %s\n' \
			"${names[$i]}" "FAIL" "${details[$i]}" "${logs[$i]}"
	fi
done

if [ "$failed" -ne 0 ]; then
	printf '\n\033[31mgate failed -- %d of %d: %s\033[0m\n' \
		"$failed" "${#names[@]}" "$failed_names"
	if [ "$GATE_LOGGING" -eq 1 ]; then
		printf 'Full output per gate in %s/; `make gate-why` prints it without re-running.\n' \
			"$GATE_DIR"
	fi
	exit 1
fi
printf '\n\033[32mevery gate green\033[0m\n'
