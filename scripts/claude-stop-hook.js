// Claude Code "Stop" hook: audit the working tree and send findings back to Claude (exit code 2).
// Only reports findings added since the session started when a baseline exists (see claude-session-start-hook.js).
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

let input = {};
try {
  input = JSON.parse(require('node:fs').readFileSync(0, 'utf8') || '{}');
} catch {
  // No JSON on stdin; carry on.
}
// Stop after one round so a finding Claude decides to justify cannot loop forever.
if (input.stop_hook_active) {
  process.exit(0);
}

const cli = join(__dirname, '..', 'out', 'src', 'cli.js');
const cwd = input.cwd || process.cwd();
const run = (...args) => spawnSync(process.execPath, [cli, '--fail-on', 'high', ...args], { cwd, encoding: 'utf8' });
let r = run('--baseline');
if (r.status === 2 && /No baseline/.test(r.stderr)) {
  r = run(); // No baseline saved: audit everything.
}
if (r.status === 1) {
  process.stderr.write(`${r.stdout}\nFix these, or explain to the user why each one is justified, before finishing.\n`);
  process.exit(2);
}
process.exit(0);
