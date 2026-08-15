/**
 * Pure table operations shared by the webview renderer.
 *
 * Kept free of DOM access so every sorting/filtering/measuring rule is unit
 * testable without a browser environment.
 */

export type SortDirection = 'asc' | 'desc';

/**
 * A column is treated as numeric only when every non-empty sampled value parses
 * as a number. Thousands separators are tolerated so `1,234` still sorts
 * numerically inside a TSV.
 */
export function isNumericColumn(rows: string[][], col: number, sample = 200): boolean {
  let seen = 0;

  for (let i = 0; i < rows.length && i < sample; i++) {
    const value = rows[i]?.[col]?.trim() ?? '';
    if (value === '') continue;
    if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(value)) return false;
    seen++;
  }

  return seen > 0;
}

function toNumber(value: string): number {
  const n = Number(value.trim().replace(/,/g, ''));
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
}

/**
 * Sort row indices by one column. Empty cells always sort last regardless of
 * direction, so blanks never push real data off the first screen.
 */
export function sortIndices(
  rows: string[][],
  indices: number[],
  col: number,
  direction: SortDirection
): number[] {
  const numeric = isNumericColumn(rows, col);
  const sign = direction === 'asc' ? 1 : -1;

  return [...indices].sort((a, b) => {
    const left = rows[a]?.[col] ?? '';
    const right = rows[b]?.[col] ?? '';

    if (left === '' && right === '') return a - b;
    if (left === '') return 1;
    if (right === '') return -1;

    const diff = numeric
      ? toNumber(left) - toNumber(right)
      : left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

    return diff === 0 ? a - b : diff * sign;
  });
}

/** Row indices whose cells contain `query` (case-insensitive substring). */
export function filterIndices(rows: string[][], query: string): number[] {
  const needle = query.trim().toLowerCase();
  const all = rows.map((_, i) => i);
  if (needle === '') return all;

  return all.filter((i) => rows[i].some((cell) => cell.toLowerCase().includes(needle)));
}

/**
 * Width of each column in characters, measured over a sample of rows and
 * clamped so one long cell cannot push every other column off screen.
 */
export function computeColumnWidths(
  header: string[],
  rows: string[][],
  sample = 200,
  min = 4,
  max = 60
): number[] {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 0);
  const widths: number[] = [];

  for (let col = 0; col < width; col++) {
    let longest = displayWidth(header[col] ?? '');
    for (let i = 0; i < rows.length && i < sample; i++) {
      longest = Math.max(longest, displayWidth(rows[i]?.[col] ?? ''));
    }
    widths.push(Math.min(Math.max(longest + 2, min), max));
  }

  return widths;
}

/**
 * Character count with East Asian wide characters counted double, so CJK
 * columns are not rendered too narrow.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * Serialize rows as TSV — the format Excel and Google Sheets paste straight
 * into cells. Tabs and newlines inside a cell would break that grid alignment,
 * so they collapse to spaces.
 */
export function toTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\r\n');
}

/**
 * Serialize rows as a GitHub-flavored Markdown table. The first row is the
 * header. Pipes are escaped and newlines become `<br>` so the table survives
 * rendering.
 */
export function toMarkdown(header: string[], rows: string[][]): string {
  const escape = (cell: string): string =>
    cell.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();

  const width = Math.max(header.length, ...rows.map((r) => r.length), 0);
  const line = (cells: string[]): string => {
    const padded = Array.from({ length: width }, (_, i) => escape(cells[i] ?? ''));
    return `| ${padded.join(' | ')} |`;
  };

  return [
    line(header),
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

/**
 * Swap rows and columns. Short rows are padded with empty cells so the result
 * is rectangular even when the source was ragged.
 */
export function transpose(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, col) => rows.map((row) => row[col] ?? ''));
}

/** Total pages for `total` rows, never less than one so the pager always reads "1 / 1". */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp a page index into `[0, pageCount - 1]`. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}

/** The slice of `indices` belonging to `page` (0-based). */
export function pageSlice(indices: number[], page: number, pageSize: number): number[] {
  if (pageSize <= 0) return indices;
  const start = clampPage(page, indices.length, pageSize) * pageSize;
  return indices.slice(start, start + pageSize);
}
