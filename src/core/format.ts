import type { Finding, Severity } from './types';

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

/** Plain-text report used by the CLI and by the language-model tool. */
export function formatFindings(findings: Finding[], limit = 50, hidden = 0): string {
  const note = hidden > 0 ? `\n(${hidden} existing finding(s) hidden by the saved baseline.)` : '';
  if (findings.length === 0) {
    return `Diff Auditor: no suspicious changes found.${note}`;
  }
  const c = countBySeverity(findings);
  const lines = [
    `Diff Auditor found ${findings.length} suspicious change(s): ${c.high} high, ${c.medium} medium, ${c.low} low.`,
  ];
  for (const f of findings.slice(0, limit)) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.file}:${f.line} - ${f.message} (${f.ruleId})`);
  }
  if (findings.length > limit) {
    lines.push(`...and ${findings.length - limit} more.`);
  }
  return lines.join('\n') + note;
}
