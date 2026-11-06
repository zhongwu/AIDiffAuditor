#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditDiff } from './core/audit';
import { createBaseline, newSinceBaseline, parseBaseline } from './core/baseline';
import { formatFindings } from './core/format';
import { toSarif } from './core/sarif';
import { SEVERITY_RANK } from './core/types';
import type { Severity } from './core/types';
import { loadConfig } from './config';
import { baselinePath, collectDiff, repoRoot } from './git';

const USAGE = `diffaudit - scan a git diff for shortcuts AI agents take to look done

Usage: diffaudit [options]

  --base <ref>        Compare against <ref> (default: HEAD). For a branch, uses the point you branched off
  --stdin             Read a unified diff from stdin instead of running git
  --no-untracked      Ignore files git does not track yet
  --ignore <rule-id>  Turn a rule off (repeatable)
  --min-severity <l>  Hide findings below high|medium|low
  --fail-on <level>   Exit with code 1 at or above high|medium|low, or "never" (default: high)
  --save-baseline     Record the current findings as the baseline (stored inside .git) and exit
  --baseline          Report only findings that are not in the saved baseline
  --json              Print findings as JSON
  --sarif             Print findings as SARIF 2.1.0 (GitHub code scanning and other CI viewers)
  --output <file>     Write the report to <file> instead of printing it
  -h, --help          Show this help

Team defaults (ignoreRules, minSeverity, ignorePaths, baseRef) are read from .diffauditor.json
at the repository root; flags override them.

Exit codes: 0 = ok, 1 = findings at or above --fail-on, 2 = could not run.`;

const REPO_URL = 'https://github.com/zhongwu/AIDiffAuditor';

function toolVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let base: string | undefined;
  let stdin = false;
  let json = false;
  let sarif = false;
  let output: string | undefined;
  let untracked = true;
  let saveBaseline = false;
  let useBaseline = false;
  let failOn: Severity | 'never' = 'high';
  let minSeverity: Severity | undefined;
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
      case '--sarif': sarif = true; break;
      case '--output': output = value(); break;
      case '--save-baseline': saveBaseline = true; break;
      case '--baseline': useBaseline = true; break;
      case '--no-untracked': untracked = false; break;
      case '--ignore': ignoreRules.push(value()); break;
      case '--min-severity': {
        const v = value();
        if (!(v in SEVERITY_RANK)) {
          throw new Error(`--min-severity must be high, medium or low (got "${v}")`);
        }
        minSeverity = v as Severity;
        break;
      }
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

  if (json && sarif) {
    throw new Error('--json and --sarif cannot be used together');
  }
  if (stdin && (saveBaseline || useBaseline)) {
    throw new Error('--save-baseline and --baseline need a git repository, so they cannot be used with --stdin');
  }
  const { config, warnings } = await loadConfig(stdin ? process.cwd() : await repoRoot(process.cwd()));
  for (const w of warnings) {
    console.error(`warning: ${w}`);
  }
  const diff = stdin
    ? readFileSync(0, 'utf8')
    : (await collectDiff({ cwd: process.cwd(), baseRef: base ?? config.baseRef, includeUntracked: untracked })).diff;
  let findings = auditDiff(diff, {
    ignoreRules: [...(config.ignoreRules ?? []), ...ignoreRules],
    minSeverity: minSeverity ?? config.minSeverity,
    ignorePaths: config.ignorePaths,
  });
  let hidden = 0;

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
    const total = findings.length;
    findings = newSinceBaseline(findings, parseBaseline(readFileSync(file, 'utf8')));
    hidden = total - findings.length;
  }

  const report = sarif
    ? JSON.stringify(toSarif(findings, { version: toolVersion(), informationUri: REPO_URL }), null, 2)
    : json
      ? JSON.stringify(findings, null, 2)
      : formatFindings(findings, Infinity, hidden);
  if (output) {
    writeFileSync(output, `${report}\n`);
    console.error(`Diff Auditor: ${findings.length} finding(s) written to ${output}`);
  } else {
    console.log(report);
  }
  if (failOn !== 'never' && findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn])) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
