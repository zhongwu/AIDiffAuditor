# Agent Diff Auditor

Catches the shortcuts AI coding agents take to make a task *look* finished: tests that were
skipped or deleted, assertions that were weakened, errors that were suppressed, CI that was
softened. It reads your uncommitted `git diff`, so it works with any agent (Copilot, Claude Code,
Cursor, Codex...) and needs no API key. Every rule is plain pattern matching, so it is free and fast.

## What it flags

| Rule id | Severity | Catches |
|---|---|---|
| `test-file-deleted` | high | A test file was deleted. Low if it held no test cases (helpers); ignored if its content was moved or split into other files in the same diff |
| `test-skipped` | high | `it.skip`, `xit`, `@pytest.mark.skip`, `t.Skip`, `@Disabled`, `#[ignore]`... Conditional skips like `@pytest.mark.skipif(WIN, ...)` are low |
| `assertion-removed` | high | More assertions removed from tests that remain than added (assertions that left with a whole removed test are reported by `test-removed`) |
| `tautology-assertion` | high | `expect(true).toBe(true)`, `assert True`, `assert x == x` |
| `assertion-weakened` | medium | A precise assertion replaced by `toBeTruthy()`, `expect.anything()`... |
| `test-removed` | medium | More test cases removed than added |
| `test-focused` | medium | `.only` / `fit` hides the rest of the suite |
| `suppression-added` | low / medium / high | `@ts-ignore`, `eslint-disable`, `# type: ignore`, `# noqa`, `@SuppressWarnings`, coverage ignores. File-wide ones (`@ts-nocheck`, bare `eslint-disable`) are high. Ones that name a single error or rule (`# type: ignore[attr-defined]`, `# noqa: E501`, `@SuppressWarnings("unchecked")`) are low |
| `empty-catch` | medium | `catch {}`, `except: pass`. Low when it looks deliberate (a named exception type, a comment, `.catch(() => {})`); skipped for cleanup calls like `File.Delete` |
| `ci-weakened` | medium / high | `continue-on-error: true`, `\|\| true`, `--exit-zero`, a `test` script replaced by `echo` |
| `ci-test-removed` | medium | A test command removed from a CI pipeline |
| `coverage-lowered` | medium | A coverage threshold lowered (`fail_under`, `--cov-fail-under`, jest/vitest/nyc `lines` / `branches` ...) |
| `timeout-inflated` | low / medium | A test timeout at least doubled (10x or more is medium). Looks at test files, test configs and CI |
| `retries-added` | medium | `jest.retryTimes`, `retries: N`, `@pytest.mark.flaky`, `--reruns`: a flaky test rerun instead of fixed |

Untracked files are audited too, because agents often add new test files.

## Use it

**In VS Code** (press F5 to launch a dev host): run **Diff Auditor: Audit Changes**. Findings show in
the *Diff Auditor* view in the Explorer, in the Problems panel and in the status bar. Click one to
jump to the line.

**By the agent itself:** the extension registers a language model tool, `#auditChanges`. In Copilot
agent mode you can tell the agent to run it before it says it is done.

**From a terminal, hook or CI:**

```bash
npm run compile
node out/src/cli.js --fail-on high
```

Options: `--base <ref>`, `--stdin`, `--no-untracked`, `--ignore <rule-id>`, `--json`, `--fail-on high|medium|low|never`.
Exit code is 1 when a finding reaches `--fail-on`, so it can gate a commit, an agent hook or a CI job.

## Settings

`diffAuditor.baseRef` (default `HEAD`), `diffAuditor.includeUntracked`, `diffAuditor.minSeverity`,
`diffAuditor.ignoreRules`, `diffAuditor.autoAudit` (re-audit on save).

## Develop

```bash
npm install
npm test        # compiles, then runs the node:test suite
```

- `src/core/` has no VS Code dependency: `diffParser.ts` (unified diff to numbered lines),
  `rules.ts` (all rules and their patterns), `audit.ts` (runs rules, filters, sorts).
- `src/git.ts` collects the diff, `src/extension.ts` is the VS Code shell, `src/cli.ts` is the CLI.
- To add a rule: write it in `rules.ts`, add it to `RULES`, add a test in `test/rules.test.ts`.

## Not done yet

- Python/Go/Java/Rust coverage is thinner than JS/TS. `test.each` tables are not inspected.
- No config file for team-wide rules, and no per-line "mark reviewed".
- Heuristics can misfire, for example a legitimate `// @ts-expect-error` in a type test. Use
  `diffAuditor.ignoreRules` to switch a rule off.
- Not yet published. `package.json` has a placeholder publisher id; publish with `vsce` and `ovsx`.
