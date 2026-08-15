/**
 * Delimited-text parsing. Pure functions only — no VS Code dependency, so this
 * module is directly unit-testable.
 *
 * Ported from simple-excel-editor/src/CsvUtils.ts, generalized from a hardcoded
 * comma to a delimiter parameter.
 */

import type { DelimiterName } from './shared/protocol';

export type { DelimiterName };

export const DELIMITERS: Record<DelimiterName, string> = {
  comma: ',',
  tab: '\t',
  semicolon: ';',
  pipe: '|',
};

/**
 * RFC 4180 parser — handles quoted fields, embedded delimiters and newlines,
 * and `""` escapes. Works with any single-character delimiter.
 */
export function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    const row: string[] = [];

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
      } else {
        while (i < n && content[i] !== delimiter && content[i] !== '\n' && content[i] !== '\r') {
          field += content[i++];
        }
      }

      row.push(field);

      if (i >= n || content[i] === '\n' || content[i] === '\r') break;
      i++; // skip delimiter
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
 * Guess the delimiter of a delimited-text sample.
 *
 * Scores each candidate by how consistently it splits the first `sampleLines`
 * lines into the same number of fields. Quoted sections are skipped so that
 * `"a,b",c` does not inflate the comma score. Ties resolve in DELIMITERS order,
 * which puts comma first.
 */
export function detectDelimiter(content: string, sampleLines = 20): DelimiterName {
  const lines = splitLinesOutsideQuotes(content, sampleLines).filter((l) => l.trim() !== '');
  if (lines.length === 0) return 'comma';

  let best: DelimiterName = 'comma';
  let bestScore = -1;

  for (const name of Object.keys(DELIMITERS) as DelimiterName[]) {
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

  return best;
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

/** Count occurrences of `delimiter` that fall outside quoted fields. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delimiter) count++;
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
