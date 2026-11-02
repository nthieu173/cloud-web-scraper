# Stage: PRE-PRODUCTION

Assume this until the line above changes. Don't build production machinery uninvited:
no backward compatibility, migrations, version headers, perf targets, ops tooling,
or hardening nobody asked for. Stale local state gets deleted rather than migrated.
This limits scope, not rigor. If you think some of it is genuinely needed now, say so and let me decide.

## Layout and boundaries

`README.md` describes the layout, the release flow and the bundle contract. wiz-vm deploys the
bundle and depends on that contract exactly; changing it needs a matching wiz-vm change.
Never push, cut a release, or change repository settings without asking.

## Gates: after code changes, run `make gate` once

Run it at the end of work that changes production code, tests, build/runtime configuration, or
dependencies. Documentation-only changes get focused checks instead.

`make gate` runs every shipped check in one pass (fmt, Clippy, rustdoc with private items,
`cargo test`, `node --test`). Every gate runs even after one fails. The final summary table has
test counts, and each failing row carries its first error line and log path
(`target/gate/<gate>.log`).

- `make gate-why` reprints failing gates' output; `make gate-counts` reprints the last table;
  `make gate-one GATE=node` runs one gate.
- Don't re-run a suite to read its numbers or grep a failure — use the summary and the log.
- Running a single suite while iterating is fine: `cargo test -- <filter>` or
  `node --test worker.test.mjs`.
- Changes to the build or packaging also get `make bundle`.
