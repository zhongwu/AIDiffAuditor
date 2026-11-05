// Claude Code "SessionStart" hook: remember what is already wrong, so the Stop hook only reports new problems.
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

let input = {};
try {
  input = JSON.parse(require('node:fs').readFileSync(0, 'utf8') || '{}');
} catch {
  // No JSON on stdin; carry on.
}

const cli = join(__dirname, '..', 'out', 'src', 'cli.js');
const cwd = input.cwd || process.cwd();
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

// On resume or compaction the session is already under way, so keep the existing baseline if there is one.
const continuing = input.source === 'resume' || input.source === 'compact';
if (!(continuing && run('--baseline', '--fail-on', 'never').status === 0)) {
  run('--save-baseline');
}
process.exit(0);
