import * as vscode from 'vscode';
import { msg } from './i18n';
import type { DelimiterName } from './shared/protocol';
import { bindTableWebview } from './tableWebview';

const VIEW_TYPE = 'csvTsvViewer.preview';
const FOLLOW_DEBOUNCE_MS = 150;

/** The panel is reused across invocations so previews do not pile up. */
let active: vscode.WebviewPanel | undefined;

/**
 * Feature A: show the text selected in `editor` as a table beside it.
 *
 * The panel is recreated per invocation because a new selection generally means
 * a new delimiter and a new shape — carrying over sort/filter state would be
 * misleading.
 */
export function showSelectionPreview(
  extensionUri: vscode.Uri,
  editor: vscode.TextEditor,
  delimiter: DelimiterName
): void {
  active?.dispose();

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    msg.previewTitle(),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  active = panel;

  const disposables: vscode.Disposable[] = [];
  let text = selectedText(editor);

  const view = bindTableWebview(panel.webview, extensionUri, () => text, delimiter, disposables);

  if (vscode.workspace.getConfiguration('csvTsvViewer').get<boolean>('followSelection', true)) {
    let timer: NodeJS.Timeout | undefined;

    disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document !== editor.document) return;

        // Selection events fire per keystroke while dragging; repaint once the
        // selection settles.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const next = selectedText(event.textEditor);
          if (next === text) return;
          text = next;
          view.refresh();
        }, FOLLOW_DEBOUNCE_MS);
      }),
      new vscode.Disposable(() => {
        if (timer) clearTimeout(timer);
      })
    );
  }

  panel.onDidDispose(() => {
    if (active === panel) active = undefined;
    for (const disposable of disposables) disposable.dispose();
  });
}

/** Selected text, falling back to the whole document when nothing is selected. */
export function selectedText(editor: vscode.TextEditor): string {
  const selection = editor.document.getText(editor.selection);
  return selection.trim() !== '' ? selection : editor.document.getText();
}
