// Measures rule noise on real code: audits the diff of every commit in the given repos (read-only).
// Usage: node scripts/audit-history.js <repo> [<repo>...] [--max N]
// Human commits are mostly legitimate, so every finding printed is either a true shortcut or a
// false alarm; read them and decide. Output is a rule-by-rule summary, then the findings.
const { execFileSync } = require('node:child_process');
const { auditDiff } = require('../out/src/core/audit');

const args = process.argv.slice(2);
const maxIdx = args.indexOf('--max');
const max = maxIdx >= 0 ? Number(args.splice(maxIdx, 2)[1]) : 500;
const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const byRule = {};
const rows = [];
let commits = 0;
for (const repo of args) {
  let shas;
  try {
    shas = git(repo, 'rev-list', '--no-merges', `--max-count=${max}`, 'HEAD').split('\n').filter(Boolean);
  } catch {
    console.error(`skip ${repo}: not a git repository or no commits`);
    continue;
  }
  for (const sha of shas) {
    commits++;
    const diff = git(repo, 'show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--unified=0', sha);
    for (const f of auditDiff(diff)) {
      byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
      rows.push({ repo: repo.split(/[\\/]/).pop(), sha: sha.slice(0, 7), ...f });
    }
  }
}
console.log(`Audited ${commits} commits, ${rows.length} findings.\n`);
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), rule);
console.log('');
for (const r of rows) {
  console.log(`[${r.severity}] ${r.ruleId}  ${r.repo}@${r.sha}  ${r.file}:${r.line}\n      ${r.snippet ?? r.message}`);
}
