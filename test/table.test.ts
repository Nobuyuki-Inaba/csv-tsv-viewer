import { describe, it, expect } from 'vitest';
import {
  clampPage,
  computeColumnWidths,
  displayWidth,
  filterIndices,
  isNumericColumn,
  pageCount,
  pageSlice,
  sortIndices,
  toMarkdown,
  toTsv,
} from '../src/shared/table';

const rows = [
  ['Alice', '30', 'Tokyo'],
  ['bob', '9', 'Osaka'],
  ['Carol', '100', ''],
];

describe('isNumericColumn', () => {
  it('detects a numeric column', () => {
    expect(isNumericColumn(rows, 1)).toBe(true);
  });

  it('rejects a text column', () => {
    expect(isNumericColumn(rows, 0)).toBe(false);
  });

  it('accepts thousands separators', () => {
    expect(isNumericColumn([['1,234'], ['5,678']], 0)).toBe(true);
  });

  it('accepts negatives and decimals', () => {
    expect(isNumericColumn([['-1.5'], ['2.25']], 0)).toBe(true);
  });

  it('ignores empty cells but requires at least one value', () => {
    expect(isNumericColumn([['1'], [''], ['2']], 0)).toBe(true);
    expect(isNumericColumn([[''], ['']], 0)).toBe(false);
  });
});

describe('sortIndices', () => {
  const all = [0, 1, 2];

  it('sorts numeric columns by value, not lexically', () => {
    expect(sortIndices(rows, all, 1, 'asc')).toEqual([1, 0, 2]);
  });

  it('reverses on desc', () => {
    expect(sortIndices(rows, all, 1, 'desc')).toEqual([2, 0, 1]);
  });

  it('sorts text case-insensitively', () => {
    expect(sortIndices(rows, all, 0, 'asc')).toEqual([0, 1, 2]);
  });

  it('keeps empty cells last in both directions', () => {
    expect(sortIndices(rows, all, 2, 'asc').at(-1)).toBe(2);
    expect(sortIndices(rows, all, 2, 'desc').at(-1)).toBe(2);
  });

  it('is stable for equal values', () => {
    const tied = [['x', '1'], ['y', '1'], ['z', '1']];
    expect(sortIndices(tied, [0, 1, 2], 1, 'asc')).toEqual([0, 1, 2]);
  });

  it('does not mutate the input order', () => {
    const indices = [0, 1, 2];
    sortIndices(rows, indices, 1, 'desc');
    expect(indices).toEqual([0, 1, 2]);
  });

  it('only sorts the rows it is given', () => {
    expect(sortIndices(rows, [0, 2], 1, 'asc')).toEqual([0, 2]);
  });
});

describe('filterIndices', () => {
  it('returns every row for an empty query', () => {
    expect(filterIndices(rows, '')).toEqual([0, 1, 2]);
    expect(filterIndices(rows, '   ')).toEqual([0, 1, 2]);
  });

  it('matches case-insensitively across all columns', () => {
    expect(filterIndices(rows, 'ALICE')).toEqual([0]);
    expect(filterIndices(rows, 'osaka')).toEqual([1]);
  });

  it('matches substrings', () => {
    expect(filterIndices(rows, 'o')).toEqual([0, 1, 2]);
  });

  it('returns nothing when no row matches', () => {
    expect(filterIndices(rows, 'zzz')).toEqual([]);
  });
});

describe('computeColumnWidths', () => {
  it('sizes to the longest sampled value plus padding', () => {
    expect(computeColumnWidths(['a'], [['xxxxx']])).toEqual([7]);
  });

  it('accounts for the header', () => {
    expect(computeColumnWidths(['longheader'], [['x']])).toEqual([12]);
  });

  it('clamps very wide columns', () => {
    expect(computeColumnWidths(['a'], [['x'.repeat(500)]], 200, 4, 60)).toEqual([60]);
  });

  it('applies a minimum width', () => {
    expect(computeColumnWidths([''], [['']], 200, 4, 60)).toEqual([4]);
  });

  it('covers ragged rows', () => {
    expect(computeColumnWidths(['a'], [['x', 'yy']])).toHaveLength(2);
  });
});

describe('displayWidth', () => {
  it('counts ASCII as one column', () => {
    expect(displayWidth('abc')).toBe(3);
  });

  it('counts CJK as two columns', () => {
    expect(displayWidth('日本語')).toBe(6);
  });

  it('handles mixed strings', () => {
    expect(displayWidth('id:番号')).toBe(3 + 4);
  });

  it('is zero for an empty string', () => {
    expect(displayWidth('')).toBe(0);
  });
});

describe('toTsv', () => {
  it('joins cells with tabs and rows with CRLF for Excel', () => {
    expect(toTsv([['a', 'b'], ['1', '2']])).toBe('a\tb\r\n1\t2');
  });

  it('collapses tabs and newlines inside a cell so columns stay aligned', () => {
    expect(toTsv([['a\tb', 'c\nd']])).toBe('a b\tc d');
  });

  it('preserves empty cells as empty columns', () => {
    expect(toTsv([['a', '', 'c']])).toBe('a\t\tc');
  });
});

describe('toMarkdown', () => {
  it('writes a header, a separator and the rows', () => {
    expect(toMarkdown(['name', 'qty'], [['Alice', '30']])).toBe(
      '| name | qty |\n| --- | --- |\n| Alice | 30 |'
    );
  });

  it('escapes pipes so the table does not break', () => {
    expect(toMarkdown(['a'], [['x|y']])).toContain('| x\\|y |');
  });

  it('turns newlines into <br>', () => {
    expect(toMarkdown(['a'], [['x\ny']])).toContain('| x<br>y |');
  });

  it('pads ragged rows to the full width', () => {
    expect(toMarkdown(['a', 'b'], [['1']])).toBe('| a | b |\n| --- | --- |\n| 1 |  |');
  });

  it('widens to the longest row when it exceeds the header', () => {
    expect(toMarkdown(['a'], [['1', '2']])).toBe('| a |  |\n| --- | --- |\n| 1 | 2 |');
  });

  it('emits a header-only table when there are no rows', () => {
    expect(toMarkdown(['a', 'b'], [])).toBe('| a | b |\n| --- | --- |');
  });
});

describe('pageCount', () => {
  it('divides evenly', () => {
    expect(pageCount(200, 100)).toBe(2);
  });

  it('rounds a partial page up', () => {
    expect(pageCount(201, 100)).toBe(3);
  });

  it('is never below one, even with no rows', () => {
    expect(pageCount(0, 100)).toBe(1);
  });

  it('treats a non-positive page size as a single page', () => {
    expect(pageCount(500, 0)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps a valid page', () => {
    expect(clampPage(1, 300, 100)).toBe(1);
  });

  it('clamps past the last page', () => {
    expect(clampPage(99, 300, 100)).toBe(2);
  });

  it('clamps below zero', () => {
    expect(clampPage(-5, 300, 100)).toBe(0);
  });

  it('collapses to page zero when there are no rows', () => {
    expect(clampPage(3, 0, 100)).toBe(0);
  });
});

describe('pageSlice', () => {
  const indices = Array.from({ length: 25 }, (_, i) => i);

  it('returns the first page', () => {
    expect(pageSlice(indices, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('returns a middle page', () => {
    expect(pageSlice(indices, 1, 10)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('returns a short final page', () => {
    expect(pageSlice(indices, 2, 10)).toEqual([20, 21, 22, 23, 24]);
  });

  it('clamps an out-of-range page to the last one', () => {
    expect(pageSlice(indices, 99, 10)).toEqual([20, 21, 22, 23, 24]);
  });

  it('returns everything when the page size is non-positive', () => {
    expect(pageSlice(indices, 0, 0)).toEqual(indices);
  });

  it('returns nothing for an empty set', () => {
    expect(pageSlice([], 0, 10)).toEqual([]);
  });
});
