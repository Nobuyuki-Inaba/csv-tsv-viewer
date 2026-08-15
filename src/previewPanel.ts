import * as vscode from 'vscode';
import { msg } from './i18n';
import type { DelimiterName } from './shared/protocol';
import { bindTableWebview, type TableWebview } from './tableWebview';

const VIEW_TYPE = 'csvTsvViewer.preview';
const FOLLOW_DEBOUNCE_MS = 150;

/** The panel is reused across invocations so previews do not pile up. */
let active: vscode.WebviewPanel | undefined;

/**
 * Show delimited text as a table beside the active editor.
 *
 * The panel is recreated per invocation because new input generally means a new
 * delimiter and a new shape — carrying over sort/filter state would be
 * misleading.
 */
export function showTextPreview(
  extensionUri: vscode.Uri,
  text: string,
  delimiter: DelimiterName
): void {
  openPanel(extensionUri, () => text, delimiter);
}

/**
 * Feature A: show the text selected in `editor`, repainting as the selection
 * moves when `followSelection` is on.
 */
export function showSelectionPreview(
  extensionUri: vscode.Uri,
  editor: vscode.TextEditor,
  delimiter: DelimiterName
): void {
  let text = selectedText(editor);
  const { view, disposables } = openPanel(extensionUri, () => text, delimiter);

  if (!vscode.workspace.getConfiguration('csvTsvViewer').get<boolean>('followSelection', true)) {
    return;
  }

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

interface Preview {
  view: TableWebview;
  /** Disposed when the panel closes; callers may push their own subscriptions. */
  disposables: vscode.Disposable[];
}

function openPanel(
  extensionUri: vscode.Uri,
  getText: () => string,
  delimiter: DelimiterName
): Preview {
  active?.dispose();

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    msg.previewTitle(),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  active = panel;

  const disposables: vscode.Disposable[] = [];
  const view = bindTableWebview(panel.webview, extensionUri, getText, delimiter, disposables);

  panel.onDidDispose(() => {
    if (active === panel) active = undefined;
    for (const disposable of disposables) disposable.dispose();
  });

  return { view, disposables };
}

/** Selected text, falling back to the whole document when nothing is selected. */
export function selectedText(editor: vscode.TextEditor): string {
  const selection = editor.document.getText(editor.selection);
  return selection.trim() !== '' ? selection : editor.document.getText();
}
