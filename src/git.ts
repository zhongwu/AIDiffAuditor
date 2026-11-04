import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_UNTRACKED_FILES = 200;
const MAX_UNTRACKED_BYTES = 1_000_000;

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '-M', '--unified=0', '--src-prefix=a/', '--dst-prefix=b/'];

async function git(args: string[], cwd: string, okExitCodes: number[] = [0]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    if (typeof e.code === 'number' && okExitCodes.includes(e.code)) {
      return e.stdout ?? '';
    }
    throw new Error((e.stderr || e.message || String(err)).trim());
  }
}

export interface DiffRequest {
  /** Any directory inside the repository. */
  cwd: string;
  /** Ref to compare the working tree against. Defaults to HEAD. */
  baseRef?: string;
  /** Also include files git does not track yet. Defaults to true. */
  includeUntracked?: boolean;
}

export interface CollectedDiff {
  /** Absolute path of the repository root; diff paths are relative to it. */
  root: string;
  diff: string;
}

export async function collectDiff(req: DiffRequest): Promise<CollectedDiff> {
  const root = (await git(['rev-parse', '--show-toplevel'], req.cwd)).trim();
  const base = req.baseRef?.trim() || 'HEAD';

  let diff = await git(['diff', ...DIFF_FLAGS, base, '--'], root);

  if (req.includeUntracked !== false) {
    const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'], root))
      .split('\0')
      .filter(Boolean)
      .slice(0, MAX_UNTRACKED_FILES);
    for (const file of untracked) {
      try {
        if ((await stat(join(root, file))).size > MAX_UNTRACKED_BYTES) {
          continue;
        }
        // `git diff --no-index` exits with 1 when the files differ, which is what we want here.
        diff += await git(['diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null', file], root, [1]);
      } catch {
        // A file that vanished or cannot be read is not worth failing the whole audit for.
      }
    }
  }

  return { root, diff };
}
