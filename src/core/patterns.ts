const TEST_PATH_PATTERNS: RegExp[] = [
  /(?:^|\/)(?:__tests__|__test__|tests?|specs?|e2e|cypress)\//i,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
  /(?:^|\/)test_[^/]+\.py$/,
  /_test\.(?:py|go|rs|rb|exs?|dart)$/,
  /_spec\.rb$/,
  /(?:Test|Tests|IT|Spec)\.(?:java|kt|scala|cs|swift|php)$/,
];

const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|py|go|rs|java|kt|kts|scala|cs|rb|php|swift|c|cc|cpp|h|hpp|m|mm|dart|ex|exs)$/i;

/** Paths the audit never looks at: dependencies, build output, lockfiles, snapshots. */
const IGNORED_PATH = /(?:^|\/)(?:node_modules|dist|build|out|vendor|\.git)\/|\.(?:lock|snap|min\.js|map)$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml)$/;

export function isTestFile(path: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(path));
}

export function isCodeFile(path: string): boolean {
  return CODE_EXT.test(path);
}

export function isIgnoredPath(path: string): boolean {
  return IGNORED_PATH.test(path);
}

/** True for lines that are only a comment. `#[attr]` (Rust) is deliberately not a comment. */
export function isCommentLine(text: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*|#(?!\[)|--|<!--)/.test(text);
}
