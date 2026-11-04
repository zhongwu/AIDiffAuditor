import type { FileDiff, Hunk } from './types';

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function unquote(p: string): string {
  const t = p.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Turns the `--- a/x` / `+++ b/x` side of a header into a path, or undefined for /dev/null. */
function pathFromSide(raw: string): string | undefined {
  const p = unquote(raw.split('\t')[0]);
  if (p === '/dev/null') {
    return undefined;
  }
  return p.replace(/^[ab]\//, '');
}

function pathFromGitHeader(line: string): string {
  const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
  return m ? m[2] : line.slice('diff --git '.length);
}

function applyHeaderLine(file: FileDiff, raw: string): void {
  if (raw.startsWith('new file mode')) {
    file.status = 'added';
  } else if (raw.startsWith('deleted file mode')) {
    file.status = 'deleted';
  } else if (raw.startsWith('rename from ')) {
    file.status = 'renamed';
    file.oldPath = unquote(raw.slice('rename from '.length));
  } else if (raw.startsWith('rename to ')) {
    file.path = unquote(raw.slice('rename to '.length));
  } else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
    file.binary = true;
  } else if (raw.startsWith('--- ')) {
    const p = pathFromSide(raw.slice(4));
    if (p) {
      file.oldPath = p;
    }
  } else if (raw.startsWith('+++ ')) {
    const p = pathFromSide(raw.slice(4));
    if (p) {
      file.path = p;
    }
  }
}

/**
 * Parses the output of `git diff` (unified format, a/ b/ prefixes) into files, hunks and
 * numbered lines. Only the parts the audit rules need are modelled.
 */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) {
      file = { path: pathFromGitHeader(raw), status: 'modified', binary: false, hunks: [] };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) {
      continue;
    }

    const m = HUNK_RE.exec(raw);
    if (m) {
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }

    if (!hunk) {
      applyHeaderLine(file, raw);
      continue;
    }

    // Inside a hunk the first character is always the line marker, so content such as
    // "-- comment" (shown as "--- comment") is never confused with a file header.
    if (raw.startsWith('+')) {
      hunk.lines.push({ type: 'add', text: raw.slice(1), newLine: newNo, anchorLine: newNo });
      newNo++;
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ type: 'del', text: raw.slice(1), oldLine: oldNo, anchorLine: Math.max(1, newNo) });
      oldNo++;
    } else if (raw.startsWith(' ')) {
      hunk.lines.push({ type: 'ctx', text: raw.slice(1), oldLine: oldNo, newLine: newNo, anchorLine: newNo });
      oldNo++;
      newNo++;
    }
    // "\ No newline at end of file" and blank separators are ignored.
  }
  return files;
}
