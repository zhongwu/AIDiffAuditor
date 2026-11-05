import type { Finding } from './types';

/**
 * A baseline records the findings that already existed when a session started, so later audits
 * can report only what the agent added. Findings are matched by rule, file and content rather
 * than line number, because adding code above a finding moves it. Counts are kept so a second
 * copy of the same shortcut still counts as new.
 */
export interface Baseline {
  version: 1;
  createdAt: string;
  counts: Record<string, number>;
}

export function findingKey(f: Finding): string {
  return [f.ruleId, f.file, (f.snippet ?? f.message).trim()].join('\u0000');
}

export function createBaseline(findings: Finding[], now: Date = new Date()): Baseline {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const key = findingKey(f);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { version: 1, createdAt: now.toISOString(), counts };
}

export function parseBaseline(text: string): Baseline {
  const data = JSON.parse(text) as Partial<Baseline>;
  if (data.version !== 1 || typeof data.counts !== 'object' || data.counts === null) {
    throw new Error('Not a Diff Auditor baseline file.');
  }
  return data as Baseline;
}

/** Findings that are not covered by the baseline. */
export function newSinceBaseline(findings: Finding[], baseline: Baseline): Finding[] {
  const remaining = new Map(Object.entries(baseline.counts));
  return findings.filter((f) => {
    const key = findingKey(f);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      return false;
    }
    return true;
  });
}
