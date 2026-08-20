/**
 * Delimited-text parsing. Pure functions only — no VS Code dependency, so this
 * module is directly unit-testable.
 *
 * Ported from simple-excel-editor/src/CsvUtils.ts, generalized from a hardcoded
 * comma to a delimiter parameter.
 */

import type { DelimiterName } from './shared/protocol';

export type { DelimiterName };

/**
 * Not a character: the `whitespace` mode splits on a run of spaces and tabs that
 * either contains a tab or is at least two wide. A lone space stays inside the
 * cell, so `New York  36` is two fields rather than three.
 *
 * It exists because tabs do not survive a round trip through most rendered text
 * — a TSV copied out of a chat reply or a rendered document arrives with its
 * tabs expanded to spaces, and tab-stop alignment makes the width vary from one
 * column to the next. Two is the practical floor: a single space cannot be told
 * apart from a word break.
 *
 * `DELIMITERS` carries it as a sentinel so callers can keep looking a delimiter
 * up by name and handing the result straight to `parseDelimited`.
 */
export const WHITESPACE = '\t ';

export const DELIMITERS: Record<DelimiterName, string> = {
  comma: ',',
  tab: '\t',
  semicolon: ';',
  pipe: '|',
  space: ' ',
  whitespace: WHITESPACE,
};

/**
 * RFC 4180 parser — handles quoted fields, embedded delimiters and newlines,
 * and `""` escapes. Works with any single-character delimiter, plus the
 * `WHITESPACE` mode.
 *
 * A space delimiter is special-cased: runs collapse to one separator and a
 * leading run is treated as indentation. Column-aligned output (`ps`, `df`, a
 * pasted fixed-width report) is the only reason to pick space at all, and
 * taking every space literally would fill such a table with empty cells. The
 * `WHITESPACE` mode collapses runs the same way; it differs only in which runs
 * separate at all.
 */
export function parseDelimited(content: string, delimiter: string): string[][] {
  const whitespaceMode = delimiter === WHITESPACE;
  const collapseRuns = whitespaceMode || delimiter === ' ';
  const rows: string[][] = [];
  let i = 0;
  const n = content.length;

  const atRowEnd = (): boolean => i >= n || content[i] === '\n' || content[i] === '\r';

  /** Width of the separator at `i`, or 0 when there is none. */
  const separatorAt = (): number => {
    if (!whitespaceMode) return content[i] === delimiter ? 1 : 0;
    return whitespaceRunLength(content, i);
  };

  const skipRun = (): void => {
    if (whitespaceMode) {
      while (i < n && (content[i] === ' ' || content[i] === '\t')) i++;
      return;
    }
    while (i < n && content[i] === delimiter) i++;
  };

  while (i < n) {
    const row: string[] = [];

    if (collapseRuns) skipRun();

    while (i <= n) {
      let field = '';

      if (i < n && content[i] === '"') {
        i++; // skip opening quote
        while (i < n) {
          if (content[i] === '"') {
            if (i + 1 < n && content[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += content[i++];
          }
        }
      } else if (whitespaceMode) {
        while (i < n && content[i] !== '\n' && content[i] !== '\r' && separatorAt() === 0) {
          field += content[i++];
        }
        // Only a run too narrow to separate can end up here, and only at the
        // end of a line — anywhere else it would have stopped the scan.
        field = field.replace(/[ \t]+$/, '');
      } else {
        while (i < n && content[i] !== delimiter && content[i] !== '\n' && content[i] !== '\r') {
          field += content[i++];
        }
      }

      row.push(field);

      if (atRowEnd()) break;
      i += separatorAt() || 1; // skip delimiter
      if (collapseRuns) {
        skipRun();
        // A run before the line ending is trailing padding, not another field.
        if (atRowEnd()) break;
      }
    }

    // Skip line ending
    if (i < n && content[i] === '\r') i++;
    if (i < n && content[i] === '\n') i++;

    rows.push(row);
  }

  // Remove trailing empty row that parsers often produce
  if (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * Delimiters `auto` scores against each other. Space is excluded on purpose:
 * ordinary prose is full of spaces, so scoring it alongside the punctuation
 * delimiters would turn any sentence into a wide table.
 */
const SCORED: DelimiterName[] = ['comma', 'tab', 'semicolon', 'pipe'];

/**
 * Guess the delimiter of a delimited-text sample.
 *
 * Scores each candidate by how consistently it splits the first `sampleLines`
 * lines into the same number of fields. Quoted sections are skipped so that
 * `"a,b",c` does not inflate the comma score. Ties resolve in SCORED order,
 * which puts comma first. Space is only a last resort — see
 * `looksSpaceSeparated`.
 */
export function detectDelimiter(content: string, sampleLines = 20): DelimiterName {
  const lines = splitLinesOutsideQuotes(content, sampleLines).filter((l) => l.trim() !== '');
  if (lines.length === 0) return 'comma';

  let best: DelimiterName = 'comma';
  let bestScore = -1;

  for (const name of SCORED) {
    const counts = lines.map((line) => countOutsideQuotes(line, DELIMITERS[name]));
    const first = counts[0];

    // A delimiter that never appears is not a candidate.
    if (first === 0 || counts.some((c) => c === 0)) continue;

    // Consistency across lines matters more than raw frequency: a file with
    // exactly 4 commas on every line beats one with a varying number of pipes.
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? 1000 : 0) + first;

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (bestScore < 0) {
    // Whitespace first: it reads `a b  c` as two fields where space reads three,
    // and a table whose cells hold no spaces parses the same either way.
    if (looksWhitespaceSeparated(lines)) return 'whitespace';
    if (looksSpaceSeparated(lines)) return 'space';
  }
  return best;
}

/**
 * Whether a sample looks like columns held apart by tabs or by gaps of two or
 * more spaces — the shape a TSV takes once its tabs have been expanded.
 *
 * As strict as `looksSpaceSeparated`, and for the same reason: several lines,
 * each breaking into the same number of fields. Prose supplies the odd double
 * space after a full stop, never the same count on every line.
 */
function looksWhitespaceSeparated(lines: string[]): boolean {
  if (lines.length < 2) return false;

  const counts = lines.map((line) => countWhitespaceRuns(line.trim()));
  return counts[0] > 0 && counts.every((c) => c === counts[0]);
}

/**
 * Whether a sample no punctuation delimiter fits is worth reading as
 * space-separated columns.
 *
 * Deliberately strict, because the alternative reading is "this is prose":
 * several lines are required, and every one of them must break into the exact
 * same number of fields. A paragraph almost never has an identical word count
 * on every line; a column-aligned report always does.
 */
function looksSpaceSeparated(lines: string[]): boolean {
  if (lines.length < 2) return false;

  const counts = lines.map((line) => countOutsideQuotes(line.trim(), ' ', true));
  return counts[0] > 0 && counts.every((c) => c === counts[0]);
}

/** Split into at most `limit` lines, ignoring newlines inside quoted fields. */
function splitLinesOutsideQuotes(content: string, limit: number): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length && lines.length < limit; i++) {
    const ch = content[i];

    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (lines.length < limit && current !== '') lines.push(current);
  return lines;
}

/**
 * Count occurrences of `delimiter` that fall outside quoted fields. With
 * `collapseRuns`, a run counts once — matching how the parser treats spaces.
 */
function countOutsideQuotes(line: string, delimiter: string, collapseRuns = false): number {
  let count = 0;
  let inQuotes = false;
  let inRun = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      inRun = false;
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      if (!collapseRuns || !inRun) count++;
      inRun = true;
      continue;
    }

    inRun = false;
  }

  return count;
}

/**
 * Width of the run of spaces and tabs at `at`, or 0 when the run does not
 * separate. A run qualifies if it holds a tab or is at least two wide; a lone
 * space is an ordinary character.
 */
function whitespaceRunLength(text: string, at: number): number {
  let end = at;
  let hasTab = false;

  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) {
    if (text[end] === '\t') hasTab = true;
    end++;
  }

  const width = end - at;
  return hasTab || width >= 2 ? width : 0;
}

/** Count whitespace separators outside quoted fields — one per run. */
function countWhitespaceRuns(line: string): number {
  let count = 0;
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes) {
      const width = whitespaceRunLength(line, i);
      if (width > 0) {
        count++;
        i += width;
        continue;
      }
    }

    i++;
  }

  return count;
}

/**
 * Delimiter implied by a file name. `.tsv`/`.tab` are tab-separated by
 * definition; everything else defaults to comma.
 */
export function delimiterForFileName(fileName: string): DelimiterName {
  return /\.(tsv|tab)$/i.test(fileName) ? 'tab' : 'comma';
}

/**
 * Whether parsed rows are worth showing as a table.
 *
 * A single cell means the input had no delimiters and no line breaks — a stray
 * scrap of text rather than tabular data. A one-column *list* is still tabular,
 * so only the 1x1 case is rejected.
 */
export function looksTabular(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  return rows.length > 1 || (rows[0]?.length ?? 0) > 1;
}

/** Pad short rows so every row has the same width as the widest one. */
export function normalizeWidth(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => (row.length === width ? row : [...row, ...Array(width - row.length).fill('')]));
}

/** Generate spreadsheet-style column names: A, B, …, Z, AA, AB, … */
export function generateColumnNames(count: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    let n = i;
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    names.push(name);
  }
  return names;
}
