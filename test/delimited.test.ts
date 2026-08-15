import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  detectDelimiter,
  delimiterForFileName,
  looksTabular,
  normalizeWidth,
  generateColumnNames,
  DELIMITERS,
} from '../src/delimited';

describe('parseDelimited', () => {
  it('parses simple comma rows', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses tab-separated rows', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps delimiters inside quoted fields', () => {
    expect(parseDelimited('"a,b",c', ',')).toEqual([['a,b', 'c']]);
  });

  it('keeps tabs inside quoted fields', () => {
    expect(parseDelimited('"a\tb"\tc', '\t')).toEqual([['a\tb', 'c']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('"say ""hi""",x', ',')).toEqual([['say "hi"', 'x']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseDelimited('"line1\nline2",b', ',')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops the trailing empty row from a trailing newline', () => {
    expect(parseDelimited('a,b\n', ',')).toEqual([['a', 'b']]);
  });

  it('preserves empty fields', () => {
    expect(parseDelimited('a,,c', ',')).toEqual([['a', '', 'c']]);
  });

  it('preserves ragged rows as-is', () => {
    expect(parseDelimited('a,b,c\n1,2', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseDelimited('', ',')).toEqual([]);
  });

  it('parses a single column', () => {
    expect(parseDelimited('a\nb\nc', ',')).toEqual([['a'], ['b'], ['c']]);
  });
});

describe('parseDelimited with a space delimiter', () => {
  it('splits on single spaces', () => {
    expect(parseDelimited('a b c\n1 2 3', ' ')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('collapses runs of spaces into one separator', () => {
    expect(parseDelimited('a   b  c', ' ')).toEqual([['a', 'b', 'c']]);
  });

  it('keeps column-aligned rows the same width', () => {
    const text = ['NAME    QTY   UNIT', 'apple     30  kg', 'kiwi       9  kg'].join('\n');
    expect(parseDelimited(text, ' ')).toEqual([
      ['NAME', 'QTY', 'UNIT'],
      ['apple', '30', 'kg'],
      ['kiwi', '9', 'kg'],
    ]);
  });

  it('treats a leading run as indentation, not an empty first field', () => {
    expect(parseDelimited('   a b', ' ')).toEqual([['a', 'b']]);
  });

  it('drops trailing padding rather than adding an empty field', () => {
    expect(parseDelimited('a b   \nc d', ' ')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps spaces inside quoted fields', () => {
    expect(parseDelimited('"New York"  US', ' ')).toEqual([['New York', 'US']]);
  });

  it('reduces a line of nothing but spaces to a blank row', () => {
    // Same shape a blank line produces under any other delimiter.
    expect(parseDelimited('a b\n   \nc d', ' ')).toEqual([['a', 'b'], [''], ['c', 'd']]);
  });

  it('leaves other delimiters uncollapsed', () => {
    expect(parseDelimited('a,,b', ',')).toEqual([['a', '', 'b']]);
  });
});

describe('detectDelimiter', () => {
  it('detects comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe('comma');
  });

  it('detects tab', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('tab');
  });

  it('detects semicolon', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe('semicolon');
  });

  it('detects pipe', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('pipe');
  });

  it('ignores delimiters inside quoted fields', () => {
    // Every line has one real tab; the commas only live inside quotes.
    expect(detectDelimiter('"a,b,c"\tx\n"d,e,f"\ty')).toBe('tab');
  });

  it('prefers the delimiter with a consistent field count', () => {
    // Semicolon appears twice on every line; commas vary.
    expect(detectDelimiter('a;b;c\nx,y;z;w\np;q;r')).toBe('semicolon');
  });

  it('defaults to comma for single-column input', () => {
    expect(detectDelimiter('alpha\nbeta\ngamma')).toBe('comma');
  });

  it('defaults to comma for empty input', () => {
    expect(detectDelimiter('')).toBe('comma');
  });

  it('skips blank lines', () => {
    expect(detectDelimiter('a\tb\n\n1\t2')).toBe('tab');
  });

  it('handles CRLF samples', () => {
    expect(detectDelimiter('a\tb\r\n1\t2\r\n')).toBe('tab');
  });

  it('falls back to space for column-aligned output', () => {
    expect(detectDelimiter('NAME  QTY\napple  30\nkiwi    9')).toBe('space');
  });

  it('prefers a real delimiter over space', () => {
    expect(detectDelimiter('a b,c d\ne f,g h')).toBe('comma');
  });

  it('does not read prose as space-separated', () => {
    // Wrapped prose: the word count differs from line to line.
    expect(detectDelimiter('the quick brown fox\njumps over the lazy dog\nagain')).toBe('comma');
  });

  it('does not read a single line of words as space-separated', () => {
    // One line is never enough evidence — a sentence would qualify.
    expect(detectDelimiter('just some prose here')).toBe('comma');
  });
});

describe('delimiterForFileName', () => {
  it.each([
    ['data.tsv', 'tab'],
    ['data.TSV', 'tab'],
    ['data.tab', 'tab'],
    ['data.csv', 'comma'],
    ['data.txt', 'comma'],
    ['no-extension', 'comma'],
  ])('%s -> %s', (name, expected) => {
    expect(delimiterForFileName(name)).toBe(expected);
  });
});

describe('looksTabular', () => {
  it('accepts a grid', () => {
    expect(looksTabular(parseDelimited('a,b\n1,2', ','))).toBe(true);
  });

  it('accepts a single row with several columns', () => {
    expect(looksTabular(parseDelimited('a,b,c', ','))).toBe(true);
  });

  it('accepts a single-column list', () => {
    expect(looksTabular(parseDelimited('alpha\nbeta', ','))).toBe(true);
  });

  it('rejects one scrap of text', () => {
    expect(looksTabular(parseDelimited('just some prose', ','))).toBe(false);
  });

  it('rejects empty input', () => {
    expect(looksTabular([])).toBe(false);
  });
});

describe('normalizeWidth', () => {
  it('pads short rows', () => {
    expect(normalizeWidth([['a', 'b', 'c'], ['1']])).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('leaves uniform rows untouched', () => {
    const rows = [
      ['a', 'b'],
      ['1', '2'],
    ];
    expect(normalizeWidth(rows)).toEqual(rows);
  });

  it('handles an empty table', () => {
    expect(normalizeWidth([])).toEqual([]);
  });
});

describe('generateColumnNames', () => {
  it('generates single letters', () => {
    expect(generateColumnNames(3)).toEqual(['A', 'B', 'C']);
  });

  it('rolls over past Z', () => {
    expect(generateColumnNames(28).slice(25)).toEqual(['Z', 'AA', 'AB']);
  });

  it('returns nothing for zero columns', () => {
    expect(generateColumnNames(0)).toEqual([]);
  });
});

describe('DELIMITERS', () => {
  it('maps names to single characters', () => {
    for (const char of Object.values(DELIMITERS)) {
      expect(char).toHaveLength(1);
    }
  });
});
