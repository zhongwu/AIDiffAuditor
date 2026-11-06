# Changelog

## 0.1.2 (pre-release)

- README now has a demo GIF and a screenshot recorded from the real extension. No behaviour change from 0.1.1.

## 0.1.1 (pre-release)

- New description and README introduction.
- README: pre-commit hook recipe; removed outdated "not done yet" items.
- First release published from GitHub Actions with trusted publishing (no access token).

## 0.1.0 (pre-release)

First public pre-release.

**Rules** (14, rule-based on the git diff, no AI calls): `test-file-deleted`, `test-skipped`, `test-focused`,
`test-removed`, `assertion-removed`, `assertion-weakened`, `tautology-assertion`, `suppression-added`, `empty-catch`,
`ci-weakened`, `ci-test-removed`, `coverage-lowered`, `timeout-inflated`, `retries-added`. Covers JavaScript and TypeScript,
Python, Go, Java, Kotlin, Rust, Ruby, PHP, C# and Swift. Tuned against 3,300 commits of real history from 11 open-source
repositories to keep false alarms low.

**In the editor**
- Findings view, Problems panel entries and a status bar summary. Optional audit on save.
- Mark a single finding as reviewed (view button or quick fix).
- Set or clear a session baseline so only what an agent adds afterwards is reported.
- Audit against a branch, tag or commit, using the merge base.
- A language model tool, `#auditChanges`, so Copilot agent mode can audit its own work.

**On the command line** (`diffaudit`)
- Exit codes for CI and git hooks, `--base`, `--baseline`, `--json`, `--sarif` and `--output`.
- Claude Code hooks: save a baseline at session start, and on stop send new findings back to the agent.

**Team settings**
- A committed `.diffauditor.json` (`ignoreRules`, `minSeverity`, `ignorePaths`, `baseRef`) shared by the editor, the CLI and the
  hooks, with editor validation.

Known limits: detects patterns in the diff, not whether a test is meaningful. Tests deleted because code moved to another
repository are still reported. The rules have been measured on human history and hand-written agent-style diffs, not yet on a
large set of real agent sessions.
