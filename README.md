# Agent Diff Auditor

Review what your AI agent actually changed. It flags skipped or deleted tests, weakened assertions,
suppressed errors and softened CI in your `git diff`, so a "done" that is not really done stands out.
It works with any agent (Copilot, Claude Code, Cursor, Codex...) and needs no API key. Every rule is
plain pattern matching, so it is free and fast.

## What it flags

| Rule id | Severity | Catches |
|---|---|---|
| `test-file-deleted` | high | A test file was deleted. Low if it held no test cases (helpers); ignored if its content was moved or split into other files in the same diff |
| `test-skipped` | high | `it.skip`, `xit`, `@pytest.mark.skip`, `t.Skip`, `@Disabled`, `#[ignore]`... Conditional skips are low: `@pytest.mark.skipif(WIN, ...)`, `XCTSkipIf`, or a skip call such as `markTestSkipped` or `t.Skip` inside an `if` |
| `assertion-removed` | high | More assertions removed from tests that remain than added (assertions that left with a whole removed test are reported by `test-removed`) |
| `tautology-assertion` | high | `expect(true).toBe(true)`, `assert True`, `assert x == x` |
| `assertion-weakened` | medium | A precise assertion replaced by `toBeTruthy()`, `expect.anything()`, or a Python `assert a == b` reduced to `assert a`... |
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

**In VS Code:** run **Diff Auditor: Audit Changes**. Findings show in
the *Diff Auditor* view in the Explorer, in the Problems panel and in the status bar. Click one to
jump to the line.


**Hiding findings you have accepted.** *Set Baseline (Hide Current Findings)* hides everything that exists now, so only
what an agent adds later is reported. To accept a single finding, click the check mark next to it in the view, or use the
**Diff Auditor: mark as reviewed** quick fix (lightbulb) on the line. Reviewed findings stay hidden when their line
moves, but a second copy of the same shortcut is reported. They are stored in `.git/diffaudit-baseline.json`, which is
never committed, and *Clear Baseline* brings everything back. The CLI and the Claude Code hooks use the same file.
**By the agent itself:** the extension registers a language model tool, `#auditChanges`. In Copilot
agent mode you can tell the agent to run it before it says it is done.

**From a terminal, hook or CI:**

```bash
npm run compile
node out/src/cli.js --fail-on high
```

Options: `--base <ref>`, `--stdin`, `--no-untracked`, `--ignore <rule-id>`, `--json`, `--sarif`, `--output <file>`, `--min-severity`, `--fail-on high|medium|low|never`.
Exit code is 1 when a finding reaches `--fail-on`, so it can gate a commit, an agent hook or a CI job.

**As a pre-commit hook.** Put this in `.git/hooks/pre-commit` (and make it executable) to stop a commit that contains a high-severity finding. A hook sees the working tree, so it checks what you are about to commit plus anything unstaged; use `--base` or the baseline if that is too broad:

```sh
#!/bin/sh
node /path/to/AIDiffAuditor/out/src/cli.js --fail-on high || {
  echo "Diff Auditor found high-severity shortcuts. Review them, or commit with --no-verify." >&2
  exit 1
}
```

**Comparing with a branch.** `diffaudit --base origin/main` (or the **Diff Auditor: Audit Against Branch or Commit...** command, or `baseRef` in `.diffauditor.json`) reports what you changed since you branched off, even if the branch has moved on since. It diffs against the merge base, not the branch tip, so a test a teammate added to `main` after you branched is not reported as deleted. An unknown ref is an error that says so.

**In CI with GitHub code scanning.** `--sarif` writes a SARIF 2.1.0 report that GitHub shows as annotations on the pull request. `--output <file>` writes it to a file, so the exit code can still gate the job:

```yaml
name: Diff audit
on: pull_request
permissions:
  contents: read
  security-events: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Build the auditor
        run: |
          git clone --depth 1 https://github.com/zhongwu/AIDiffAuditor.git "$RUNNER_TEMP/diffaudit"
          (cd "$RUNNER_TEMP/diffaudit" && npm ci && npm run compile)
      - name: Audit the pull request
        run: node "$RUNNER_TEMP/diffaudit/out/src/cli.js" --base "origin/${{ github.base_ref }}" --sarif --output diffaudit.sarif --fail-on never
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: diffaudit.sarif }
```

Use `--fail-on high` instead of `never` to fail the job on high-severity findings (upload the report in an `if: always()` step so it still appears). Severity maps to the SARIF level: high is `error`, medium `warning`, low `note`. Each result carries a fingerprint based on rule, file and code (not the line number), so GitHub recognises the same finding after it moves. Code scanning on private repositories needs GitHub Advanced Security. The workflow above has not been run on GitHub yet; the report itself is checked against the official SARIF schema.

## Settings

`diffAuditor.baseRef` (default `HEAD`), `diffAuditor.includeUntracked`, `diffAuditor.minSeverity`,
`diffAuditor.ignoreRules`, `diffAuditor.autoAudit` (re-audit on save).

## Team config

Commit a `.diffauditor.json` at the repository root so everyone, the editor, the CLI, CI and the agent hooks, uses the same defaults:

```json
{
  "ignoreRules": ["retries-added"],
  "minSeverity": "medium",
  "ignorePaths": ["legacy/**", "**/*.generated.ts"],
  "baseRef": "origin/main"
}
```

| Key | Meaning |
|---|---|
| `ignoreRules` | Rule ids switched off for the team. Added to `diffAuditor.ignoreRules` and `--ignore`. A misspelled id gives a warning. |
| `minSeverity` | Hide findings below this level. A value you set in VS Code settings, or `--min-severity`, wins. |
| `ignorePaths` | gitignore-style globs relative to the repo root: `*` stays in one folder, `**` crosses folders, a pattern with no `/` matches at any depth, a trailing `/` means everything under it. |
| `baseRef` | What to compare against, for example `origin/main`. A value you set in VS Code settings, or `--base`, wins. |

Unknown keys and wrong types are errors with a message that names the problem, so a typo never silently turns a check off. VS Code validates and completes the file as you type.

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

- It matches patterns in the diff; it cannot tell whether a test is meaningful.
- Tests deleted because the code moved to another repository are still reported. Mark them as reviewed.
- Heuristics can misfire, for example a legitimate `// @ts-expect-error` in a type test. Use
  `diffAuditor.ignoreRules` or `.diffauditor.json` to switch a rule off.
- Measured on human history and hand-written agent-style diffs, not yet on many real agent sessions.
