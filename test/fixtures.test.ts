import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditDiff } from '../src/core/audit';

/**
 * Whole-diff regression tests. Each `test/fixtures/<name>.patch` is a realistic diff shaped like
 * what an AI agent produces, and `expected.json` lists exactly the findings it must produce as
 * `ruleId|severity|file`. Extra findings fail too, so false alarms are caught as well as misses.
 * Fixtures named `clean-*` are legitimate changes and must produce no findings.
 */
const dir = join(__dirname, '..', '..', 'test', 'fixtures');
const expected: Record<string, string[]> = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
const patches = readdirSync(dir).filter((f) => f.endsWith('.patch')).map((f) => f.replace(/\.patch$/, ''));

for (const name of patches) {
  test(`fixture: ${name}`, () => {
    const diff = readFileSync(join(dir, `${name}.patch`), 'utf8');
    const actual = auditDiff(diff).map((f) => `${f.ruleId}|${f.severity}|${f.file}`).sort();
    const want = name.startsWith('clean-') ? [] : [...(expected[name] ?? [])].sort();
    assert.deepEqual(actual, want);
  });
}

test('every fixture has an expectation and every expectation has a fixture', () => {
  const needed = patches.filter((n) => !n.startsWith('clean-'));
  assert.deepEqual(Object.keys(expected).sort(), needed.sort());
});
