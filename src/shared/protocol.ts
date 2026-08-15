/**
 * Message contract between the extension host and the webview.
 *
 * Imported by both sides, so it must stay free of `vscode` and node imports.
 */

export type DelimiterName = 'comma' | 'tab' | 'semicolon' | 'pipe';

/**
 * UI strings resolved on the host and handed to the webview (see src/i18n.ts).
 * Values with `{0}`, `{1}` placeholders are filled in by `format`.
 */
export interface WebviewLabels {
  delimiter: string;
  comma: string;
  tab: string;
  semicolon: string;
  pipe: string;
  headerRow: string;
  filterPlaceholder: string;
  copyExcel: string;
  copyExcelTitle: string;
  copyMarkdown: string;
  copyMarkdownTitle: string;
  copied: string;
  settings: string;
  rowsColumns: string;
  filtered: string;
  truncated: string;
  empty: string;
  page: string;
  rowsRange: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
}

export interface InitMessage {
  type: 'init';
  /** All parsed rows, including the header row when `hasHeader` is set. */
  rows: string[][];
  hasHeader: boolean;
  delimiter: DelimiterName;
  /** Rows shown per page. */
  pageSize: number;
  /** True when the source had more rows than `csvTsvViewer.maxRows`. */
  truncated: boolean;
  maxRows: number;
  labels: WebviewLabels;
}

export type HostToWebview = InitMessage;

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'setDelimiter'; delimiter: DelimiterName }
  | { type: 'copy'; text: string }
  | { type: 'openSettings' };

/** Substitute `{0}`, `{1}`, … placeholders in a label template. */
export function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}
