import * as vscode from 'vscode';
import { CsvViewProvider } from './CsvViewProvider';
import { DelimiterName, detectDelimiter } from './delimited';
import { msg } from './i18n';
import { selectedText, showSelectionPreview } from './previewPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    CsvViewProvider.register(context),

    vscode.commands.registerCommand('csvTsvViewer.previewSelection', () =>
      previewSelection(context)
    ),

    vscode.commands.registerCommand('csvTsvViewer.openFile', openFile)
  );
}

export function deactivate(): void {}

/** Feature A: preview the text selected in the active editor. */
function previewSelection(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(msg.noActiveEditor());
    return;
  }

  const text = selectedText(editor);
  if (text.trim() === '') {
    vscode.window.showErrorMessage(msg.noSelection());
    return;
  }

  const configured = vscode.workspace
    .getConfiguration('csvTsvViewer')
    .get<DelimiterName | 'auto'>('selectionDelimiter', 'auto');

  const delimiter = configured === 'auto' ? detectDelimiter(text) : configured;

  showSelectionPreview(context.extensionUri, editor, delimiter);
}

/**
 * Feature B: open CSV/TSV files picked in the Explorer. VS Code passes the
 * clicked resource plus the full multi-selection.
 */
async function openFile(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
  const targets = uris?.length ? uris : uri ? [uri] : activeUri();

  for (const target of targets) {
    await vscode.commands.executeCommand('vscode.openWith', target, CsvViewProvider.viewType);
  }
}

function activeUri(): vscode.Uri[] {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri ? [uri] : [];
}
