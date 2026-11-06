import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditDiff } from '../src/core/audit';
import { RULES } from '../src/core/rules';
import { toSarif } from '../src/core/sarif';
import type { Finding } from '../src/core/types';
import { added, mod } from './helpers';

interface Sarif {
  version: string;
  runs: {
    tool: { driver: { name: string; version?: string; rules: { id: string }[] } };
    results: {
      ruleId: string;
      ruleIndex: number;
      level: string;
      message: { text: string };
      locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; snippet?: { text: string } } } }[];
      partialFingerprints: Record<string, string>;
    }[];
  }[];
}

const build = (findings: Finding[], version?: string): Sarif => toSarif(findings, { version }) as Sarif;

test('a SARIF document has the required shape', () => {
  const findings = auditDiff(mod('a.test.js', ['-x', '+it.skip("a", () => {});']));
  const doc = build(findings, '1.2.3');
  assert.equal(doc.version, '2.1.0');
  assert.equal(doc.runs.length, 1);
  assert.equal(doc.runs[0].tool.driver.name, 'Agent Diff Auditor');
  assert.equal(doc.runs[0].tool.driver.version, '1.2.3');
  const [r] = doc.runs[0].results;
  assert.equal(r.ruleId, 'test-skipped');
  assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, 'a.test.js');
  assert.equal(r.locations[0].physicalLocation.region.startLine, findings[0].line);
  assert.ok(r.locations[0].physicalLocation.region.snippet?.text.includes('it.skip'));
});

test('every rule is described and each result points at its rule', () => {
  const diff =
    mod('a.test.js', ['-x', '+it.skip("a", () => {});']) + mod('b.ts', ['-x', '+// @ts-ignore']) + mod('c.ts', ['-x', '+try { f(); } catch (e) {}']);
  const doc = build(auditDiff(diff));
  const rules = doc.runs[0].tool.driver.rules;
  assert.deepEqual(rules.map((r) => r.id), RULES.map((r) => r.id));
  assert.ok(doc.runs[0].results.length >= 3);
  for (const r of doc.runs[0].results) {
    assert.equal(rules[r.ruleIndex].id, r.ruleId);
  }
});

test('severity maps to the SARIF level', () => {
  const diff = added('a.test.js', ['it.skip("a", () => {});']) + mod('b.ts', ['-x', '+// @ts-ignore']) + mod('c.py', ['-x', '+import os  # noqa: F401']);
  const levels = Object.fromEntries(build(auditDiff(diff)).runs[0].results.map((r) => [r.ruleId + ':' + r.locations[0].physicalLocation.artifactLocation.uri, r.level]));
  assert.equal(levels['test-skipped:a.test.js'], 'error');
  assert.equal(levels['suppression-added:b.ts'], 'warning');
  assert.equal(levels['suppression-added:c.py'], 'note');
});

test('file names are written as URIs', () => {
  const f: Finding = { ruleId: 'test-skipped', severity: 'high', file: 'src/My Tests/a #1.test.js', line: 3, message: 'm' };
  const uri = build([f]).runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
  assert.equal(uri, 'src/My%20Tests/a%20%231.test.js');
  assert.equal(decodeURIComponent(uri), f.file);
});

test('a finding keeps its fingerprint when its line moves, and duplicates stay distinct', () => {
  const at = (line: number): Finding => ({ ruleId: 'test-skipped', severity: 'high', file: 'a.test.js', line, message: 'm', snippet: 'it.skip("a")' });
  const fp = (f: Finding[]): string[] => build(f).runs[0].results.map((r) => r.partialFingerprints['diffAuditFinding/v1']);
  assert.deepEqual(fp([at(2)]), fp([at(40)]));
  const two = fp([at(2), at(9)]);
  assert.equal(new Set(two).size, 2);
  const other = fp([{ ...at(2), snippet: 'it.skip("b")' }]);
  assert.notEqual(other[0], fp([at(2)])[0]);
});

test('no findings is a valid document with an empty result list', () => {
  const doc = build([]);
  assert.deepEqual(doc.runs[0].results, []);
  assert.ok(doc.runs[0].tool.driver.rules.length > 0);
});

// --- the CLI --------------------------------------------------------------------

const CLI = join(__dirname, '..', '..', 'out', 'src', 'cli.js');

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diffaudit-sarif-'));
  const git = (...a: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  writeFileSync(join(dir, 'README.md'), '# x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(dir, 'a.test.js'), "it.skip('a', () => {});\n");
  return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });

test('diffaudit --sarif prints a SARIF document and still sets the exit code', () => {
  const r = run(repo(), '--sarif');
  assert.equal(r.status, 1, 'a high finding still fails the run');
  const doc = JSON.parse(r.stdout) as Sarif;
  assert.equal(doc.version, '2.1.0');
  assert.equal(doc.runs[0].results[0].ruleId, 'test-skipped');
  assert.match(doc.runs[0].tool.driver.version ?? '', /^\d+\.\d+\.\d+/);
});

test('--output writes the report to a file instead of printing it', () => {
  const dir = repo();
  const file = join(dir, 'out.sarif');
  const r = run(dir, '--sarif', '--output', file, '--fail-on', 'never');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(existsSync(file));
  assert.equal((JSON.parse(readFileSync(file, 'utf8')) as Sarif).runs[0].results.length, 1);
  assert.match(r.stderr, /1 finding\(s\) written to/);
});

test('--json and --sarif together are rejected', () => {
  const r = run(repo(), '--json', '--sarif');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot be used together/);
});
