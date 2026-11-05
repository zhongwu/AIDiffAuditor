import { pathMatcher } from './config';
import { parseDiff } from './diffParser';
import { isIgnoredPath } from './patterns';
import { RULES } from './rules';
import { SEVERITY_RANK } from './types';
import type { AuditOptions, DiffLine, FileDiff, Finding } from './types';

/** Lines shorter than this (braces, `return;`) are too common to count as "the same line moved". */
const MIN_MOVED_LENGTH = 8;

/**
 * Cancels out lines that were removed in one place and added in another place in the same diff,
 * so moving or splitting a file is not reported as removing its tests, and a moved suppression
 * is not reported as a new one. Matching lines become context lines.
 */
function cancelMovedLines(files: FileDiff[]): void {
  const removed = new Map<string, DiffLine[]>();
  const added = new Map<string, DiffLine[]>();
  const owner = new Map<DiffLine, FileDiff>();
  for (const file of files) {
    if (file.binary || isIgnoredPath(file.path)) {
      continue;
    }
    for (const line of file.hunks.flatMap((h) => h.lines)) {
      const text = line.text.trim();
      if (text.length < MIN_MOVED_LENGTH || line.type === 'ctx') {
        continue;
      }
      const bucket = line.type === 'del' ? removed : added;
      bucket.set(text, [...(bucket.get(text) ?? []), line]);
      owner.set(line, file);
    }
  }
  for (const [text, gone] of removed) {
    const fresh = added.get(text);
    if (!fresh) {
      continue;
    }
    const n = Math.min(gone.length, fresh.length);
    for (const line of [...gone.slice(0, n), ...fresh.slice(0, n)]) {
      line.type = 'ctx';
    }
    for (const line of gone.slice(0, n)) {
      const file = owner.get(line);
      if (file) {
        file.movedAway = (file.movedAway ?? 0) + 1;
      }
    }
  }
}

/**
 * Runs every rule over a unified diff and returns findings ranked most severe first,
 * then by file and line.
 */
export function auditDiff(diffText: string, options: AuditOptions = {}): Finding[] {
  const ignore = new Set(options.ignoreRules ?? []);
  const minRank = SEVERITY_RANK[options.minSeverity ?? 'low'];
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const isIgnored = pathMatcher(options.ignorePaths);
  // Leave ignored files out before moved lines are matched, so they cannot cancel anything either.
  const files = parseDiff(diffText).filter((f) => !isIgnored(f.path));
  cancelMovedLines(files);
  for (const file of files) {
    if (file.binary || isIgnoredPath(file.path)) {
      continue;
    }
    for (const rule of RULES) {
      if (ignore.has(rule.id)) {
        continue;
      }
      for (const f of rule.run(file)) {
        const key = `${f.ruleId}|${f.file}|${f.line}|${f.message}`;
        if (SEVERITY_RANK[f.severity] >= minRank && !seen.has(key)) {
          seen.add(key);
          findings.push(f);
        }
      }
    }
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}
