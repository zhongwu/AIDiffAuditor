import { RULES } from './rules';
import { SEVERITY_RANK } from './types';
import type { Severity } from './types';

/** Name of the committed team config file, at the repository root. */
export const CONFIG_FILE = '.diffauditor.json';

/** Team defaults shared by the extension and the CLI. */
export interface TeamConfig {
  /** Rule ids to switch off. */
  ignoreRules?: string[];
  /** Drop findings below this severity. */
  minSeverity?: Severity;
  /** Files to leave out of the audit, as gitignore-style globs relative to the repository root. */
  ignorePaths?: string[];
  /** Ref to compare the working tree against, such as origin/main. */
  baseRef?: string;
}

const KEYS = ['ignoreRules', 'minSeverity', 'ignorePaths', 'baseRef'] as const;

function stringList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
    throw new Error(`${CONFIG_FILE}: "${key}" must be a list of non-empty strings.`);
  }
  return value as string[];
}

/** Reads and checks a config file. Throws an Error that says what is wrong and where. */
export function parseConfig(text: string): TeamConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${CONFIG_FILE} must contain a JSON object.`);
  }
  const obj = data as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => k !== '$schema' && !(KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new Error(`${CONFIG_FILE}: unknown option ${unknown.map((k) => `"${k}"`).join(', ')}. Allowed: ${KEYS.join(', ')}.`);
  }

  const config: TeamConfig = {};
  if (obj.ignoreRules !== undefined) {
    config.ignoreRules = stringList(obj.ignoreRules, 'ignoreRules');
  }
  if (obj.ignorePaths !== undefined) {
    config.ignorePaths = stringList(obj.ignorePaths, 'ignorePaths');
  }
  if (obj.minSeverity !== undefined) {
    if (typeof obj.minSeverity !== 'string' || !(obj.minSeverity in SEVERITY_RANK)) {
      throw new Error(`${CONFIG_FILE}: "minSeverity" must be "high", "medium" or "low".`);
    }
    config.minSeverity = obj.minSeverity as Severity;
  }
  if (obj.baseRef !== undefined) {
    if (typeof obj.baseRef !== 'string' || obj.baseRef.trim() === '') {
      throw new Error(`${CONFIG_FILE}: "baseRef" must be a non-empty string.`);
    }
    config.baseRef = obj.baseRef.trim();
  }
  return config;
}

/** Rule ids in a list that do not exist, so a typo does not silently leave a rule switched on. */
export function unknownRuleIds(ids: string[] | undefined): string[] {
  const known = new Set(RULES.map((r) => r.id));
  return (ids ?? []).filter((id) => !known.has(id));
}

/**
 * Turns a gitignore-style glob into a regular expression over repo-relative paths with `/`.
 * `*` stays inside one folder, `**` crosses folders, a pattern with no `/` matches at any depth,
 * and a trailing `/` means everything under that folder.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, '');
  if (g.endsWith('/')) {
    g += '**';
  }
  if (!g.includes('/')) {
    g = `**/${g}`;
  }
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Compiles a list of globs once; the returned function says whether a path is ignored. */
export function pathMatcher(globs: string[] | undefined): (path: string) => boolean {
  const regexes = (globs ?? []).map(globToRegExp);
  return (path) => regexes.some((re) => re.test(path));
}
