import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditDiff } from '../src/core/audit';
import { collectDiff } from '../src/git';

function sh(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
}

function scratch(init = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'diffaudit-'));
  if (init) {
    sh(dir, 'init', '-q');
  }
  return dir;
}

const TEST_FILE = "describe('a', () => {\n  it('works', () => {\n    expect(1).toBe(1);\n  });\n});\n";

test('outside a git repository the error is readable', async () => {
  const dir = scratch(false);
  try {
    await assert.rejects(collectDiff({ cwd: dir }), /not a git repository/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repository without commits can still be audited', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'a.test.js'), TEST_FILE.replace("it('works'", "it.skip('works'"));
    const { diff } = await collectDiff({ cwd: dir });
    assert.ok(auditDiff(diff).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no changes means no findings', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'a.test.js'), TEST_FILE);
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'init');
    const { diff } = await collectDiff({ cwd: dir });
    assert.deepEqual(auditDiff(diff), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracked edits, untracked files and subfolders are all audited', async () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.test.js'), TEST_FILE);
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'a.test.js'), TEST_FILE.replace("it('works'", "it.skip('works'"));
    writeFileSync(join(dir, 'sub', 'b.test.js'), TEST_FILE.replace("it('works'", "xit('works'"));
    // Run from the subfolder: paths must still be relative to the repository root.
    const { root, diff } = await collectDiff({ cwd: join(dir, 'sub') });
    const files = auditDiff(diff).map((f) => f.file);
    assert.ok(files.includes('a.test.js'));
    assert.ok(files.includes('sub/b.test.js'));
    assert.ok(root.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('binary files and an unknown base ref do not crash', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'img.png'), Buffer.from([0, 1, 2, 0, 255, 0, 3]));
    const { diff } = await collectDiff({ cwd: dir });
    assert.deepEqual(auditDiff(diff), []);
    await assert.rejects(collectDiff({ cwd: dir, baseRef: 'no-such-ref' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- comparing against a branch ----------------------------------------------

function branchedRepo(): string {
  const dir = scratch();
  writeFileSync(join(dir, 'README.md'), '# x\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'init');
  sh(dir, 'branch', '-M', 'main');
  sh(dir, 'checkout', '-q', '-b', 'feature');
  // main moves on after the branch point: a teammate adds a test file.
  sh(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'team.test.js'), TEST_FILE);
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'teammate adds a test');
  sh(dir, 'checkout', '-q', 'feature');
  return dir;
}

test('comparing against a branch ignores what that branch gained after you branched off', async () => {
  const dir = branchedRepo();
  writeFileSync(join(dir, 'mine.js'), 'export const a = 1;\n');
  const { diff } = await collectDiff({ cwd: dir, baseRef: 'main' });
  assert.deepEqual(auditDiff(diff).map((f) => `${f.ruleId} ${f.file}`), [], 'the teammate test file must not look deleted');
  assert.match(diff, /mine\.js/);
  assert.doesNotMatch(diff, /team\.test\.js/);
  rmSync(dir, { recursive: true, force: true });
});

test('comparing against a branch still finds shortcuts made on this branch', async () => {
  const dir = branchedRepo();
  writeFileSync(join(dir, 'mine.test.js'), "it.skip('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n");
  const { diff } = await collectDiff({ cwd: dir, baseRef: 'main' });
  assert.deepEqual(auditDiff(diff).map((f) => f.ruleId), ['test-skipped']);
  rmSync(dir, { recursive: true, force: true });
});

test('an unknown ref gives a clear error', async () => {
  const dir = branchedRepo();
  await assert.rejects(collectDiff({ cwd: dir, baseRef: 'no-such-branch' }), /Unknown ref "no-such-branch"/);
  rmSync(dir, { recursive: true, force: true });
});

test('a commit that is an ancestor still works as a base', async () => {
  const dir = branchedRepo();
  writeFileSync(join(dir, 'mine.js'), 'export const a = 1;\n');
  const { diff } = await collectDiff({ cwd: dir, baseRef: 'HEAD' });
  assert.match(diff, /mine\.js/);
  rmSync(dir, { recursive: true, force: true });
});
