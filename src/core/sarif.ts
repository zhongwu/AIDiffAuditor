import { createHash } from 'node:crypto';
import { findingKey } from './baseline';
import { RULES } from './rules';
import type { Finding, Severity } from './types';

/**
 * SARIF 2.1.0 is the format GitHub code scanning and most CI dashboards read. This builds the
 * smallest document they accept: one run, every rule described, one result per finding.
 */

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  high: 'error',
  medium: 'warning',
  low: 'note',
};

export interface SarifOptions {
  /** Version of this tool, shown by the viewer. */
  version?: string;
  /** Where the project lives, shown as the tool's home page. */
  informationUri?: string;
}

/** `src/My File.ts` -> `src/My%20File.ts`: SARIF locations are URIs, not file names. */
function toUri(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function toSarif(findings: Finding[], options: SarifOptions = {}): object {
  const rules = RULES.map((r) => ({
    id: r.id,
    name: r.id,
    shortDescription: { text: r.description },
    defaultConfiguration: { level: 'warning' },
  }));
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  // A fingerprint lets the viewer recognise the same finding after its line number moves. Two
  // identical findings in one file still need different fingerprints, so count occurrences.
  const seen = new Map<string, number>();
  const results = findings.map((f) => {
    const hash = createHash('sha256').update(findingKey(f)).digest('hex').slice(0, 32);
    const n = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, n);
    return {
      ruleId: f.ruleId,
      ruleIndex: ruleIndex.get(f.ruleId) ?? -1,
      level: LEVEL[f.severity],
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: toUri(f.file), uriBaseId: '%SRCROOT%' },
            region: {
              startLine: Math.max(1, f.line),
              ...(f.snippet ? { snippet: { text: f.snippet } } : {}),
            },
          },
        },
      ],
      partialFingerprints: { 'diffAuditFinding/v1': `${hash}:${n}` },
    };
  });

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Agent Diff Auditor',
            ...(options.version ? { version: options.version } : {}),
            ...(options.informationUri ? { informationUri: options.informationUri } : {}),
            rules,
          },
        },
        originalUriBaseIds: { '%SRCROOT%': { description: { text: 'The repository root.' } } },
        results,
      },
    ],
  };
}
