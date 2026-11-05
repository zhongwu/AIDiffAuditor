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
- [ ] Gap found: the audit reports every uncommitted change, so an agent cannot tell its own changes from pre-existing ones.
      Add a session baseline (snapshot at start, report only new findings); fold into Phase 3 "mark reviewed".
- [ ] Fix what breaks; add tests for anything fixable in `src/core`.

## Phase 2: Rule quality
- [ ] Build a fixture corpus of real agent diffs (true positives) and ordinary refactors (negatives).
- [ ] Measure false-positive rate on a few real repos; tighten rules per the "prefer missing to false alarms" convention.
- [ ] Keep every rule at one positive and one negative test minimum; no rule id renames.
- [ ] Add rules: coverage-threshold lowered, timeout inflation, retries added to flaky tests.
- [ ] Widen language coverage: Python (pytest/unittest), Go, Java/Kotlin (JUnit), Rust, C#, Ruby.

## Phase 3: Workflow features
- [ ] "Mark reviewed" action so accepted findings stop reappearing.
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
