# Development plan

Goal: ship Agent Diff Auditor to the VS Code Marketplace and Open VSX, keeping the three
differentiators: editor UI for the rules, non-JS test framework coverage, agent-callable tool.

## Phase 0: Repo hygiene (small, do first)
- [x] Add LICENSE (MIT unless decided otherwise) and set `license` in package.json.
- [x] Add `.gitattributes` (`* text=auto eol=lf`) to stop the CRLF warnings.
- [x] Add CI (GitHub Actions): `npm ci`, compile, `npm test` on Windows and Linux.
- [x] Decide whether CLAUDE.md / SESSION-NOTES.md / BRAINSTORM.md stay local-only (staying local in .gitignore).

## Phase 1: Verify the UI (blocker for everything else)
- [x] Automated Extension Host run (`npm run test:integration`, VS Code 1.145 against a scratch repo): activation, commands, diagnostics, `ignoreRules`, clear.
- [x] Manual F5 pass (`.sandbox/`, `npm run sandbox`): tree view, status bar, badges, squiggles, click-to-open confirmed.
- [x] Manual F5 also confirmed: tooltip text, `minSeverity`, `ignoreRules`, `autoAudit`, findings clear when the code is fixed.
- [x] Manual F5: clean state ("No suspicious changes found", status "clean") confirmed after fixing all findings.
- [ ] Open: tree icon vs squiggle severity mismatch (decide: keep or align); Clear command panel/status reset checked only by the automated test.
- [x] Edge cases in `test/git.test.ts`: no git repo, no commits (fixed), no changes, untracked files, subfolder cwd, binary files, bad base ref.
- [ ] Edge cases still open: very large diffs, multi-root workspaces, `baseRef` setting.
- [x] `diffAuditor_auditChanges` registered and invocable via `vscode.lm.invokeTool`.
- [x] Claude Code: Stop hook (`scripts/claude-stop-hook.js`, wired by `npm run sandbox`) fires and the agent receives the findings.
- [x] Copilot agent mode (gpt-oss:120b-cloud) called `diffAuditor_auditChanges` on request and reported 2 high / 3 medium correctly.
- [ ] Copilot: does it call the tool unprompted before finishing a task? (try with and without `.github/copilot-instructions.md`)
- [x] Gap found: the audit reported every uncommitted change, so an agent could not tell its own changes from pre-existing ones.
      Fixed with a session baseline: `diffaudit --save-baseline` / `--baseline` (stored in `.git/`, matched by rule+file+content, not line),
      and Claude Code SessionStart + Stop hooks. Unit tested, and confirmed in a live Claude Code session: old findings did not block, a newly added `it.skip` did (only that one reported).
- [x] Baseline in the VS Code extension and the `diffAuditor_auditChanges` tool: "Set Baseline" / "Clear Baseline" commands (view title menu), shared with the CLI and hooks, panel and status bar show how many are hidden. Covered by unit and integration tests; manual look in the F5 window still to do.
- [ ] Fix what breaks; add tests for anything fixable in `src/core`.

## Phase 2: Rule quality
- [~] Fixture corpus: `test/fixtures/*.patch` with `expected.json`, run by `test/fixtures.test.ts` (19 diffs: 14 shortcut patterns across JS/TS, Python, Go, Java, Rust, CI and configs, 5 clean). These are hand-written in the shape of typical agent output, not captured from real sessions, so they guard against regressions but do not prove coverage. Next: replace or add diffs captured from real Claude Code and Copilot runs. Writing them found one real miss (Python `assert a == b` weakened to `assert a`), now fixed.
- [x] First false-positive pass: `node scripts/audit-history.js <repo>...` audits every past commit of real repos (read-only).
      On 5 repos / 203 commits: 37 findings -> 27, and only 9 at medium or above (18 are low). Fixed: docs mentioning `it.skip`
      flagged HIGH, patterns inside string literals, one finding per weakened hunk, empty-catch noise (cleanup skipped, typed/commented/promise catches low).
- [x] Second pass on open-source Python/Go/Java/Rust history (requests, click, cobra, gin, gson, ripgrep; 300 commits each, 1,800 total):
      high+medium findings 392 -> 44. Fixes: `@pytest.mark.skipif` was reported as a HIGH skip (30 of click's 32), moved or split tests counted as removed
      (lines cancelled across files in one diff), scoped suppressions (`# type: ignore[code]`, `# noqa: E501`, `@SuppressWarnings("x")`) are low,
      assertions removed with their whole test no longer double-reported, deleted helper files with no tests are low.
- [x] Measured Ruby (sinatra), PHP (guzzle), Swift (Alamofire), Kotlin (okio), C# (Newtonsoft.Json), 300 commits each: high+medium 415 -> 61. Fixes: skip calls inside an `if` are low (242 PHP findings; also solves Go short mode), bare `assertTrue(x)` is weak but `assertTrue(pred($x))` and comparisons are not (74), `#pragma warning disable CS0618` is scoped (54), Kotlin typed catch is low, `XCTSkip`/`XCTSkipIf` recognised. The six older repos went 44 -> 41, no regressions. 91 tests.
- [ ] Measure real agent output, which human history cannot show (missed shortcuts, not just false alarms): run Claude Code and Copilot on "make the failing test pass" in `.sandbox`, save each result with `git diff > test/fixtures/<name>.patch`, add the expectation to `expected.json`. Needs a person to run the agents.
- [ ] Remaining known noise (no safe fix, left for the reviewer): tests deleted because a module moved to another repository.
- [x] Python assertion weakening: `assert a == b` reduced to `assert a` or `assert a is not None` is `assertion-weakened`, only when the hunk loses more precise asserts than it gains (reformatting and wrapped `assert (` are not flagged). First version gave 19 false alarms on requests and click; tightened to 1 across all six repos (click merging six asserts into one parametrized test). 72 tests passing.
- [x] Rule tables no longer flag themselves: a pattern inside a regex literal or a string is ignored (also for `.only`, retries and empty catch), `.patch`/`.diff` files are skipped, and `#` only starts a comment when followed by whitespace. Auditing this repo's own history: 37 findings -> 0. Eleven-repo totals unchanged (61 and 41 high+medium).
- [x] Asserts folded into one parametrized test (`@pytest.mark.parametrize`, `@ParameterizedTest`, `it.each`, `t.Run`, `[Theory]`, data providers) are not reported as removed or weakened. 97 tests.
- [ ] Keep every rule at one positive and one negative test minimum; no rule id renames.
- [x] New rules: `coverage-lowered`, `timeout-inflated`, `retries-added` (before/after comparison of numbers, restricted to test files, test configs and CI). 0 false alarms on 203 real commits; caught 1 real timeout bump (20s to 60s).
- [x] Language coverage measured on real history: Python, Go, Java, Rust, Ruby, PHP, Swift, Kotlin, C#. Not yet measured: JavaScript/TypeScript apps beyond the sandbox and this repo, C/C++.

## Phase 3: Workflow features
- [x] "Mark reviewed" for individual findings: check button in the view, a "mark as reviewed" quick fix, and a palette command. It adds the finding to the shared baseline file (`addToBaseline`), so the CLI and hooks honour it too. Integration test covers the quick fix. Note: *Set Baseline* overwrites earlier marks, but it re-captures every current finding anyway.
- [x] Shared team config file `.diffauditor.json` (`ignoreRules`, `minSeverity`, `ignorePaths`, `baseRef`), read by the extension, the CLI and the agent hooks; JSON schema for editor validation; unknown keys and bad values are clear errors; precedence is CLI flag or explicit VS Code setting over the file. 106 unit tests plus an integration check.
- [x] Compare against a chosen ref: `--base`, the `baseRef` setting or config key, a picker command in the editor, and the agent tool's `baseRef` input. Diffs against the merge base so a branch that moved on does not make its new tests look deleted (found and fixed while writing the tests). Unknown refs give a clear error. Picker UI itself is not automated.
- [x] CLI output: `--sarif` (SARIF 2.1.0, validated against the official schema on the sandbox, all fixtures, an empty run and an odd file name), `--output <file>`, stable fingerprints, README snippet for GitHub code scanning, and a pre-commit hook recipe in the README (checked in a temp repo: a clean commit passes, a skipped test blocks, `--no-verify` bypasses). The GitHub Actions workflow in the README has not been run on GitHub yet.

## Phase 4: Pre-release
- [~] Re-check competitors (2026-11-05, web search summaries only; the pages themselves were not opened, so confirm on the Marketplace before relying on this). The field has grown since the first check:
      VS Code extensions: Critical Gate (`criticaldeveloper.critical-gate-vscode`, task-scope checks), AgentCheck (`agentcheck.agentcheck-vscode`, checkpoint and compare), Change Integrity (`metratio.change-integrity`), CC Diff Review (hunk accept/reject), agentdiff (tracing).
      CLIs doing test-tampering detection: checkwash (PyPI, also has a Claude Code hook), tamperguard (PyPI), tampercheck (PyPI), proof-of-work-agent (PyPI), hallucot (npm), Swarm Orchestrator.
      "BotsIQ Change Verifier" and "tightdiff" from the first check were not found. The search found no editor extension that shows weakened-assertion findings inline, but that is unconfirmed.
      The dev.to article "Catching the shortcuts AI coding agents take to look done" used almost our tagline, so 0.1.1 reworded the description and README intro ("Review what your AI agent actually changed: ...").
- [x] Publisher: `zhongwu` (same as MdEditorExt; the Open VSX namespace `zhongwu` is already claimed and verified). `package.json` and the integration test now use `zhongwu.agent-diff-auditor`; `private` removed. Workflows added, copied from MdEditorExt: `ci.yml` (unit and integration tests on Linux, Windows and macOS), `publish.yml` (a `v*` tag runs tests, packages once, publishes to both registries with trusted publishing, no stored tokens; an odd minor version such as 0.1.x is a pre-release), `dependabot.yml`. CI is green on Linux, Windows and macOS (unit and integration). The macOS job once sat for 15 minutes and was cancelled by GitHub, not a test failure; re-running just that job passed. Dependabot now ignores `@types/vscode`, major `@types/node` and major TypeScript bumps (TS 7 does not compile this project, `@types/vscode` newer than `engines.vscode` breaks vsce); close PRs #3, #4 and #5 if still open.
- [x] Icon (generated placeholder, `node scripts/make-icon.js`), CHANGELOG, categories, keywords, `repository`/`bugs`/`homepage`, version 0.1.0.
- [x] README screenshot (`images/findings.png`) and demo GIF (`images/demo.gif`, 18 frames, 21 s), recorded from the real extension in a separate VS Code copy against a sample repo (f477d2b). They are excluded from the package (`.vscodeignore`) and load from GitHub. The recording rig was not kept in the repo: it launched VS Code through `@vscode/test-electron`, drove the UI with an extension-host script, captured the window with `CopyFromScreen` and encoded with `gifenc`. The installed VS Code could not be used while it had an update pending (it holds a setup lock and delays new windows). The listings only show the images from the next version on.
- [x] `vsce package --pre-release`: 21 files, 41 KB, no warnings. Installed into a clean VS Code profile. The integration suite (10 checks) passes against the unpacked .vsix alone: `DIFFAUDIT_EXTENSION_PATH=<unpacked dir> node out/integration/runTest.js`.
- [ ] Not yet tested: installing from Open VSX in Cursor and VSCodium, and the extension by hand on a Linux or macOS machine (CI runs the unit and integration suites there).
- [x] First release, 2026-11-06. 0.1.0 was uploaded by hand to the Visual Studio Marketplace (publisher `zhongwu`, Verifying, then live) and published to Open VSX with a one-time token (deleted afterwards; the first version of a new extension cannot use trusted publishing). Trusted publishers are registered on both: Marketplace policy "Release on tag" (repository `zhongwu/AIDiffAuditor`, workflow `publish.yml`; MdEditorExt has its own policy next to it, do not delete it) and Open VSX (namespace `zhongwu`, GitHub, extension `agent-diff-auditor`, owner `zhongwu`, repository `AIDiffAuditor`, workflow `publish.yml`, no environment). Remake either if the repository is renamed or recreated.
- [x] 0.1.1, 2026-11-06: the first release from CI. Tag `v0.1.1` ran the Publish workflow, every step passed, including `vsce publish --oidc` and `ovsx publish --trusted-publishing`, so token-free publishing works for both registries. Not checked by hand yet: that 0.1.1 is visible on both listings.
- Releasing from now on: `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and `package-lock.json`), add a CHANGELOG entry, commit and push to `main`, wait for CI, then `git tag vX.Y.Z` and `git push origin vX.Y.Z`. Watch the Publish run. The listing README and images only change with a new version; a new version shows "Verifying" for a few minutes and the public page can lag up to an hour. If the Marketplace step fails, the Open VSX step does not run; publish that one by hand or re-run the job.
- [ ] Next release (0.1.2) to carry the README screenshot and GIF to both listings.

## Phase 5: After launch
- [ ] MCP server wrapper around `src/core`.
- [ ] Collect feedback and false-positive reports; triage into rule fixes.
- [ ] Consider config-file linter idea (instruction file token cost, stale references) as a separate product.

## Risks
- False positives erode trust fast; rule precision matters more than rule count.
- Crowded space; the editor UI plus multi-language coverage is the moat, so Phases 1-2 take priority over Phase 3.
- Language model tool API availability varies by VS Code version; set `engines.vscode` accordingly and test the minimum.
