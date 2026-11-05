import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXT_ID = 'your-publisher-id.agent-diff-auditor';

function diagnosticsFor(suffix: string): vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics()
    .filter(([uri]) => uri.fsPath.endsWith(suffix))
    .flatMap(([, list]) => list)
    .filter((d) => d.source === 'Diff Auditor');
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}`);
    throw err;
  }
}

export async function run(): Promise<void> {
  await check('extension activates and registers its commands', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('diffAuditor.audit'));
    assert.ok(all.includes('diffAuditor.clear'));
  });

  await check('audit command publishes diagnostics', async () => {
    await vscode.commands.executeCommand('diffAuditor.audit');
    assert.ok(diagnosticsFor('a.test.js').length > 0, 'no diagnostic on skipped test');
    assert.ok(diagnosticsFor('app.ts').length > 0, 'no diagnostic on suppression');
    assert.ok(diagnosticsFor('new.test.js').length > 0, 'no diagnostic on untracked file');
  });

  await check('ignoreRules hides a rule', async () => {
    const before = diagnosticsFor('app.ts');
    const ruleId = String(before[0].code);
    await vscode.workspace.getConfiguration('diffAuditor').update('ignoreRules', [ruleId], vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('diffAuditor.audit');
    assert.equal(diagnosticsFor('app.ts').filter((d) => d.code === ruleId).length, 0);
    await vscode.workspace.getConfiguration('diffAuditor').update('ignoreRules', [], vscode.ConfigurationTarget.Workspace);
  });

  await check('language model tool is registered and returns findings', async () => {
    assert.ok(vscode.lm.tools.some((t) => t.name === 'diffAuditor_auditChanges'), 'tool not listed');
    const result = await vscode.lm.invokeTool('diffAuditor_auditChanges', {
      input: {},
      toolInvocationToken: undefined,
    });
    const text = result.content.map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : '')).join('');
    assert.match(text, /a\.test\.js/);
  });

  await check('clear command removes diagnostics', async () => {
    await vscode.commands.executeCommand('diffAuditor.clear');
    assert.equal(diagnosticsFor('a.test.js').length, 0);
  });
}
