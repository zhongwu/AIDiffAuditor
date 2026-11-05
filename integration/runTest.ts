import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
}

/** A repo where an "agent" skipped a test, added a suppression and created a new test file. */
function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diffaudit-ui-'));
  git(dir, 'init', '-q');
  const test = "describe('a', () => {\n  it('works', () => {\n    expect(1).toBe(1);\n  });\n});\n";
  writeFileSync(join(dir, 'a.test.js'), test);
  writeFileSync(join(dir, 'app.ts'), 'export const x: number = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  writeFileSync(join(dir, 'a.test.js'), test.replace("it('works'", "it.skip('works'"));
  writeFileSync(join(dir, 'app.ts'), '// @ts-ignore\nexport const x: number = "1";\n');
  writeFileSync(join(dir, 'new.test.js'), test.replace("it('works'", "xit('works'"));
  return dir;
}

async function main(): Promise<void> {
  const root = resolve(__dirname, '..', '..');
  const repo = makeScratchRepo();
  await runTests({
    // Use the installed VS Code when given, otherwise download a stable build.
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'out', 'integration', 'suite.js'),
    launchArgs: [repo, '--disable-extensions', '--user-data-dir', mkdtempSync(join(tmpdir(), 'diffaudit-ud-'))],
    extensionTestsEnv: { DIFFAUDIT_REPO: repo },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
