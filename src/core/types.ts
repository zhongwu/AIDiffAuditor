export type Severity = 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  /** Line content without the leading +/-/space marker. */
  text: string;
  /** Line number in the new file (add and ctx lines). */
  newLine?: number;
  /** Line number in the old file (del and ctx lines). */
  oldLine?: number;
  /**
   * Best line in the new file to point at: the line itself for additions, and the
   * position where the deletion happened for removals.
   */
  anchorLine: number;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileDiff {
  /** Repo-relative path in the new tree (or the old tree for deleted files). */
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  /**
   * How many removed lines were found again somewhere else in the same diff (a move or split).
   * Those lines are turned into context lines before the rules run.
   */
  movedAway?: number;
  hunks: Hunk[];
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  file: string;
  /** 1-based line in the new file; 1 when the finding is about the whole file. */
  line: number;
  message: string;
  snippet?: string;
}

export interface Rule {
  id: string;
  description: string;
  run(file: FileDiff): Finding[];
}

export interface AuditOptions {
  /** Rule ids to switch off. */
  ignoreRules?: string[];
  /** Drop findings below this severity. */
  minSeverity?: Severity;
  /** Files to skip entirely, as gitignore-style globs relative to the repository root. */
  ignorePaths?: string[];
}
