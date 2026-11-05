// Creates .sandbox/: a throwaway git repo with typical "agent shortcut" edits, for manual F5 testing.
const { execFileSync } = require('node:child_process');
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const dir = resolve(__dirname, '..', '.sandbox');
// Empty the folder rather than deleting it: Windows refuses to remove a folder that a VS Code window has open.
mkdirSync(dir, { recursive: true });
for (const name of readdirSync(dir)) {
  rmSync(join(dir, name), { recursive: true, force: true, maxRetries: 3 });
}
mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });

const test = "describe('math', () => {\n  it('adds', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n";
const ci = 'steps:\n  - run: npm ci\n  - run: npm test\n';
const app = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';

git('init', '-q');
writeFileSync(join(dir, 'math.test.js'), test);
writeFileSync(join(dir, 'app.ts'), app);
writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), ci);
git('add', '-A');
git('commit', '-q', '-m', 'baseline');

// The "agent" edits:
writeFileSync(join(dir, 'math.test.js'), test.replace("it('adds'", "it.skip('adds'"));
writeFileSync(join(dir, 'app.ts'), '// @ts-ignore\n' + app.replace('a + b', '(a as any) + b') + 'try { add(1, 2); } catch (e) {}\n');
writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'steps:\n  - run: npm ci\n');
writeFileSync(join(dir, 'new.test.js'), test.replace("it('adds'", "xit('adds'"));
// Claude Code hook: audit when Claude tries to finish.
mkdirSync(join(dir, '.claude'), { recursive: true });
const hookCmd = (name) => 'node "' + join(__dirname, name).split('\\').join('/') + '"';
const settings = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCmd('claude-session-start-hook.js') }] }],
    Stop: [{ hooks: [{ type: 'command', command: hookCmd('claude-stop-hook.js') }] }],
  },
};
writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
console.log('Sandbox ready:', dir);
