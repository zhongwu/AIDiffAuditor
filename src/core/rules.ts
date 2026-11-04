import { isCodeFile, isCommentLine, isTestFile } from './patterns';
import type { DiffLine, FileDiff, Finding, Rule, Severity } from './types';

// ---------------------------------------------------------------------------
// Patterns. These are heuristics on diff text, not a parser: they are tuned to
// miss a few things rather than cry wolf. Each has a matching unit test.
// ---------------------------------------------------------------------------

/** Something that checks a result: expect(), assert*, should, EXPECT_*, t.Error... */
const ASSERT_RE =
  /\bexpect\s*\(|\bassert\w*\s*!?\(|\bassert\s+\S|\.should\b|\b(?:EXPECT|ASSERT)_\w+|\bt\.(?:Error|Errorf|Fatal|Fatalf)\(/;

/** Start of a test case. */
const TEST_DECL_RE =
  /^\s*(?:(?:it|test)(?:\.(?:only|skip|concurrent))?\s*\(|(?:async\s+)?def\s+test_|func\s+Test\w+\s*\(|@Test\b|#\[test\]|(?:it|specify)\s+['"])/;

/** A test that is switched off. */
const SKIP_RE =
  /\b(?:it|test|describe|context|suite)\.skip\b|\bx(?:it|describe|test|context)\b\s*[('"`]|@pytest\.mark\.(?:skip|xfail)|@unittest\.(?:skip|expectedFailure)|\bpytest\.skip\(|\bself\.skipTest\(|\bt\.Skip(?:f|Now)?\(|@Disabled\b|@Ignore\b|#\[ignore\b|\bmarkTest(?:Skipped|Incomplete)\(/;

/** `.only` / `fit` run a single test and silently drop the rest of the suite. */
const FOCUS_RE = /\b(?:it|test|describe|context)\.only\s*\(|\bf(?:it|describe|context)\s*\(/;

/** Assertions that can never fail. */
const TAUTOLOGY_RE =
  /\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*(?:true|1)\s*\)|\bassert\s+True\b|\bassert(?:True|\.ok|\.isTrue)?\s*\(\s*(?:true|True|1)\s*[,)]|\bassert\s+(\w+)\s*==\s*\1\b/;

/** Matchers that accept almost any value; suspicious when they replace a precise check. */
const WEAK_MATCHER_RE =
  /\.(?:toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull)\s*\(\s*\)|\bexpect\.(?:anything|any)\s*\(|\.not\.toThrow\s*\(\s*\)|\.toBeGreaterThan\s*\(\s*0\s*\)|\bassert(?:True|NotNone|IsNotNone|NotNull)\s*\(/;

const SUPPRESSIONS: { re: RegExp; label: string; severity: Severity }[] = [
  { re: /@ts-nocheck\b/, label: '@ts-nocheck turns off type checking for the whole file', severity: 'high' },
  { re: /@ts-(?:ignore|expect-error)\b/, label: 'type error suppressed with @ts-ignore / @ts-expect-error', severity: 'medium' },
  { re: /eslint-disable(?!-)/, label: 'eslint-disable without a line scope turns rules off for a whole block or file', severity: 'high' },
  { re: /eslint-disable-(?:next-)?line\b/, label: 'lint error suppressed with eslint-disable', severity: 'medium' },
  { re: /#\s*mypy:\s*ignore-errors/, label: '# mypy: ignore-errors turns off type checking for the whole file', severity: 'high' },
  { re: /#\s*type:\s*ignore\b|#\s*pyright:\s*ignore\b/, label: 'type error suppressed with a type-ignore comment', severity: 'medium' },
  { re: /#\s*noqa\b|#\s*pylint:\s*disable|#\s*rubocop:disable/i, label: 'lint error suppressed', severity: 'medium' },
  { re: /\/\/\s*(?:nolint|NOLINT)\b|\/\/\s*biome-ignore\b|NOSONAR/, label: 'lint error suppressed', severity: 'medium' },
  { re: /#!?\[allow\(/, label: 'Rust warning silenced with #[allow(...)]', severity: 'medium' },
  { re: /@SuppressWarnings\b|#pragma\s+warning\s+disable|@phpstan-ignore|@psalm-suppress/, label: 'compiler or analyzer warning suppressed', severity: 'medium' },
  { re: /(?:istanbul|c8|v8)\s+ignore\b|#\s*pragma:\s*no cover/, label: 'code excluded from coverage', severity: 'medium' },
];

const EMPTY_CATCH_ONE_LINE: RegExp[] = [
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*.*?\*\/)?\s*\}/,
  /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*\{\s*\}\s*\)/,
  /\bexcept\b[^:\n]*:\s*pass\b/,
];
const CATCH_OPEN_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/;
const EXCEPT_OPEN_RE = /^\s*except\b[^:]*:\s*$/;

const CI_YAML_RE =
  /(?:^|\/)(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|azure-pipelines[^/]*\.ya?ml|\.circleci\/[^/]+|\.travis\.ya?ml|bitbucket-pipelines\.ya?ml|Jenkinsfile)$/;
const BUILD_FILE_RE = /(?:^|\/)(?:Makefile|justfile|tox\.ini|package\.json)$/;
const PKG_TEST_SCRIPT_RE = /"test(?::[\w-]+)?"\s*:\s*"(?:echo\b|exit\s+0|true\b|:)/;
const TEST_COMMAND_RE =
  /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?test\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bmvn\s+test\b|\bgradlew?\s+test\b|\bjest\b|\bvitest\b/;

const CI_WEAKENERS: { re: RegExp; label: string; severity: Severity; ciOnly?: boolean }[] = [
  { re: /continue-on-error:\s*true/i, label: '`continue-on-error: true` lets a failing step pass', severity: 'high', ciOnly: true },
  { re: /allow_failure:\s*true/i, label: '`allow_failure: true` lets a failing job pass', severity: 'high', ciOnly: true },
  { re: /--exit-zero\b/, label: '`--exit-zero` forces a success exit code', severity: 'high' },
  { re: /\|\|\s*(?:true|exit\s+0|:)(?:\s|$|;)/, label: '`|| true` swallows a failing command', severity: 'medium' },
  { re: /--passWithNoTests\b/, label: '`--passWithNoTests` lets an empty test run pass', severity: 'medium' },
  { re: /--no-verify\b/, label: '`--no-verify` skips git hooks', severity: 'medium' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snippet(text: string): string {
  const t = text.trim();
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
}

function at(ruleId: string, severity: Severity, file: FileDiff, line: DiffLine, message: string): Finding {
  return { ruleId, severity, file: file.path, line: line.anchorLine, message, snippet: snippet(line.text) };
}

function allLines(file: FileDiff): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines);
}

const added = (file: FileDiff): DiffLine[] => allLines(file).filter((l) => l.type === 'add');
const removed = (file: FileDiff): DiffLine[] => allLines(file).filter((l) => l.type === 'del');

const isAssertion = (l: DiffLine): boolean => !isCommentLine(l.text) && ASSERT_RE.test(l.text);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const testFileDeleted: Rule = {
  id: 'test-file-deleted',
  description: 'A test file was deleted.',
  run(file) {
    if (file.status !== 'deleted' || !isTestFile(file.path)) {
      return [];
    }
    return [{ ruleId: this.id, severity: 'high', file: file.path, line: 1, message: 'Test file deleted' }];
  },
};

const testSkipped: Rule = {
  id: 'test-skipped',
  description: 'A test was switched off with skip / xit / @Disabled / t.Skip and similar.',
  run(file) {
    return added(file)
      .filter((l) => !isCommentLine(l.text) && SKIP_RE.test(l.text))
      .map((l) => at(this.id, 'high', file, l, 'Test skipped or disabled'));
  },
};

const testFocused: Rule = {
  id: 'test-focused',
  description: 'A test was focused with .only / fit, so the rest of the suite stops running.',
  run(file) {
    if (!isTestFile(file.path)) {
      return [];
    }
    return added(file)
      .filter((l) => !isCommentLine(l.text) && FOCUS_RE.test(l.text))
      .map((l) => at(this.id, 'medium', file, l, 'Focused test (.only / fit) hides the rest of the suite'));
  },
};

const testRemoved: Rule = {
  id: 'test-removed',
  description: 'More test cases were removed from a file than were added.',
  run(file) {
    if (!isTestFile(file.path) || file.status === 'deleted') {
      return [];
    }
    const gone = removed(file).filter((l) => TEST_DECL_RE.test(l.text));
    const fresh = added(file).filter((l) => TEST_DECL_RE.test(l.text));
    if (gone.length <= fresh.length) {
      return [];
    }
    return [
      at(this.id, 'medium', file, gone[0], `${gone.length} test case(s) removed, ${fresh.length} added`),
    ];
  },
};

const assertionRemoved: Rule = {
  id: 'assertion-removed',
  description: 'More assertions were removed from a test file than were added.',
  run(file) {
    if (!isTestFile(file.path) || file.status === 'deleted') {
      return [];
    }
    const gone = removed(file).filter(isAssertion);
    const fresh = added(file).filter(isAssertion);
    if (gone.length <= fresh.length) {
      return [];
    }
    return [
      at(this.id, 'high', file, gone[0], `${gone.length} assertion(s) removed, only ${fresh.length} added`),
    ];
  },
};

const assertionWeakened: Rule = {
  id: 'assertion-weakened',
  description: 'A precise assertion was replaced by one that accepts almost any value.',
  run(file) {
    if (!isTestFile(file.path) || file.status === 'deleted') {
      return [];
    }
    const out: Finding[] = [];
    for (const hunk of file.hunks) {
      if (!hunk.lines.some((l) => l.type === 'del' && isAssertion(l))) {
        continue;
      }
      for (const l of hunk.lines) {
        if (l.type === 'add' && !isCommentLine(l.text) && WEAK_MATCHER_RE.test(l.text)) {
          out.push(at(this.id, 'medium', file, l, 'Assertion may be weaker than the one it replaced'));
        }
      }
    }
    return out;
  },
};

const tautologyAssertion: Rule = {
  id: 'tautology-assertion',
  description: 'An assertion that can never fail, such as expect(true).toBe(true).',
  run(file) {
    if (!isTestFile(file.path)) {
      return [];
    }
    return added(file)
      .filter((l) => !isCommentLine(l.text) && TAUTOLOGY_RE.test(l.text))
      .map((l) => at(this.id, 'high', file, l, 'Assertion can never fail'));
  },
};

const suppressionAdded: Rule = {
  id: 'suppression-added',
  description: 'A type, lint or coverage suppression comment was added.',
  run(file) {
    if (!isCodeFile(file.path)) {
      return [];
    }
    const out: Finding[] = [];
    for (const l of added(file)) {
      const hit = SUPPRESSIONS.find((s) => s.re.test(l.text));
      if (hit) {
        out.push(at(this.id, hit.severity, file, l, `Suppression added: ${hit.label}`));
      }
    }
    return out;
  },
};

const emptyCatch: Rule = {
  id: 'empty-catch',
  description: 'An error is caught and silently ignored.',
  run(file) {
    if (!isCodeFile(file.path)) {
      return [];
    }
    const out: Finding[] = [];
    const message = 'Error swallowed by an empty catch / except block';
    for (const hunk of file.hunks) {
      const lines = hunk.lines;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.type !== 'add' || isCommentLine(l.text)) {
          continue;
        }
        if (EMPTY_CATCH_ONE_LINE.some((re) => re.test(l.text))) {
          out.push(at(this.id, 'medium', file, l, message));
          continue;
        }
        const next = lines[i + 1];
        if (!next || next.type !== 'add' || next.newLine !== (l.newLine ?? 0) + 1) {
          continue;
        }
        if ((CATCH_OPEN_RE.test(l.text) && /^\s*\}/.test(next.text)) ||
            (EXCEPT_OPEN_RE.test(l.text) && /^\s*pass\s*(?:#.*)?$/.test(next.text))) {
          out.push(at(this.id, 'medium', file, l, message));
        }
      }
    }
    return out;
  },
};

const ciWeakened: Rule = {
  id: 'ci-weakened',
  description: 'A CI or build step was changed so that failures no longer fail the build.',
  run(file) {
    const isCi = CI_YAML_RE.test(file.path);
    if (!isCi && !BUILD_FILE_RE.test(file.path)) {
      return [];
    }
    const out: Finding[] = [];
    for (const l of added(file)) {
      if (file.path.endsWith('package.json') && PKG_TEST_SCRIPT_RE.test(l.text)) {
        out.push(at(this.id, 'high', file, l, 'The test script was replaced with a command that always succeeds'));
        continue;
      }
      const hit = CI_WEAKENERS.find((w) => (isCi || !w.ciOnly) && w.re.test(l.text));
      if (hit) {
        out.push(at(this.id, hit.severity, file, l, hit.label));
      }
    }
    return out;
  },
};

const ciTestRemoved: Rule = {
  id: 'ci-test-removed',
  description: 'A test command was removed from a CI pipeline.',
  run(file) {
    if (!CI_YAML_RE.test(file.path)) {
      return [];
    }
    const gone = removed(file).filter((l) => !isCommentLine(l.text) && TEST_COMMAND_RE.test(l.text));
    const fresh = added(file).filter((l) => !isCommentLine(l.text) && TEST_COMMAND_RE.test(l.text));
    if (gone.length <= fresh.length) {
      return [];
    }
    return [at(this.id, 'medium', file, gone[0], 'A test command was removed from the CI pipeline')];
  },
};

export const RULES: Rule[] = [
  testFileDeleted,
  testSkipped,
  testFocused,
  testRemoved,
  assertionRemoved,
  assertionWeakened,
  tautologyAssertion,
  suppressionAdded,
  emptyCatch,
  ciWeakened,
  ciTestRemoved,
];
