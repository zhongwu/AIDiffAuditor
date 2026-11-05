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
- [ ] Build a fixture corpus of real agent diffs (true positives) and ordinary refactors (negatives). Needs real agent output; human commit history only gives negatives.
- [x] First false-positive pass: `node scripts/audit-history.js <repo>...` audits every past commit of real repos (read-only).
      On 5 repos / 203 commits: 37 findings -> 27, and only 9 at medium or above (18 are low). Fixed: docs mentioning `it.skip`
      flagged HIGH, patterns inside string literals, one finding per weakened hunk, empty-catch noise (cleanup skipped, typed/commented/promise catches low).
- [ ] Still to measure: a larger or different mix of repos (Python, Go, Java), and diffs from real agent sessions rather than human history.
- [ ] Known false alarm: regex/pattern tables in linting tools (this repo's own `rules.ts`) look like suppressions.
- [ ] Keep every rule at one positive and one negative test minimum; no rule id renames.
- [x] New rules: `coverage-lowered`, `timeout-inflated`, `retries-added` (before/after comparison of numbers, restricted to test files, test configs and CI). 0 false alarms on 203 real commits; caught 1 real timeout bump (20s to 60s).
- [ ] Widen language coverage: Python (pytest/unittest), Go, Java/Kotlin (JUnit), Rust, C#, Ruby.

## Phase 3: Workflow features
- [ ] "Mark reviewed" for individual findings (accept one without baselining everything). The session baseline already covers the "ignore everything that exists now" case.
- [ ] Shared team config file (committed, e.g. `.diffauditor.json`) read by both extension and CLI.
- [ ] Baseline / compare against a chosen ref (branch or commit), not just working tree.
- [ ] CLI polish: JSON and SARIF output, docs for pre-commit hook and CI use.

## Phase 4: Pre-release
- [ ] Re-check Marketplace and Open VSX for competitors (Critical Gate, BotsIQ Change Verifier, checkwash, tightdiff).
- [ ] Create a publisher, replace the placeholder `publisher` in package.json.
- [ ] Icon, README screenshots/GIF, CHANGELOG, categories and keywords.
- [ ] `vsce package`, install the .vsix in a clean profile, smoke test.
- [ ] Publish 0.1.0 as pre-release to both registries.

## Phase 5: After launch
- [ ] MCP server wrapper around `src/core`.
- [ ] Collect feedback and false-positive reports; triage into rule fixes.
- [ ] Consider config-file linter idea (instruction file token cost, stale references) as a separate product.

## Risks
- False positives erode trust fast; rule precision matters more than rule count.
- Crowded space; the editor UI plus multi-language coverage is the moat, so Phases 1-2 take priority over Phase 3.
- Language model tool API availability varies by VS Code version; set `engines.vscode` accordingly and test the minimum.
