#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { auditDiff } from './core/audit';
import { createBaseline, newSinceBaseline, parseBaseline } from './core/baseline';
import { formatFindings } from './core/format';
import { SEVERITY_RANK } from './core/types';
import type { Severity } from './core/types';
import { baselinePath, collectDiff } from './git';

const USAGE = `diffaudit - scan a git diff for shortcuts AI agents take to look done

Usage: diffaudit [options]

  --base <ref>        Compare the working tree against <ref> (default: HEAD)
  --stdin             Read a unified diff from stdin instead of running git
  --no-untracked      Ignore files git does not track yet
  --ignore <rule-id>  Turn a rule off (repeatable)
  --fail-on <level>   Exit with code 1 at or above high|medium|low, or "never" (default: high)
  --save-baseline     Record the current findings as the baseline (stored inside .git) and exit
  --baseline          Report only findings that are not in the saved baseline
  --json              Print findings as JSON
  -h, --help          Show this help

Exit codes: 0 = ok, 1 = findings at or above --fail-on, 2 = could not run.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let base: string | undefined;
  let stdin = false;
  let json = false;
  let untracked = true;
  let saveBaseline = false;
  let useBaseline = false;
  let failOn: Severity | 'never' = 'high';
  const ignoreRules: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return v;
    };
    switch (arg) {
      case '--base': base = value(); break;
      case '--stdin': stdin = true; break;
      case '--json': json = true; break;
      case '--save-baseline': saveBaseline = true; break;
      case '--baseline': useBaseline = true; break;
      case '--no-untracked': untracked = false; break;
      case '--ignore': ignoreRules.push(value()); break;
      case '--fail-on': {
        const v = value();
        if (v !== 'never' && !(v in SEVERITY_RANK)) {
          throw new Error(`--fail-on must be high, medium, low or never (got "${v}")`);
        }
        failOn = v as Severity | 'never';
        break;
      }
      case '-h':
      case '--help':
        console.log(USAGE);
        return;
      default:
        throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  if (stdin && (saveBaseline || useBaseline)) {
    throw new Error('--save-baseline and --baseline need a git repository, so they cannot be used with --stdin');
  }
  const diff = stdin
    ? readFileSync(0, 'utf8')
    : (await collectDiff({ cwd: process.cwd(), baseRef: base, includeUntracked: untracked })).diff;
  let findings = auditDiff(diff, { ignoreRules });

  if (saveBaseline) {
    const file = await baselinePath(process.cwd());
    writeFileSync(file, JSON.stringify(createBaseline(findings), null, 2));
    console.log(`Baseline saved: ${findings.length} existing finding(s) will be ignored. (${file})`);
    return;
  }
  if (useBaseline) {
    const file = await baselinePath(process.cwd());
    if (!existsSync(file)) {
      throw new Error('No baseline saved yet. Run "diffaudit --save-baseline" first.');
    }
    findings = newSinceBaseline(findings, parseBaseline(readFileSync(file, 'utf8')));
  }

  console.log(json ? JSON.stringify(findings, null, 2) : formatFindings(findings, Infinity));
  if (failOn !== 'never' && findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn])) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
