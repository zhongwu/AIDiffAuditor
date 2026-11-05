import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditDiff } from '../src/core/audit';
import { globToRegExp, parseConfig, pathMatcher, unknownRuleIds } from '../src/core/config';
import { RULES } from '../src/core/rules';
import { added, mod } from './helpers';

test('a valid config is read', () => {
  const c = parseConfig('{"ignoreRules":["retries-added"],"minSeverity":"medium","ignorePaths":["legacy/**"],"baseRef":" origin/main "}');
  assert.deepEqual(c, { ignoreRules: ['retries-added'], minSeverity: 'medium', ignorePaths: ['legacy/**'], baseRef: 'origin/main' });
  assert.deepEqual(parseConfig('{}'), {});
  assert.deepEqual(parseConfig('{"$schema":"./x.json"}'), {});
});

test('a broken config says what is wrong', () => {
  assert.throws(() => parseConfig('{nope'), /not valid JSON/);
  assert.throws(() => parseConfig('[]'), /JSON object/);
  assert.throws(() => parseConfig('{"ignoreRule":[]}'), /unknown option "ignoreRule"/);
  assert.throws(() => parseConfig('{"minSeverity":"critical"}'), /minSeverity/);
  assert.throws(() => parseConfig('{"ignoreRules":"retries-added"}'), /ignoreRules.*list/);
  assert.throws(() => parseConfig('{"ignorePaths":[""]}'), /ignorePaths/);
  assert.throws(() => parseConfig('{"baseRef":""}'), /baseRef/);
});

test('misspelled rule ids are reported, real ones are not', () => {
  assert.deepEqual(unknownRuleIds(['test-skiped', 'test-skipped']), ['test-skiped']);
  assert.deepEqual(unknownRuleIds(undefined), []);
});

test('globs match like gitignore patterns', () => {
  const m = (glob: string, path: string): boolean => globToRegExp(glob).test(path);
  assert.ok(m('legacy/**', 'legacy/a/b.ts'));
  assert.ok(m('legacy/', 'legacy/a.ts'));
  assert.ok(m('*.generated.ts', 'src/deep/api.generated.ts'));
  assert.ok(m('**/fixtures/**', 'test/fixtures/x.patch'));
  assert.ok(m('src/*.ts', 'src/a.ts'));
  assert.ok(m('a?.ts', 'ab.ts'));
  assert.ok(!m('legacy/**', 'src/legacy/a.ts'));
  assert.ok(!m('src/*.ts', 'src/deep/a.ts'));
  assert.ok(!m('*.generated.ts', 'src/api.generated.tsx'));
  assert.ok(!m('a?.ts', 'a/b.ts'));
  assert.ok(!pathMatcher(undefined)('anything.ts'));
});

test('ignorePaths leaves matching files out of the audit', () => {
  const diff =
    mod('legacy/old.test.js', ['-x', '+it.skip("a", () => {});']) + mod('src/new.test.js', ['-x', '+it.skip("b", () => {});']);
  assert.equal(auditDiff(diff).length, 2);
  assert.deepEqual(auditDiff(diff, { ignorePaths: ['legacy/**'] }).map((f) => f.file), ['src/new.test.js']);
});

test('ignored files cannot cancel moved lines in other files', () => {
  const lines = ['    assert compute_total(items) == 125', '    assert compute_total([]) == 0'];
  const diff =
    mod('tests/test_a.py', lines.map((l) => `-${l}`)) + added('vendored/copy_test.py', lines);
  assert.deepEqual(auditDiff(diff).map((f) => f.ruleId), []);
  assert.deepEqual(auditDiff(diff, { ignorePaths: ['vendored/**'] }).map((f) => f.ruleId), ['assertion-removed']);
});

test('the json schema lists exactly the rule ids that exist', () => {
  const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', 'schemas', 'diffauditor.schema.json'), 'utf8'));
  assert.deepEqual([...schema.properties.ignoreRules.items.enum].sort(), RULES.map((r) => r.id).sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'baseRef', 'ignorePaths', 'ignoreRules', 'minSeverity']);
});

// --- the CLI reads the file in a real repository -------------------------------

const CLI = join(__dirname, '..', '..', 'out', 'src', 'cli.js');

function repoWithSkips(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diffaudit-cfg-'));
  const git = (...a: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  writeFileSync(join(dir, 'README.md'), '# x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(dir, 'a.test.js'), "it.skip('a', () => {});\n");
  writeFileSync(join(dir, 'b.test.js'), "it('b', () => { // @ts-ignore\n});\n");
  return dir;
}

const run = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, '--json', '--fail-on', 'never', ...args], { cwd: dir, encoding: 'utf8' });

test('the CLI applies ignoreRules, ignorePaths and minSeverity from .diffauditor.json', () => {
  const dir = repoWithSkips();
  const rulesOf = (out: string): string[] => JSON.parse(out).map((f: { ruleId: string }) => f.ruleId).sort();
  assert.deepEqual(rulesOf(run(dir).stdout), ['suppression-added', 'test-skipped']);

  writeFileSync(join(dir, '.diffauditor.json'), '{"ignoreRules":["suppression-added"]}');
  assert.deepEqual(rulesOf(run(dir).stdout), ['test-skipped']);

  writeFileSync(join(dir, '.diffauditor.json'), '{"ignorePaths":["a.test.js"]}');
  assert.deepEqual(rulesOf(run(dir).stdout), ['suppression-added']);

  writeFileSync(join(dir, '.diffauditor.json'), '{"minSeverity":"high"}');
  assert.deepEqual(rulesOf(run(dir).stdout), ['test-skipped']);
});

test('CLI flags win over the file, and a bad file is a clear error', () => {
  const dir = repoWithSkips();
  writeFileSync(join(dir, '.diffauditor.json'), '{"minSeverity":"high"}');
  const out = run(dir, '--min-severity', 'low').stdout;
  assert.equal(JSON.parse(out).length, 2);

  writeFileSync(join(dir, '.diffauditor.json'), '{"ignoreRules":["no-such-rule"]}');
  const warned = run(dir);
  assert.match(warned.stderr, /"no-such-rule" in ignoreRules is not a rule id/);
  assert.equal(JSON.parse(warned.stdout).length, 2);

  writeFileSync(join(dir, '.diffauditor.json'), '{"oops":1}');
  const bad = run(dir);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option "oops"/);
});
