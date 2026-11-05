// Creates .sandbox/: a throwaway git repo with typical "agent shortcut" edits, for manual F5 testing.
const { execFileSync } = require('node:child_process');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const dir = resolve(__dirname, '..', '.sandbox');
rmSync(dir, { recursive: true, force: true });
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
const hook = 'node "' + join(__dirname, 'claude-stop-hook.js').split('\\').join('/') + '"';
writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: hook }] }] } }, null, 2));
console.log('Sandbox ready:', dir);
