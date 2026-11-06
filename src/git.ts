import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
    return true;
  } catch {
    return false;
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

/**
 * Turns the ref the user asked for into the commit to diff against. Comparing against a branch
 * means "what did I change since I branched off", so we use the merge base: diffing against the
 * branch tip would show everything the branch gained since then as if I had deleted it.
 */
async function resolveBase(root: string, ref: string): Promise<string> {
  try {
    await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root);
  } catch {
    throw new Error(`Unknown ref "${ref}". Use a branch, tag or commit that exists (see "git branch -a").`);
  }
  if (ref === 'HEAD') {
    return ref;
  }
  try {
    return (await git(['merge-base', ref, 'HEAD'], root)).trim() || ref;
  } catch {
    return ref; // unrelated histories: fall back to a plain comparison with the ref
  }
}

export async function collectDiff(req: DiffRequest): Promise<CollectedDiff> {
  const root = (await git(['rev-parse', '--show-toplevel'], req.cwd)).trim();
  let base = req.baseRef?.trim() || 'HEAD';
  if (base === 'HEAD' && !(await hasCommits(root))) {
    // A fresh repository has no HEAD yet; compare against the empty tree so staged files still show up.
    base = EMPTY_TREE;
  }

  if (base !== EMPTY_TREE) {
    base = await resolveBase(root, base);
  }

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

/**
 * Where the session baseline lives: inside the git directory, so it is never committed and
 * each worktree gets its own.
 */
export async function baselinePath(cwd: string): Promise<string> {
  const root = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
  const p = (await git(['rev-parse', '--git-path', 'diffaudit-baseline.json'], root)).trim();
  return isAbsolute(p) ? p : join(root, p);
}

/** Absolute path of the repository that contains `cwd`. */
export async function repoRoot(cwd: string): Promise<string> {
  return (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
}

/** Branches, remote branches and tags to offer in a picker, most recently updated first. */
export async function listRefs(cwd: string): Promise<string[]> {
  const out = await git(
    ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'],
    cwd,
  );
  return out
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r && !r.endsWith('/HEAD'))
    .map((r) => r.replace(/^refs\/(?:heads|remotes|tags)\//, ''))
    .slice(0, 100);
}
