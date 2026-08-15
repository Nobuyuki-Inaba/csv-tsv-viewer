// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '../src/webview/render';
import type { InitMessage, WebviewLabels, WebviewToHost } from '../src/shared/protocol';

const labels: WebviewLabels = {
  delimiter: 'Delimiter',
  comma: 'Comma',
  tab: 'Tab',
  semicolon: 'Semicolon',
  pipe: 'Pipe',
  space: 'Space',
  headerRow: 'Header row',
  transpose: 'Transpose',
  transposeTitle: 'Swap rows and columns.',
  filterPlaceholder: 'Filter…',
  copyExcel: 'Copy for Excel',
  copyExcelTitle: 'Copy for Excel',
  copyMarkdown: 'Copy as Markdown',
  copyMarkdownTitle: 'Copy as Markdown',
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

function init(rows: string[][], overrides: Partial<InitMessage> = {}): InitMessage {
  return {
    type: 'init',
    rows,
    hasHeader: true,
    delimiter: 'comma',
    pageSize: 200,
    truncated: false,
    maxRows: 100000,
    labels,
    ...overrides,
  };
}

const sample = [
  ['name', 'qty'],
  ['Alice', '30'],
  ['bob', '9'],
  ['Carol', '100'],
];

/** Header row plus `count` numbered data rows. */
function manyRows(count: number): string[][] {
  return [
    ['name', 'qty'],
    ...Array.from({ length: count }, (_, i) => [`row${i + 1}`, String(i + 1)]),
  ];
}

let root: HTMLElement;
let sent: WebviewToHost[];
let update: (data: InitMessage) => void;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root') as HTMLElement;
  sent = [];
  update = mount(root, { postMessage: (m) => sent.push(m) });
});

const headerCells = () => [...root.querySelectorAll('thead th.head')].map((c) => c.textContent);
const dataRows = () =>
  [...root.querySelectorAll('tbody tr:not(.spacer-row)')].map((tr) =>
    [...tr.querySelectorAll('td:not(.gutter)')].map((td) => td.textContent)
  );
const gutters = () =>
  [...root.querySelectorAll('tbody tr:not(.spacer-row) td.gutter')].map((td) => td.textContent);
const toolbarButton = (label: string) =>
  [...root.querySelectorAll('.toolbar button')].find(
    (b) => b.textContent === label
  ) as HTMLButtonElement;
const excelButton = () => toolbarButton('Copy for Excel');
const markdownButton = () => toolbarButton('Copy as Markdown');
const transposeButton = () => toolbarButton('Transpose');

describe('mount', () => {
  it('builds the toolbar before any data arrives', () => {
    expect(root.querySelector('.toolbar')).not.toBeNull();
    expect(root.querySelector('.viewport')).not.toBeNull();
  });

  it('renders header and body rows', () => {
    update(init(sample));
    expect(headerCells()).toEqual(['name', 'qty']);
    expect(dataRows()).toEqual([
      ['Alice', '30'],
      ['bob', '9'],
      ['Carol', '100'],
    ]);
  });

  it('numbers rows in the gutter', () => {
    update(init(sample));
    expect(gutters()).toEqual(['1', '2', '3']);
  });

  it('generates A, B, … headers when the first row is data', () => {
    update(init(sample, { hasHeader: false }));
    expect(headerCells()).toEqual(['A', 'B']);
    expect(dataRows()).toHaveLength(4);
  });

  it('populates the delimiter select and marks the current one', () => {
    update(init(sample, { delimiter: 'tab' }));
    const select = root.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'comma',
      'tab',
      'semicolon',
      'pipe',
      'space',
    ]);
    expect(select.value).toBe('tab');
  });

  it('shows the row and column count', () => {
    update(init(sample));
    expect(root.querySelector('.status')?.textContent).toBe('3 rows × 2 columns');
  });

  it('reports truncation', () => {
    update(init(sample, { truncated: true, maxRows: 3 }));
    expect(root.querySelector('.status')?.textContent).toContain('truncated at 3 rows');
    expect(root.querySelector('.status')?.classList.contains('warn')).toBe(true);
  });

  it('shows an empty state for no rows', () => {
    update(init([]));
    const empty = root.querySelector('.empty') as HTMLElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Nothing to display.');
    expect((root.querySelector('.viewport') as HTMLElement).hidden).toBe(true);
  });

  it('renders cell markup as literal text', () => {
    update(init([['h'], ['<b>bold</b>']]));
    const cell = root.querySelector('tbody tr:not(.spacer-row) td:not(.gutter)') as HTMLElement;
    expect(cell.textContent).toBe('<b>bold</b>');
    expect(cell.querySelector('b')).toBeNull();
  });
});

describe('header toggle', () => {
  it('promotes the header row to data when unchecked', () => {
    update(init(sample));
    const toggle = root.querySelector('input[type=checkbox]') as HTMLInputElement;

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    expect(headerCells()).toEqual(['A', 'B']);
    expect(dataRows()[0]).toEqual(['name', 'qty']);
  });
});

describe('transpose', () => {
  it('swaps rows and columns, first row becoming the header', () => {
    update(init(sample));
    transposeButton().click();

    expect(headerCells()).toEqual(['name', 'Alice', 'bob', 'Carol']);
    expect(dataRows()).toEqual([['qty', '30', '9', '100']]);
  });

  it('restores the original orientation on a second click', () => {
    update(init(sample));
    transposeButton().click();
    transposeButton().click();

    expect(headerCells()).toEqual(['name', 'qty']);
    expect(dataRows()).toHaveLength(3);
  });

  it('marks the button as pressed while transposed', () => {
    update(init(sample));
    expect(transposeButton().getAttribute('aria-pressed')).toBe('false');

    transposeButton().click();
    expect(transposeButton().getAttribute('aria-pressed')).toBe('true');
    expect(transposeButton().classList.contains('active')).toBe(true);
  });

  it('updates the row and column count', () => {
    update(init(sample));
    transposeButton().click();
    expect(root.querySelector('.status')?.textContent).toBe('1 rows × 4 columns');
  });

  it('clears the sort, which belonged to the old columns', () => {
    update(init(sample));
    (root.querySelectorAll('thead th.head')[1] as HTMLElement).click();
    transposeButton().click();

    expect(root.querySelector('thead th.head .arrow')).toBeNull();
  });

  it('clears the filter, which selected the old rows', () => {
    update(init(sample));
    const filter = root.querySelector('.filter') as HTMLInputElement;
    filter.value = 'Alice';
    filter.dispatchEvent(new Event('input'));

    transposeButton().click();

    expect(filter.value).toBe('');
    expect(dataRows()).toEqual([['qty', '30', '9', '100']]);
  });

  it('copies the transposed shape', () => {
    update(init(sample));
    transposeButton().click();
    excelButton().click();

    expect(sent).toContainEqual({
      type: 'copy',
      text: 'name\tAlice\tbob\tCarol\r\nqty\t30\t9\t100',
    });
  });

  it('resets to the original orientation when new data arrives', () => {
    update(init(sample));
    transposeButton().click();
    update(init(sample));

    expect(headerCells()).toEqual(['name', 'qty']);
    expect(transposeButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('does nothing harmful on an empty table', () => {
    update(init([]));
    transposeButton().click();
    expect((root.querySelector('.empty') as HTMLElement).hidden).toBe(false);
  });
});

describe('filtering', () => {
  it('keeps only matching rows, case-insensitively', () => {
    update(init(sample));
    const filter = root.querySelector('.filter') as HTMLInputElement;

    filter.value = 'ALICE';
    filter.dispatchEvent(new Event('input'));

    expect(dataRows()).toEqual([['Alice', '30']]);
  });

  it('reports the filtered count', () => {
    update(init(sample));
    const filter = root.querySelector('.filter') as HTMLInputElement;

    filter.value = 'o';
    filter.dispatchEvent(new Event('input'));

    expect(root.querySelector('.status')?.textContent).toContain('2 of 3 rows');
  });

  it('keeps original row numbers in the gutter', () => {
    update(init(sample));
    const filter = root.querySelector('.filter') as HTMLInputElement;

    filter.value = 'Carol';
    filter.dispatchEvent(new Event('input'));

    expect(gutters()).toEqual(['3']);
  });
});

describe('sorting', () => {
  const clickHeader = (index: number) =>
    (root.querySelectorAll('thead th.head')[index] as HTMLElement).click();

  it('sorts numerically ascending on first click', () => {
    update(init(sample));
    clickHeader(1);
    expect(dataRows().map((r) => r[1])).toEqual(['9', '30', '100']);
  });

  it('sorts descending on second click', () => {
    update(init(sample));
    clickHeader(1);
    clickHeader(1);
    expect(dataRows().map((r) => r[1])).toEqual(['100', '30', '9']);
  });

  it('returns to the original order on third click', () => {
    update(init(sample));
    clickHeader(1);
    clickHeader(1);
    clickHeader(1);
    expect(dataRows().map((r) => r[1])).toEqual(['30', '9', '100']);
  });

  it('marks the sorted column', () => {
    update(init(sample));
    clickHeader(0);
    expect(root.querySelector('thead th.head .arrow')?.textContent).toBe('▲');
  });
});

describe('pagination', () => {
  const pagerButtons = () =>
    [...root.querySelectorAll('.pager-button')] as HTMLButtonElement[];
  const [first, prev, next, last] = [0, 1, 2, 3];
  const pageText = () => root.querySelector('.page')?.textContent;
  const rangeText = () => root.querySelector('.range')?.textContent;
  const firstCell = () => dataRows()[0]?.[0];

  it('shows only one page of rows', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    expect(dataRows()).toHaveLength(10);
    expect(pageText()).toBe('Page 1 / 3');
    expect(rangeText()).toBe('1–10 of 25');
  });

  it('advances to the next page', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[next].click();

    expect(firstCell()).toBe('row11');
    expect(pageText()).toBe('Page 2 / 3');
    expect(rangeText()).toBe('11–20 of 25');
  });

  it('jumps to the last page, which may be short', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[last].click();

    expect(dataRows()).toHaveLength(5);
    expect(firstCell()).toBe('row21');
    expect(rangeText()).toBe('21–25 of 25');
  });

  it('goes back with previous and first', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[last].click();
    pagerButtons()[prev].click();
    expect(pageText()).toBe('Page 2 / 3');

    pagerButtons()[first].click();
    expect(pageText()).toBe('Page 1 / 3');
    expect(firstCell()).toBe('row1');
  });

  it('disables the edge buttons at the edges', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    expect(pagerButtons()[first].disabled).toBe(true);
    expect(pagerButtons()[prev].disabled).toBe(true);
    expect(pagerButtons()[next].disabled).toBe(false);

    pagerButtons()[last].click();
    expect(pagerButtons()[next].disabled).toBe(true);
    expect(pagerButtons()[last].disabled).toBe(true);
    expect(pagerButtons()[prev].disabled).toBe(false);
  });

  it('disables every button when everything fits on one page', () => {
    update(init(sample, { pageSize: 200 }));
    expect(pagerButtons().every((b) => b.disabled)).toBe(true);
    expect(pageText()).toBe('Page 1 / 1');
  });

  it('keeps original row numbers in the gutter across pages', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[next].click();
    expect(gutters()[0]).toBe('11');
  });

  it('returns to page 1 when the filter changes', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[next].click();

    const filter = root.querySelector('.filter') as HTMLInputElement;
    filter.value = 'row2';
    filter.dispatchEvent(new Event('input'));

    expect(pageText()).toBe('Page 1 / 1');
    // row2, row20…row25 — 7 matches, all on one page.
    expect(dataRows()).toHaveLength(7);
  });

  it('returns to page 1 when sorting changes', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    pagerButtons()[next].click();
    (root.querySelectorAll('thead th.head')[1] as HTMLElement).click();

    expect(pageText()).toBe('Page 1 / 3');
    expect(firstCell()).toBe('row1');
  });

  it('sorts across all pages, not just the current one', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    // Descending by qty puts the highest value first, from the last page.
    const qty = root.querySelectorAll('thead th.head')[1] as HTMLElement;
    qty.click();
    qty.click();

    expect(firstCell()).toBe('row25');
  });

  it('shows an empty range when the filter matches nothing', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    const filter = root.querySelector('.filter') as HTMLInputElement;
    filter.value = 'nothing';
    filter.dispatchEvent(new Event('input'));

    expect(dataRows()).toHaveLength(0);
    expect(rangeText()).toBe('0–0 of 0');
    expect(pageText()).toBe('Page 1 / 1');
  });

  it('hides the footer when there is no data at all', () => {
    update(init([]));
    expect((root.querySelector('.footer') as HTMLElement).hidden).toBe(true);
  });
});

describe('host messages', () => {
  it('requests a re-parse when the delimiter changes', () => {
    update(init(sample));
    const select = root.querySelector('select') as HTMLSelectElement;

    select.value = 'pipe';
    select.dispatchEvent(new Event('change'));

    expect(sent).toContainEqual({ type: 'setDelimiter', delimiter: 'pipe' });
  });

  it('copies TSV for Excel, header first', () => {
    update(init(sample));
    excelButton().click();

    expect(sent).toContainEqual({
      type: 'copy',
      text: 'name\tqty\r\nAlice\t30\r\nbob\t9\r\nCarol\t100',
    });
  });

  it('copies a Markdown table', () => {
    update(init([['name', 'qty'], ['Alice', '30']]));
    markdownButton().click();

    expect(sent).toContainEqual({
      type: 'copy',
      text: '| name | qty |\n| --- | --- |\n| Alice | 30 |',
    });
  });

  it('copies only the filtered rows', () => {
    update(init(sample));
    const filter = root.querySelector('.filter') as HTMLInputElement;
    filter.value = 'Alice';
    filter.dispatchEvent(new Event('input'));

    excelButton().click();

    expect(sent).toContainEqual({ type: 'copy', text: 'name\tqty\r\nAlice\t30' });
  });

  it('copies every page, not just the visible one', () => {
    update(init(manyRows(25), { pageSize: 10 }));
    excelButton().click();

    const copied = sent.find((m) => m.type === 'copy') as { text: string };
    expect(copied.text.split('\r\n')).toHaveLength(26); // header + 25 rows
    expect(copied.text).toContain('row25');
  });

  it('copies in the sorted order', () => {
    update(init(sample));
    const qty = root.querySelectorAll('thead th.head')[1] as HTMLElement;
    qty.click();

    excelButton().click();

    const copied = sent.find((m) => m.type === 'copy') as { text: string };
    expect(copied.text).toBe('name\tqty\r\nbob\t9\r\nAlice\t30\r\nCarol\t100');
  });

  it('confirms on the button after copying', () => {
    update(init(sample));
    const button = excelButton();
    button.click();

    expect(button.textContent).toBe('Copied');
    expect(button.disabled).toBe(true);
  });

  it('asks the host to open settings', () => {
    update(init(sample));
    (root.querySelector('button.link') as HTMLButtonElement).click();
    expect(sent).toContainEqual({ type: 'openSettings' });
  });
});
