import { parseDiff } from './diffParser';
import { isIgnoredPath } from './patterns';
import { RULES } from './rules';
import { SEVERITY_RANK } from './types';
import type { AuditOptions, Finding } from './types';

/**
 * Runs every rule over a unified diff and returns findings ranked most severe first,
 * then by file and line.
 */
export function auditDiff(diffText: string, options: AuditOptions = {}): Finding[] {
  const ignore = new Set(options.ignoreRules ?? []);
  const minRank = SEVERITY_RANK[options.minSeverity ?? 'low'];
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const file of parseDiff(diffText)) {
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
