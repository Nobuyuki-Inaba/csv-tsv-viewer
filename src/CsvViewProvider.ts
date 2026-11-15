import * as vscode from 'vscode';
import { delimiterForFileName } from './delimited';
import { decodeText, EncodingName } from './encoding';
import { msg } from './i18n';
import { bindTableWebview } from './tableWebview';

/** A read-only document: the decoded text of one CSV/TSV file. */
class CsvDocument implements vscode.CustomDocument {
  constructor(
    readonly uri: vscode.Uri,
    public text: string
  ) {}

  dispose(): void {}
}

/**
 * Feature B: the table view for files opened from the Explorer.
 *
 * Registered with `priority: "option"`, so the plain text editor stays the
 * default for .csv/.tsv and this view is always opt-in.
 */
export class CsvViewProvider implements vscode.CustomReadonlyEditorProvider<CsvDocument> {
  static readonly viewType = 'csvTsvViewer.tableView';

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      CsvViewProvider.viewType,
      new CsvViewProvider(context.extensionUri),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async openCustomDocument(uri: vscode.Uri): Promise<CsvDocument> {
    return new CsvDocument(uri, await readText(uri));
  }

  async resolveCustomEditor(
    document: CsvDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const disposables: vscode.Disposable[] = [];

    const view = bindTableWebview(
      panel.webview,
      this.extensionUri,
      () => document.text,
      delimiterForFileName(document.uri.path),
      disposables
    );

    // Reload when the file changes on disk — the view is read-only, so the
    // file is the single source of truth.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(document.uri, '..'),
        posixBasename(document.uri.path)
      )
    );
    // Saves can fire several change events in quick succession, and the reads
    // they start may finish out of order. Only the latest read is shown, so an
    // older snapshot can never overwrite a newer one.
    let generation = 0;
    watcher.onDidChange(async () => {
      const mine = ++generation;
      const text = await readText(document.uri);
      if (mine !== generation) return;
      document.text = text;
      view.refresh();
    });
    disposables.push(watcher);

    panel.onDidDispose(() => {
      for (const disposable of disposables) disposable.dispose();
    });
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  const encoding = vscode.workspace
    .getConfiguration('csvTsvViewer')
    .get<EncodingName>('encoding', 'auto');

  try {
    return decodeText(await vscode.workspace.fs.readFile(uri), encoding);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(msg.readFailed(detail));
    return '';
  }
}

function posixBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
