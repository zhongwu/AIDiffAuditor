import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDiff } from '../src/core/audit';
import { formatFindings } from '../src/core/format';
import { createBaseline, newSinceBaseline, parseBaseline } from '../src/core/baseline';
import { mod } from './helpers';

const skipped = (line: string): string =>
  mod('a.test.js', [`-  it('works', () => {});`, `+  ${line}`], '2,1 +2,1');

test('findings already in the baseline are not reported again', () => {
  const findings = auditDiff(skipped("it.skip('works', () => {});"));
  assert.ok(findings.length > 0);
  assert.deepEqual(newSinceBaseline(findings, createBaseline(findings)), []);
});

test('a finding that is new since the baseline is reported', () => {
  const before = auditDiff(skipped("it.skip('works', () => {});"));
  const after = auditDiff(skipped("it.skip('works', () => {});") + mod('b.test.js', ['-x', "+  xit('b', () => {});"]));
  const fresh = newSinceBaseline(after, createBaseline(before));
  assert.deepEqual(fresh.map((f) => f.file), ['b.test.js']);
});

test('a baseline finding that moved to another line still matches', () => {
  const before = auditDiff(skipped("it.skip('works', () => {});"));
  const moved = auditDiff(mod('a.test.js', [`-  it('works', () => {});`, `+  it.skip('works', () => {});`], '40,1 +40,1'));
  assert.notEqual(before[0].line, moved[0].line);
  assert.deepEqual(newSinceBaseline(moved, createBaseline(before)), []);
});

test('a second copy of the same shortcut counts as new', () => {
  const one = auditDiff(skipped("it.skip('works', () => {});"));
  const two = auditDiff(
    mod('a.test.js', [`-a`, `+  it.skip('works', () => {});`, `-b`, `+  it.skip('works', () => {});`], '2,2 +2,2'),
  );
  assert.equal(two.length, 2);
  assert.equal(newSinceBaseline(two, createBaseline(one)).length, 1);
});

test('baseline files survive a round trip and bad files are rejected', () => {
  const findings = auditDiff(skipped("it.skip('works', () => {});"));
  const baseline = createBaseline(findings);
  assert.deepEqual(parseBaseline(JSON.stringify(baseline)), baseline);
  assert.throws(() => parseBaseline('{"hello":1}'), /baseline/i);
});

test('the report says how many findings the baseline hid', () => {
  const findings = auditDiff(skipped("it.skip('works', () => {});"));
  assert.match(formatFindings(findings, 50, 3), /3 existing finding\(s\) hidden by the saved baseline/);
  assert.match(formatFindings([], 50, 2), /no suspicious changes found.*2 existing/s);
  assert.doesNotMatch(formatFindings(findings), /hidden/);
});
