import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDiff } from '../src/core/diffParser';
import { added, deleted, mod, renamed } from './helpers';

test('numbers added and deleted lines', () => {
  const [file] = parseDiff(mod('src/a.ts', [' ctx', '-old', '+new1', '+new2'], '10,2 +10,3'));
  assert.equal(file.path, 'src/a.ts');
  assert.equal(file.status, 'modified');
  const lines = file.hunks[0].lines;
  assert.deepEqual(lines.map((l) => l.type), ['ctx', 'del', 'add', 'add']);
  assert.equal(lines[1].oldLine, 11);
  assert.equal(lines[1].anchorLine, 11);
  assert.equal(lines[2].newLine, 11);
  assert.equal(lines[3].newLine, 12);
});

test('recognises added, deleted and renamed files', () => {
  const diff = [added('a.ts', ['x']), deleted('b.ts', ['y']), renamed('c.ts', 'd.ts')].join('\n');
  assert.deepEqual(
    parseDiff(diff).map((f) => [f.path, f.status]),
    [
      ['a.ts', 'added'],
      ['b.ts', 'deleted'],
      ['d.ts', 'renamed'],
    ],
  );
});

test('does not mistake hunk content that looks like a file header', () => {
  const [file] = parseDiff(mod('q.sql', ['--- a comment', '+++ b comment']));
  assert.equal(file.path, 'q.sql');
  assert.deepEqual(file.hunks[0].lines.map((l) => l.type), ['del', 'add']);
});

test('flags binary files and keeps paths with spaces', () => {
  const diff = [
    'diff --git a/my dir/pic.png b/my dir/pic.png',
    'index 1111111..2222222 100644',
    'Binary files a/my dir/pic.png and b/my dir/pic.png differ',
    '',
  ].join('\n');
  const [file] = parseDiff(diff);
  assert.equal(file.path, 'my dir/pic.png');
  assert.equal(file.binary, true);
});

test('returns nothing for empty input', () => {
  assert.deepEqual(parseDiff(''), []);
});
