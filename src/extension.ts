import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { auditDiff } from './core/audit';
import { createBaseline, newSinceBaseline, parseBaseline } from './core/baseline';
import { countBySeverity, formatFindings } from './core/format';
import { SEVERITY_RANK } from './core/types';
import type { Finding, Severity } from './core/types';
import { baselinePath, collectDiff } from './git';

interface LocatedFinding extends Finding {
  uri: vscode.Uri;
}

class FindingsProvider implements vscode.TreeDataProvider<LocatedFinding> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private items: LocatedFinding[] = [];

  set(items: LocatedFinding[]): void {
    this.items = items;
    this.emitter.fire();
  }

  getTreeItem(f: LocatedFinding): vscode.TreeItem {
    const item = new vscode.TreeItem(f.message, vscode.TreeItemCollapsibleState.None);
    item.description = f.ruleId === 'test-file-deleted' ? `${f.file} (deleted)` : `${f.file}:${f.line}`;
    item.tooltip = f.snippet ? `${f.ruleId}\n${f.snippet}` : f.ruleId;
    item.iconPath = new vscode.ThemeIcon(
      f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'info',
    );
    if (f.ruleId !== 'test-file-deleted') {
      const line = Math.max(0, f.line - 1);
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [f.uri, { selection: new vscode.Range(line, 0, line, 0) }],
      };
    }
    return item;
  }

  getChildren(element?: LocatedFinding): LocatedFinding[] {
    return element ? [] : this.items;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('Diff Auditor');
  const provider = new FindingsProvider();
  const treeView = vscode.window.createTreeView('diffAuditor.findings', { treeDataProvider: provider });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = 'diffAuditor.audit';
  status.text = '$(shield) Diff Audit';
  status.tooltip = 'Audit uncommitted changes for agent shortcuts';
  status.show();
  treeView.message = 'Run "Diff Auditor: Audit Changes" to scan your uncommitted changes.';

  function pickFolder(): vscode.WorkspaceFolder {
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = (active && vscode.workspace.getWorkspaceFolder(active)) || vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('Open a folder that is a git repository first.');
    }
    return folder;
  }

  /**
   * Audits the working tree. The saved baseline (shared with the diffaudit CLI and the agent hooks)
   * hides findings that existed when it was saved; `hidden` says how many that was. An explicit
   * base ref skips the baseline, because whoever asks for a different comparison wants the full picture.
   */
  async function runAudit(
    baseRefOverride?: string,
  ): Promise<{ root: string; findings: Finding[]; hidden: number }> {
    const cfg = vscode.workspace.getConfiguration('diffAuditor');
    const cwd = pickFolder().uri.fsPath;
    const { root, diff } = await collectDiff({
      cwd,
      baseRef: baseRefOverride || cfg.get<string>('baseRef', 'HEAD'),
      includeUntracked: cfg.get<boolean>('includeUntracked', true),
    });
    const all = auditDiff(diff, { ignoreRules: cfg.get<string[]>('ignoreRules', []) });
    let visible = all;
    if (!baseRefOverride) {
      const file = await baselinePath(cwd);
      if (existsSync(file)) {
        try {
          visible = newSinceBaseline(all, parseBaseline(await readFile(file, 'utf8')));
        } catch {
          throw new Error('The saved baseline cannot be read. Run "Diff Auditor: Clear Baseline" and set it again.');
        }
      }
    }
    const minRank = SEVERITY_RANK[cfg.get<Severity>('minSeverity', 'low')];
    return {
      root,
      findings: visible.filter((f) => SEVERITY_RANK[f.severity] >= minRank),
      hidden: all.length - visible.length,
    };
  }

  function publish(root: string, findings: Finding[], hidden = 0): void {
    const located = findings.map((f) => ({ ...f, uri: vscode.Uri.file(join(root, f.file)) }));

    diagnostics.clear();
    const byFile = new Map<string, { uri: vscode.Uri; list: vscode.Diagnostic[] }>();
    for (const f of located) {
      const line = Math.max(0, f.line - 1);
      const d = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        `${f.message} (${f.ruleId})`,
        f.severity === 'high' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      d.source = 'Diff Auditor';
      d.code = f.ruleId;
      const key = f.uri.toString();
      const entry = byFile.get(key) ?? { uri: f.uri, list: [] };
      entry.list.push(d);
      byFile.set(key, entry);
    }
    for (const { uri, list } of byFile.values()) {
      diagnostics.set(uri, list);
    }

    provider.set(located);
    const counts = countBySeverity(findings);
    treeView.message = findings.length === 0 ? 'No suspicious changes found.' : undefined;
    treeView.description = hidden > 0 ? `${hidden} hidden by baseline` : undefined;
    treeView.badge = findings.length ? { value: findings.length, tooltip: `${counts.high} high severity` } : undefined;
    status.text = findings.length === 0 ? '$(shield) Diff Audit: clean' : `$(shield) Diff Audit: ${findings.length} (${counts.high} high)`;
    status.tooltip = hidden > 0 ? `Audit uncommitted changes for agent shortcuts (${hidden} existing finding(s) hidden by the baseline)` : 'Audit uncommitted changes for agent shortcuts';
    status.backgroundColor = counts.high > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  async function auditAndShow(interactive: boolean): Promise<void> {
    try {
      const { root, findings, hidden } = await runAudit();
      publish(root, findings, hidden);
      if (interactive) {
        if (findings.length > 0) {
          await vscode.commands.executeCommand('diffAuditor.findings.focus');
        } else {
          void vscode.window.showInformationMessage('Diff Auditor: no suspicious changes found.');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.text = '$(shield) Diff Audit: error';
      status.tooltip = message;
      if (interactive) {
        void vscode.window.showErrorMessage(`Diff Auditor: ${message}`);
      }
    }
  }

  context.subscriptions.push(
    diagnostics,
    treeView,
    status,
    vscode.commands.registerCommand('diffAuditor.audit', () =>
      vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Auditing changes' }, () =>
        auditAndShow(true),
      ),
    ),
    vscode.commands.registerCommand('diffAuditor.setBaseline', async () => {
      try {
        const cwd = pickFolder().uri.fsPath;
        const cfg = vscode.workspace.getConfiguration('diffAuditor');
        const { diff } = await collectDiff({
          cwd,
          baseRef: cfg.get<string>('baseRef', 'HEAD'),
          includeUntracked: cfg.get<boolean>('includeUntracked', true),
        });
        const findings = auditDiff(diff, { ignoreRules: cfg.get<string[]>('ignoreRules', []) });
        await writeFile(await baselinePath(cwd), JSON.stringify(createBaseline(findings), null, 2));
        await auditAndShow(false);
        void vscode.window.showInformationMessage(
          `Diff Auditor: baseline saved. ${findings.length} existing finding(s) will be hidden; only new ones are reported.`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Diff Auditor: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand('diffAuditor.clearBaseline', async () => {
      try {
        await rm(await baselinePath(pickFolder().uri.fsPath), { force: true });
        await auditAndShow(false);
        void vscode.window.showInformationMessage('Diff Auditor: baseline cleared. All findings are shown again.');
      } catch (err) {
        void vscode.window.showErrorMessage(`Diff Auditor: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand('diffAuditor.clear', () => {
      diagnostics.clear();
      provider.set([]);
      treeView.badge = undefined;
      treeView.description = undefined;
      treeView.message = 'Run "Diff Auditor: Audit Changes" to scan your uncommitted changes.';
      status.text = '$(shield) Diff Audit';
      status.backgroundColor = undefined;
    }),
  );

  // Optional: re-audit shortly after each save.
  let timer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!vscode.workspace.getConfiguration('diffAuditor').get<boolean>('autoAudit', false)) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void auditAndShow(false), 1500);
    }),
    { dispose: () => clearTimeout(timer) },
  );

  // Let agents run the audit on their own work (Copilot agent mode, and anything else that
  // can call VS Code language model tools). Guarded because some VS Code forks lack the API.
  if (typeof vscode.lm?.registerTool === 'function') {
    context.subscriptions.push(
      vscode.lm.registerTool<{ baseRef?: string }>('diffAuditor_auditChanges', {
        async invoke(options) {
          try {
            const { root, findings, hidden } = await runAudit(options.input?.baseRef);
            publish(root, findings, hidden);
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(formatFindings(findings, 50, hidden)),
            ]);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`Diff Auditor could not run: ${message}`),
            ]);
          }
        },
      }),
    );
  }
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
