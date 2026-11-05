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
