# Development plan

Goal: ship Agent Diff Auditor to the VS Code Marketplace and Open VSX, keeping the three
differentiators: editor UI for the rules, non-JS test framework coverage, agent-callable tool.

## Phase 0: Repo hygiene (small, do first)
- [x] Add LICENSE (MIT unless decided otherwise) and set `license` in package.json.
- [x] Add `.gitattributes` (`* text=auto eol=lf`) to stop the CRLF warnings.
- [x] Add CI (GitHub Actions): `npm ci`, compile, `npm test` on Windows and Linux.
- [x] Decide whether CLAUDE.md / SESSION-NOTES.md / BRAINSTORM.md stay local-only (staying local in .gitignore).

## Phase 1: Verify the UI (blocker for everything else)
- [ ] Press F5 and run in an Extension Development Host against a scratch git repo.
- [ ] Walk through: audit command, tree view, diagnostics (squiggles), status bar, settings
      (`diffAuditor.ignoreRules`, fail-on severity).
- [ ] Check edge cases: no git repo, no changes, untracked files, binary files, large diffs, multi-root workspaces.
- [ ] Verify the `diffAuditor_auditChanges` language model tool is callable from Copilot agent mode / Claude Code.
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
