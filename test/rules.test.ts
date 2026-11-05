import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDiff } from '../src/core/audit';
import { added, deleted, mod } from './helpers';

const ids = (diff: string): string[] => auditDiff(diff).map((f) => f.ruleId);

test('a clean change produces no findings', () => {
  assert.deepEqual(ids(mod('src/a.ts', ['-const a = 1;', '+const a = 2;'])), []);
});

// --- tests being removed or switched off -----------------------------------

test('flags a deleted test file', () => {
  const findings = auditDiff(deleted('src/foo.test.ts', ["it('a', () => {});"]));
  assert.deepEqual(findings.map((f) => [f.ruleId, f.severity]), [['test-file-deleted', 'high']]);
});

test('flags skipped tests across frameworks', () => {
  const cases: [string, string][] = [
    ['src/a.test.ts', "+  it.skip('works', () => {"],
    ['src/a.test.ts', "+xdescribe('suite', () => {"],
    ['tests/test_a.py', '+@pytest.mark.skip(reason="flaky")'],
    ['pkg/a_test.go', '+\tt.Skip("later")'],
    ['src/ATest.java', '+  @Disabled'],
    ['src/lib.rs', '+#[ignore]'],
  ];
  for (const [path, line] of cases) {
    assert.ok(ids(mod(path, [line])).includes('test-skipped'), `${path}: ${line}`);
  }
});

test('does not flag a commented-out skip or a normal test', () => {
  assert.deepEqual(ids(mod('src/a.test.ts', ['+// it.skip is not used here'])), []);
  assert.deepEqual(ids(mod('src/a.test.ts', ["+it('works', () => {"])), []);
});

test('turning a test into a skipped test is not reported as a removed test', () => {
  const found = ids(mod('src/a.test.ts', ["-it('works', () => {", "+it.skip('works', () => {"]));
  assert.ok(found.includes('test-skipped'));
  assert.ok(!found.includes('test-removed'));
});

test('flags focused tests only in test files', () => {
  assert.ok(ids(mod('src/a.test.ts', ["+it.only('works', () => {"])).includes('test-focused'));
  assert.deepEqual(ids(mod('src/ml.py', ['+fit(model)'])), []);
});

test('flags test cases that were removed without replacement', () => {
  const found = ids(mod('src/a.test.ts', ["-it('one', () => {", "-it('two', () => {", "+it('one', () => {"]));
  assert.ok(found.includes('test-removed'));
});

// --- assertions ------------------------------------------------------------

test('flags removed assertions', () => {
  const found = ids(mod('tests/test_math.py', ['-    assert add(1, 2) == 3', '+    pass']));
  assert.ok(found.includes('assertion-removed'));
});

test('does not flag an assertion that was edited or moved', () => {
  assert.deepEqual(ids(mod('src/a.test.ts', ['-  expect(a).toBe(1);', '+  expect(a).toBe(2);'])), []);
});

test('flags a precise assertion replaced by a weak one', () => {
  const findings = auditDiff(mod('src/a.test.ts', ['-  expect(res.status).toBe(200);', '+  expect(res).toBeTruthy();']));
  assert.deepEqual(findings.map((f) => f.ruleId), ['assertion-weakened']);
  assert.equal(findings[0].line, 1);
});

test('does not flag a weak matcher added without removing an assertion', () => {
  assert.deepEqual(ids(mod('src/a.test.ts', ['+  expect(res).toBeTruthy();'])), []);
});

test('flags assertions that can never fail', () => {
  assert.ok(ids(mod('src/a.test.ts', ['+  expect(true).toBe(true);'])).includes('tautology-assertion'));
  assert.ok(ids(mod('tests/test_a.py', ['+    assert True'])).includes('tautology-assertion'));
  assert.ok(ids(mod('tests/test_a.py', ['+    assert x == x'])).includes('tautology-assertion'));
  assert.deepEqual(ids(mod('tests/test_a.py', ['+    assert x == y'])), []);
});

// --- suppressions and swallowed errors -------------------------------------

test('flags suppression comments with the right severity', () => {
  const sev = (path: string, line: string): string[] => auditDiff(mod(path, [line])).map((f) => f.severity);
  assert.deepEqual(sev('src/a.ts', '+// @ts-ignore'), ['medium']);
  assert.deepEqual(sev('src/a.ts', '+// @ts-nocheck'), ['high']);
  assert.deepEqual(sev('src/a.ts', '+/* eslint-disable */'), ['high']);
  assert.deepEqual(sev('src/a.ts', '+foo(); // eslint-disable-line no-console'), ['medium']);
  assert.deepEqual(sev('src/a.py', '+x = y  # type: ignore'), ['medium']);
  assert.deepEqual(sev('src/a.py', '+import os  # noqa'), ['medium']);
});

test('ignores suppression-looking text in non-code files', () => {
  assert.deepEqual(ids(mod('README.md', ['+Use // @ts-ignore sparingly.'])), []);
});

test('flags empty catch blocks on one line and across two lines', () => {
  assert.deepEqual(ids(mod('src/a.ts', ['+try { run(); } catch (e) {}'])), ['empty-catch']);
  assert.deepEqual(ids(mod('src/a.ts', ['+  } catch (e) {', '+  }'])), ['empty-catch']);
  assert.deepEqual(ids(mod('src/a.ts', ['+  promise.catch(() => {});'])), ['empty-catch']);
  assert.deepEqual(ids(mod('src/a.py', ['+except ValueError:', '+    pass'])), ['empty-catch']);
});

test('does not flag a catch block that does something', () => {
  assert.deepEqual(ids(mod('src/a.ts', ['+  } catch (e) {', '+    log(e);', '+  }'])), []);
});

// --- CI --------------------------------------------------------------------

test('flags CI steps that can no longer fail the build', () => {
  const found = auditDiff(mod('.github/workflows/ci.yml', ['+        continue-on-error: true']));
  assert.deepEqual(found.map((f) => [f.ruleId, f.severity]), [['ci-weakened', 'high']]);
  assert.deepEqual(ids(mod('Makefile', ['+\tnpm test || true'])), ['ci-weakened']);
});

test('flags a package.json test script replaced by a no-op', () => {
  assert.deepEqual(ids(mod('package.json', ['+    "test": "echo skipped"'])), ['ci-weakened']);
  assert.deepEqual(ids(mod('package.json', ['+    "test": "vitest run"'])), []);
});

test('flags a test command removed from CI', () => {
  assert.deepEqual(ids(mod('.github/workflows/ci.yml', ['-      - run: npm test'])), ['ci-test-removed']);
  assert.deepEqual(
    ids(mod('.github/workflows/ci.yml', ['-      - run: npm test', '+      - run: pnpm test'])),
    [],
  );
});

// --- options and ordering --------------------------------------------------

test('new files are audited like any other change', () => {
  assert.ok(ids(added('src/new.test.ts', ["it.skip('later', () => {});"])).includes('test-skipped'));
});

test('findings are sorted by severity, and options filter them', () => {
  const diff = [
    mod('src/a.ts', ['+// @ts-ignore']),
    mod('src/b.test.ts', ["+it.skip('x', () => {});"]),
  ].join('\n');

  assert.deepEqual(auditDiff(diff).map((f) => f.severity), ['high', 'medium']);
  assert.deepEqual(auditDiff(diff, { minSeverity: 'high' }).map((f) => f.ruleId), ['test-skipped']);
  assert.deepEqual(auditDiff(diff, { ignoreRules: ['test-skipped'] }).map((f) => f.ruleId), ['suppression-added']);
});

test('skips lockfiles, snapshots and build output', () => {
  assert.deepEqual(ids(mod('dist/app.js', ['+// @ts-ignore'])), []);
  assert.deepEqual(ids(mod('src/__snapshots__/a.test.ts.snap', ['+it.skip'])), []);
});

// --- false-alarm fixes found by auditing real repository history -------------

const sevs = (diff: string): string[] => auditDiff(diff).map((f) => `${f.ruleId}:${f.severity}`);

test('docs that mention it.skip are not reported as a skipped test', () => {
  assert.deepEqual(ids(mod('README.md', ['+Use `it.skip` only with a ticket number.'])), []);
  assert.deepEqual(ids(mod('docs/PLAN.md', ['+| `test-skipped` | high | `it.skip`, `xit`, `t.Skip` |'])), []);
  assert.deepEqual(ids(mod('src/a.test.ts', ["+  it.skip('x', () => {});"])), ['test-skipped']);
});

test('a pattern inside a string literal is not a real skip, suppression or tautology', () => {
  assert.deepEqual(ids(mod('src/a.test.ts', ['+  const src = "it.skip(\'works\', () => {})";'])), []);
  assert.deepEqual(ids(mod('src/a.ts', ["+  const s = '// @ts-ignore';"])), []);
  assert.deepEqual(ids(mod('src/a.test.ts', ['+  const t = "expect(true).toBe(true)";'])), []);
  // The same text as real code, and a trailing comment after a string, are still caught.
  assert.deepEqual(ids(mod('src/a.ts', ['+  const s = "it\'s fine"; // @ts-ignore'])), ['suppression-added']);
  assert.deepEqual(ids(mod('src/a.ts', ['+  foo(); // eslint-disable-line no-console'])), ['suppression-added']);
});

test('many weakened assertions in one hunk are reported once', () => {
  const diff = mod(
    'src/a.test.ts',
    [
      '-    expect(pts).toHaveLength(2);',
      '-    expect(pts[0].timestamp).toBe(1000);',
      '+    expect(pts.length).toBeGreaterThan(0);',
      '+    expect(pts[0].timestamp).toBeGreaterThan(0);',
      '+    expect(pts[0].open).toBeDefined();',
    ],
    '10,2 +10,3',
  );
  const found = auditDiff(diff).filter((f) => f.ruleId === 'assertion-weakened');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /3 assertions/);
});

test('best-effort cleanup in a try/catch is not reported', () => {
  assert.deepEqual(ids(mod('src/A.cs', ['+  try { Directory.Delete(_dir, true); } catch { }'])), []);
  assert.deepEqual(ids(mod('src/a.ts', ['+  try { fs.unlinkSync(p); } catch {}'])), []);
  assert.deepEqual(ids(mod('src/a.ts', ['+  try { run(); } catch {}'])), ['empty-catch']);
});

test('deliberate-looking empty catches are low severity, bare ones stay medium', () => {
  assert.deepEqual(sevs(mod('src/T.cs', ['+  catch (TimeoutException) { }'])), ['empty-catch:low']);
  assert.deepEqual(sevs(mod('src/S.cs', ['+  catch { /* work() never throws */ }'])), ['empty-catch:low']);
  assert.deepEqual(sevs(mod('src/a.ts', ['+  load().catch(() => {});'])), ['empty-catch:low']);
  assert.deepEqual(sevs(mod('src/a.ts', ['+  try { run(); } catch (e) {}'])), ['empty-catch:medium']);
  assert.deepEqual(sevs(mod('src/A.cs', ['+  catch { }'])), ['empty-catch:medium']);
  assert.deepEqual(sevs(mod('src/A.cs', ['+  catch (Exception) { }'])), ['empty-catch:medium']);
  assert.deepEqual(sevs(mod('src/a.py', ['+except:', '+    pass'])), ['empty-catch:medium']);
});

// --- coverage thresholds, timeouts and retries -------------------------------

const only = (diff: string, rule: string) => auditDiff(diff).filter((f) => f.ruleId === rule);

test('flags a lowered coverage threshold', () => {
  const jest = mod('jest.config.js', ['-    lines: 80,', '+    lines: 60,']);
  assert.equal(only(jest, 'coverage-lowered').length, 1);
  assert.match(only(jest, 'coverage-lowered')[0].message, /from 80 to 60/);
  assert.equal(only(mod('pyproject.toml', ['-fail_under = 90', '+fail_under = 70']), 'coverage-lowered').length, 1);
  assert.equal(only(mod('Makefile', ['-\tpytest --cov-fail-under=85', '+\tpytest --cov-fail-under=50']), 'coverage-lowered').length, 1);
  assert.equal(only(mod('package.json', ['-      "branches": 75', '+      "branches": 40']), 'coverage-lowered').length, 1);
});

test('does not flag a raised threshold, an unrelated number, or a non-config file', () => {
  assert.deepEqual(only(mod('jest.config.js', ['-    lines: 60,', '+    lines: 80,']), 'coverage-lowered'), []);
  assert.deepEqual(only(mod('jest.config.js', ['-    lines: 80,', '+    lines: 80,', '+    verbose: true']), 'coverage-lowered'), []);
  assert.deepEqual(only(mod('src/table.ts', ['-  lines: 80,', '+  lines: 20,']), 'coverage-lowered'), []);
  // Only one side of the change is present, so there is nothing to compare.
  assert.deepEqual(only(mod('jest.config.js', ['+    lines: 10,']), 'coverage-lowered'), []);
});

test('flags a test timeout that was raised a lot', () => {
  const small = only(mod('src/a.test.ts', ["-it('slow', async () => {}, { timeout: 5000 });", "+it('slow', async () => {}, { timeout: 20000 });"]), 'timeout-inflated');
  assert.deepEqual(small.map((f) => f.severity), ['low']);
  const big = only(mod('vitest.config.ts', ['-    testTimeout: 5_000,', '+    testTimeout: 120_000,']), 'timeout-inflated');
  assert.deepEqual(big.map((f) => f.severity), ['medium']);
  assert.equal(only(mod('jest.config.js', ['-  testTimeout: 5000,', '+  testTimeout: 60 * 1000,']), 'timeout-inflated').length, 1);
  assert.equal(only(mod('.github/workflows/ci.yml', ['-    timeout-minutes: 10', '+    timeout-minutes: 60']), 'timeout-inflated').length, 1);
  assert.equal(only(mod('tests/test_a.py', ['-@pytest.mark.timeout(5)', '+@pytest.mark.timeout(60)']), 'timeout-inflated').length, 1);
});

test('does not flag small timeout changes, lowered timeouts, or timeouts outside tests', () => {
  assert.deepEqual(only(mod('src/a.test.ts', ['-  { timeout: 5000 }', '+  { timeout: 8000 }']), 'timeout-inflated'), []);
  assert.deepEqual(only(mod('src/a.test.ts', ['-  { timeout: 5000 }', '+  { timeout: 1000 }']), 'timeout-inflated'), []);
  assert.deepEqual(only(mod('src/client.ts', ['-  timeout: 1000,', '+  timeout: 30000,']), 'timeout-inflated'), []);
});

test('flags retries added to tests', () => {
  assert.equal(only(mod('src/a.test.ts', ['+jest.retryTimes(3);']), 'retries-added').length, 1);
  assert.equal(only(mod('cypress.config.ts', ['+  retries: 2,']), 'retries-added').length, 1);
  assert.equal(only(mod('tests/test_a.py', ['+@pytest.mark.flaky(reruns=3)']), 'retries-added').length, 1);
  assert.equal(only(mod('Makefile', ['+\tpytest --reruns 3']), 'retries-added').length, 1);
  assert.equal(only(mod('.mocharc.json', ['+  "retries": 2']), 'retries-added').length, 1);
});

test('does not flag zero retries, retry logic in app code, or a comment', () => {
  assert.deepEqual(only(mod('cypress.config.ts', ['+  retries: 0,']), 'retries-added'), []);
  assert.deepEqual(only(mod('src/http.ts', ['+  retries: 3,']), 'retries-added'), []);
  assert.deepEqual(only(mod('src/a.test.ts', ['+// jest.retryTimes(3) would hide the flake']), 'retries-added'), []);
});

test('catches a mocha timeout raised in a VS Code extension test config (seen in a real repo)', () => {
  const found = only(
    mod('.vscode-test.mjs', ["-  mocha: { ui: 'tdd', timeout: 20000 },", "+  mocha: { ui: 'tdd', timeout: 60000 },"]),
    'timeout-inflated',
  );
  assert.deepEqual(found.map((f) => [f.severity, f.message]), [['low', 'Timeout raised from 20000 to 60000']]);
});
