import * as vscode from 'vscode';
import type { WebviewLabels } from './shared/protocol';

function isJa(): boolean {
  const lang = vscode.workspace.getConfiguration('csvTsvViewer').get<string>('language', 'auto');
  if (lang === 'ja') return true;
  if (lang === 'en') return false;
  return vscode.env.language.startsWith('ja');
}

export const msg = {
  noActiveEditor: () => (isJa() ? 'アクティブなエディタがありません。' : 'No active editor.'),
  noSelection: () =>
    isJa()
      ? 'テキストが選択されていません。CSV/TSV データを選択してください。'
      : 'No text selected. Select CSV or TSV data first.',
  clipboardEmpty: () =>
    isJa() ? 'クリップボードが空です。' : 'The clipboard is empty.',
  clipboardNotTabular: () =>
    isJa()
      ? 'クリップボードの内容は表形式ではありません。区切り文字か改行を含むデータをコピーしてください。'
      : 'The clipboard does not contain tabular data. Copy text with delimiters or line breaks.',
  parseEmpty: () =>
    isJa() ? '表として読み取れるデータがありませんでした。' : 'No tabular data could be read.',
  readFailed: (err: string) =>
    isJa() ? `ファイルの読み込みに失敗しました: ${err}` : `Failed to read file: ${err}`,
  rowsTruncated: (max: number) =>
    isJa()
      ? `行数が上限を超えたため、先頭 ${max} 行のみ表示します。`
      : `Row limit exceeded — showing the first ${max} rows.`,
  previewTitle: () => (isJa() ? 'CSV/TSV プレビュー' : 'CSV/TSV Preview'),
  copiedRows: (rows: number) =>
    isJa() ? `${rows} 行をコピーしました。` : `Copied ${rows} rows to the clipboard.`,
};

/** UI strings sent into the webview. `{0}`, `{1}` are filled in by the renderer. */
export function buildWebviewLabels(): WebviewLabels {
  return isJa()
    ? {
        delimiter: '区切り文字',
        comma: 'カンマ',
        tab: 'タブ',
        semicolon: 'セミコロン',
        pipe: 'パイプ',
        space: 'スペース',
        whitespace: 'TAB / 連続スペース',
        headerRow: 'ヘッダ行',
        transpose: '縦横変換',
        transposeTitle: '行と列を入れ替えて表示します。並べ替えは解除されます。',
        wrap: '折り返し',
        wrapTitle: '長いセルを一定の幅で折り返し、すべてのセルを同じ幅・同じ高さで表示します。',
        resizeColumn: 'ドラッグで列幅を変更（ダブルクリックで元の幅に戻す）',
        filterPlaceholder: '絞り込み…',
        copyExcel: 'Excel 用にコピー',
        copyExcelTitle: '表示中の全行をタブ区切りでコピーします（Excel にそのまま貼り付け可）。',
        copyMarkdown: 'Markdown でコピー',
        copyMarkdownTitle: '表示中の全行を Markdown の表としてコピーします。',
        copied: 'コピーしました',
        settings: '設定を開く',
        rowsColumns: '{0} 行 × {1} 列',
        filtered: '{0} / {1} 行',
        truncated: '{0} 行で切り捨て',
        empty: '表示するデータがありません。',
        page: '{0} / {1} ページ',
        rowsRange: '{2} 行中 {0}–{1} 行',
        firstPage: '最初のページ',
        previousPage: '前のページ',
        nextPage: '次のページ',
        lastPage: '最後のページ',
      }
    : {
        delimiter: 'Delimiter',
        comma: 'Comma',
        tab: 'Tab',
        semicolon: 'Semicolon',
        pipe: 'Pipe',
        space: 'Space',
        whitespace: 'Tab / 2+ spaces',
        headerRow: 'Header row',
        transpose: 'Transpose',
        transposeTitle: 'Swap rows and columns. Clears the current sort.',
        wrap: 'Wrap',
        wrapTitle: 'Wrap long cells at a fixed width and give every cell the same width and height.',
        resizeColumn: 'Drag to resize the column (double-click to reset)',
        filterPlaceholder: 'Filter…',
        copyExcel: 'Copy for Excel',
        copyExcelTitle: 'Copy every displayed row as tab-separated text, ready to paste into Excel.',
        copyMarkdown: 'Copy as Markdown',
        copyMarkdownTitle: 'Copy every displayed row as a Markdown table.',
        copied: 'Copied',
        settings: 'Open settings',
        rowsColumns: '{0} rows × {1} columns',
        filtered: '{0} of {1} rows',
        truncated: 'truncated at {0} rows',
        empty: 'Nothing to display.',
        page: 'Page {0} / {1}',
        rowsRange: '{0}–{1} of {2}',
        firstPage: 'First page',
        previousPage: 'Previous page',
        nextPage: 'Next page',
        lastPage: 'Last page',
      };
}
