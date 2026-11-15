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

  /**
   * Whether a closing quote just before `at` really ends the field: it must be
   * followed by a separator or the end of the line. Trailing padding before the
   * line ending counts too in the modes that collapse runs.
   */
  const closesField = (at: number): boolean => {
    if (at >= n || content[at] === '\n' || content[at] === '\r') return true;
    if (!whitespaceMode) return content[at] === delimiter;
    if (whitespaceRunLength(content, at) > 0) return true;
    let end = at;
    while (end < n && (content[end] === ' ' || content[end] === '\t')) end++;
    return end > at && (end >= n || content[end] === '\n' || content[end] === '\r');
  };

  const readBare = (): string => {
    const start = i;
    if (whitespaceMode) {
      while (i < n && content[i] !== '\n' && content[i] !== '\r' && separatorAt() === 0) i++;
      // Only a run too narrow to separate can end up here, and only at the
      // end of a line — anywhere else it would have stopped the scan.
      return content.slice(start, i).replace(/[ \t]+$/, '');
    }
    while (i < n && content[i] !== delimiter && content[i] !== '\n' && content[i] !== '\r') i++;
    return content.slice(start, i);
  };

  while (i < n) {
    const row: string[] = [];

    if (collapseRuns) skipRun();

    while (i <= n) {
      let field: string;

      // A field is quoted only when it opens with a quote *and* that quote is
      // properly closed. Anything else — `"hello` with no partner, `"5" disk` —
      // is literal text. Reading such a quote as an opener would swallow every
      // following line into one cell, which is what unescaped TSV exports from
      // databases and hand-written files routinely trigger.
      const end = i < n && content[i] === '"' ? quotedEnd(content, i, closesField) : -1;
      if (end > 0) {
        field = content.slice(i + 1, end - 1).replace(/""/g, '"');
        i = end;
      } else {
        field = readBare();
      }

      row.push(field);

      if (atRowEnd()) break;
      // A separator is always here, except after a quoted field in whitespace
      // mode followed by a lone padding space before the line ending.
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

  // Blank lines at the end of a file are padding, not data rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * Index just past the quote that closes the quoted field opening at `open`, or
 * -1 when there is no such quote. `""` is an escaped quote and does not close.
 * A closing quote must also satisfy `closes` (called with the index after it);
 * one that does not means the field was never really quoted.
 *
 * `limit` bounds the search so a stray quote cannot make a caller scan a whole
 * file when it only wants a sample.
 */
function quotedEnd(
  text: string,
  open: number,
  closes: (at: number) => boolean,
  limit = Infinity
): number {
  const stop = Math.min(text.length, limit);
  let j = open + 1;

  for (;;) {
    const q = text.indexOf('"', j);
    if (q < 0 || q >= stop) return -1;
    if (text[q + 1] === '"') {
      j = q + 2;
      continue;
    }
    return closes(q + 1) ? q + 1 : -1;
  }
}

/**
 * Delimiters `auto` scores against each other. Space is excluded on purpose:
 * ordinary prose is full of spaces, so scoring it alongside the punctuation
 * delimiters would turn any sentence into a wide table.
 */
const SCORED: DelimiterName[] = ['tab', 'comma', 'semicolon', 'pipe'];

/**
 * Characters that can end a field in any delimiter `detectDelimiter` considers,
 * plus the line endings. Quote handling during detection has to work before
 * the delimiter is known, so a quote opens or closes next to any of them.
 */
const SAMPLE_BREAKS = new Set([',', '\t', ';', '|', ' ', '\n', '\r']);

/**
 * The longest quoted span the sampler will follow. A real multi-line cell is
 * far shorter; anything longer is a stray quote, and following it would turn a
 * 20-line sample into a scan of the whole document.
 */
const MAX_SAMPLE_QUOTED = 64 * 1024;

/**
 * Guess the delimiter of a delimited-text sample.
 *
 * Scores each candidate by how consistently it splits the first `sampleLines`
 * lines into the same number of fields. Quoted sections are skipped so that
 * `"a,b",c` does not inflate the comma score.
 *
 * Tab wins outright when it splits every line consistently: ordinary text
 * almost never holds a tab, while TSV cells routinely hold commas
 * (`Tokyo, Japan`). Other ties resolve in SCORED order. Space is only a last
 * resort — see `looksSpaceSeparated`.
 */
export function detectDelimiter(content: string, sampleLines = 20): DelimiterName {
  const lines = splitSampleLines(content, sampleLines)
    .filter((l) => l.trim() !== '')
    .map(stripQuoted);
  if (lines.length === 0) return 'comma';

  let best: DelimiterName = 'comma';
  let bestScore = -1;
  let partial: DelimiterName | null = null;
  let partialScore = -1;

  for (const name of SCORED) {
    const counts = lines.map((line) => countChar(line, DELIMITERS[name]));
    const present = counts.filter((c) => c > 0).length;

    // A delimiter that never appears is not a candidate.
    if (present === 0) continue;

    if (present < lines.length) {
      // Missing from some lines — a ragged TSV whose trailing empty cells were
      // trimmed, say. Only worth keeping in reserve for when nothing fits every
      // line, and only if it is on at least half of them.
      if (present * 2 >= lines.length) {
        const score = present * 1000 + (counts.find((c) => c > 0) ?? 0);
        if (score > partialScore) {
          partialScore = score;
          partial = name;
        }
      }
      continue;
    }

    // Consistency across lines matters more than raw frequency: a file with
    // exactly 4 commas on every line beats one with a varying number of pipes.
    const first = counts[0];
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? (name === 'tab' ? 2000 : 1000) : 0) + first;

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
    if (partial) return partial;
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
 * Where a quote may open or close during detection: next to a field break or
 * at either end of the text. Mirrors the parser's rule that a quote mid-field
 * (`5" disk`) is literal, without yet knowing which delimiter is in use.
 */
function sampleQuotedEnd(text: string, open: number, limit = Infinity): number {
  if (open > 0 && !SAMPLE_BREAKS.has(text[open - 1])) return -1;
  return quotedEnd(text, open, (at) => at >= text.length || SAMPLE_BREAKS.has(text[at]), limit);
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

  const counts = lines.map((line) => countChar(line.trim(), ' ', true));
  return counts[0] > 0 && counts.every((c) => c === counts[0]);
}

/**
 * Split into at most `limit` lines, ignoring newlines inside quoted fields.
 * Lines are slices of `content`, so a long line costs no concatenation.
 */
function splitSampleLines(content: string, limit: number): string[] {
  const lines: string[] = [];
  const n = content.length;
  let start = 0;
  let i = 0;

  while (i < n && lines.length < limit) {
    const ch = content[i];

    if (ch === '"') {
      const end = sampleQuotedEnd(content, i, i + MAX_SAMPLE_QUOTED);
      if (end > 0) {
        i = end;
        continue;
      }
    }

    if (ch === '\n' || ch === '\r') {
      lines.push(content.slice(start, i));
      i += ch === '\r' && content[i + 1] === '\n' ? 2 : 1;
      start = i;
      continue;
    }

    i++;
  }

  if (lines.length < limit && start < n) lines.push(content.slice(start));
  return lines;
}

/**
 * Replace every quoted field in a sample line with a single placeholder
 * character, so that delimiters inside quotes — `"a,b",c` — are not counted.
 */
function stripQuoted(line: string): string {
  let out = '';
  let start = 0;
  let i = line.indexOf('"');

  while (i >= 0) {
    const end = sampleQuotedEnd(line, i);
    if (end > 0) {
      out += line.slice(start, i) + 'x';
      start = end;
      i = line.indexOf('"', end);
    } else {
      i = line.indexOf('"', i + 1);
    }
  }

  return out + line.slice(start);
}

/** Count `ch` in `line`. With `collapseRuns`, a run counts once — matching how the parser treats spaces. */
function countChar(line: string, ch: string, collapseRuns = false): number {
  let count = 0;
  let inRun = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === ch) {
      if (!collapseRuns || !inRun) count++;
      inRun = true;
    } else {
      inRun = false;
    }
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

/** Count whitespace separators in a quote-stripped line — one per run. */
function countWhitespaceRuns(line: string): number {
  let count = 0;
  let i = 0;

  while (i < line.length) {
    const width = whitespaceRunLength(line, i);
    if (width > 0) {
      count++;
      i += width;
      continue;
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
