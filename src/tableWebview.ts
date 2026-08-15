import * as vscode from 'vscode';
import { DELIMITERS, normalizeWidth, parseDelimited } from './delimited';
import { buildWebviewLabels, msg } from './i18n';
import type { DelimiterName, WebviewToHost } from './shared/protocol';
import { buildHtml } from './webviewHtml';

export interface TableWebview {
  /** Re-read the source and repaint — used when the underlying file changes. */
  refresh(): void;
}

/**
 * Wire a webview to a source of delimited text.
 *
 * Shared by both entry points: the selection preview panel and the read-only
 * custom editor. The host owns parsing (so the delimiter can be switched from
 * the toolbar without re-reading the source); the webview owns all view state.
 */
export function bindTableWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  getText: () => string,
  initialDelimiter: DelimiterName,
  disposables: vscode.Disposable[]
): TableWebview {
  let delimiter = initialDelimiter;

  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
  };
  webview.html = buildHtml(webview, extensionUri);

  const post = (): void => {
    const config = vscode.workspace.getConfiguration('csvTsvViewer');
    const maxRows = config.get<number>('maxRows', 100000);
    const parsed = parseDelimited(getText(), DELIMITERS[delimiter]);
    const truncated = parsed.length > maxRows;
    const rows = normalizeWidth(truncated ? parsed.slice(0, maxRows) : parsed);

    void webview.postMessage({
      type: 'init',
      rows,
      hasHeader: config.get<boolean>('hasHeader', true),
      delimiter,
      pageSize: config.get<number>('pageSize', 200),
      truncated,
      maxRows,
      labels: buildWebviewLabels(),
    });
  };

  disposables.push(
    webview.onDidReceiveMessage((message: WebviewToHost) => {
      switch (message.type) {
        case 'ready':
          post();
          break;

        case 'setDelimiter':
          delimiter = message.delimiter;
          post();
          break;

        case 'copy':
          void vscode.env.clipboard.writeText(message.text).then(() => {
            const rows = message.text === '' ? 0 : message.text.split('\n').length;
            vscode.window.setStatusBarMessage(msg.copiedRows(rows), 3000);
          });
          break;

        case 'openSettings':
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:nobuyuki-inaba.csv-tsv-viewer'
          );
          break;
      }
    })
  );

  return { refresh: post };
}
