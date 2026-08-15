import * as vscode from 'vscode';
import { CsvViewProvider } from './CsvViewProvider';
import { DELIMITERS, DelimiterName, detectDelimiter, looksTabular, parseDelimited } from './delimited';
import { msg } from './i18n';
import { selectedText, showSelectionPreview, showTextPreview } from './previewPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    CsvViewProvider.register(context),

    vscode.commands.registerCommand('csvTsvViewer.previewSelection', () =>
      previewSelection(context)
    ),

    vscode.commands.registerCommand('csvTsvViewer.previewClipboard', () =>
      previewClipboard(context)
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

  showSelectionPreview(context.extensionUri, editor, resolveDelimiter(text));
}

/**
 * Preview whatever delimited text is on the clipboard.
 *
 * Command Palette only — the clipboard is not a resource you can right-click,
 * so there is no menu surface for it.
 */
async function previewClipboard(context: vscode.ExtensionContext): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  if (text.trim() === '') {
    vscode.window.showErrorMessage(msg.clipboardEmpty());
    return;
  }

  const delimiter = resolveDelimiter(text);

  // Unlike the other entry points, the user cannot see what they are about to
  // preview, so reject input that would render as a useless single cell.
  if (!looksTabular(parseDelimited(text, DELIMITERS[delimiter]))) {
    vscode.window.showErrorMessage(msg.clipboardNotTabular());
    return;
  }

  showTextPreview(context.extensionUri, text, delimiter);
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

/** The configured delimiter, or one guessed from the text when set to `auto`. */
function resolveDelimiter(text: string): DelimiterName {
  const configured = vscode.workspace
    .getConfiguration('csvTsvViewer')
    .get<DelimiterName | 'auto'>('selectionDelimiter', 'auto');

  return configured === 'auto' ? detectDelimiter(text) : configured;
}
