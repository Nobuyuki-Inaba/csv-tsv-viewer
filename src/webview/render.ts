import { generateColumnNames } from '../delimited';
import {
  format,
  type DelimiterName,
  type InitMessage,
  type WebviewLabels,
  type WebviewToHost,
} from '../shared/protocol';
import {
  clampPage,
  computeColumnWidths,
  filterIndices,
  pageCount,
  pageSlice,
  sortIndices,
  toMarkdown,
  toTsv,
  transpose,
  type SortDirection,
} from '../shared/table';

const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const DELIMITER_NAMES: DelimiterName[] = ['comma', 'tab', 'semicolon', 'pipe', 'space'];

export interface HostApi {
  postMessage(message: WebviewToHost): void;
}

interface Sort {
  col: number;
  dir: SortDirection;
}

/**
 * Build the table UI and return an update function the host calls with fresh
 * data. All view state (sort, filter, header toggle, current page) lives here;
 * the host is only asked to re-parse when the delimiter changes.
 */
export function mount(root: HTMLElement, api: HostApi): (data: InitMessage) => void {
  let labels: WebviewLabels;
  /** Rows exactly as the host parsed them; `allRows` is the transposed view of these. */
  let sourceRows: string[][] = [];
  let allRows: string[][] = [];
  let body: string[][] = [];
  let header: string[] = [];
  let hasHeader = true;
  let transposed = false;
  let truncated = false;
  let maxRows = 0;
  let pageSize = 200;
  let page = 0;
  let sort: Sort | null = null;
  let filter = '';
  let view: number[] = [];
  let widths: number[] = [];

  // ── Skeleton ────────────────────────────────────────────────────────────────

  root.textContent = '';

  const toolbar = el('div', 'toolbar');
  const delimiterLabel = el('label', 'field');
  const delimiterText = document.createElement('span');
  const delimiterSelect = document.createElement('select');
  const headerLabel = el('label', 'field');
  const headerText = document.createElement('span');
  const headerToggle = document.createElement('input');
  headerToggle.type = 'checkbox';
  const transposeButton = document.createElement('button');
  transposeButton.className = 'toggle';
  const filterInput = document.createElement('input');
  filterInput.type = 'search';
  filterInput.className = 'filter';
  const excelButton = document.createElement('button');
  const markdownButton = document.createElement('button');
  const settingsButton = document.createElement('button');
  settingsButton.className = 'link';

  delimiterLabel.append(delimiterText, delimiterSelect);
  headerLabel.append(headerToggle, headerText);
  toolbar.append(
    delimiterLabel,
    headerLabel,
    transposeButton,
    filterInput,
    excelButton,
    markdownButton,
    el('span', 'spacer'),
    settingsButton
  );

  const viewport = el('div', 'viewport');
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(colgroup, thead, tbody);
  viewport.append(table);

  const empty = el('div', 'empty');
  empty.hidden = true;

  const footer = el('div', 'footer');
  const pager = el('div', 'pager');
  const firstButton = pagerButton('«');
  const prevButton = pagerButton('‹');
  const pageText = el('span', 'page');
  const nextButton = pagerButton('›');
  const lastButton = pagerButton('»');
  const range = el('span', 'range');
  const status = el('span', 'status');

  pager.append(firstButton, prevButton, pageText, nextButton, lastButton);
  footer.append(pager, range, el('span', 'spacer'), status);

  root.append(toolbar, viewport, empty, footer);

  const charWidth = measureCharWidth(table);

  // ── Events ──────────────────────────────────────────────────────────────────

  delimiterSelect.addEventListener('change', () => {
    api.postMessage({ type: 'setDelimiter', delimiter: delimiterSelect.value as DelimiterName });
  });

  headerToggle.addEventListener('change', () => {
    hasHeader = headerToggle.checked;
    sort = null;
    reshape();
  });

  // Rows and columns trade places, so neither the sort (an ordering of the old
  // columns) nor the filter (a selection of the old rows) still means anything.
  // Both reset, exactly as they do when fresh data arrives.
  transposeButton.addEventListener('click', () => {
    transposed = !transposed;
    sort = null;
    filter = '';
    filterInput.value = '';
    page = 0;
    renderTransposeField();
    reshape();
  });

  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    recomputeView();
    goToPage(0);
  });

  firstButton.addEventListener('click', () => goToPage(0));
  prevButton.addEventListener('click', () => goToPage(page - 1));
  nextButton.addEventListener('click', () => goToPage(page + 1));
  lastButton.addEventListener('click', () => goToPage(pageCount(view.length, pageSize) - 1));

  excelButton.addEventListener('click', () => {
    copy(toTsv([header, ...visibleRows()]), excelButton);
  });

  markdownButton.addEventListener('click', () => {
    copy(toMarkdown(header, visibleRows()), markdownButton);
  });

  settingsButton.addEventListener('click', () => api.postMessage({ type: 'openSettings' }));

  viewport.addEventListener('scroll', renderWindow, { passive: true });
  window.addEventListener('resize', renderWindow);

  // ── Update ──────────────────────────────────────────────────────────────────

  return function update(data: InitMessage): void {
    labels = data.labels;
    sourceRows = data.rows;
    hasHeader = data.hasHeader;
    transposed = false;
    truncated = data.truncated;
    maxRows = data.maxRows;
    pageSize = data.pageSize;
    sort = null;
    filter = '';
    page = 0;

    filterInput.value = '';
    filterInput.placeholder = labels.filterPlaceholder;
    excelButton.textContent = labels.copyExcel;
    excelButton.title = labels.copyExcelTitle;
    markdownButton.textContent = labels.copyMarkdown;
    markdownButton.title = labels.copyMarkdownTitle;
    settingsButton.textContent = labels.settings;
    empty.textContent = labels.empty;
    firstButton.title = labels.firstPage;
    prevButton.title = labels.previousPage;
    nextButton.title = labels.nextPage;
    lastButton.title = labels.lastPage;

    renderDelimiterField(data.delimiter);
    renderHeaderField();
    renderTransposeField();
    reshape();
  };

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** Recompute everything that depends on the header toggle, transpose or new data. */
  function reshape(): void {
    allRows = transposed ? transpose(sourceRows) : sourceRows;

    const isEmpty = allRows.length === 0;
    viewport.hidden = isEmpty;
    empty.hidden = !isEmpty;
    footer.hidden = isEmpty;

    if (isEmpty) {
      body = [];
      header = [];
      view = [];
      return;
    }

    body = hasHeader ? allRows.slice(1) : allRows;
    const columnCount = allRows[0].length;
    header = hasHeader ? allRows[0] : generateColumnNames(columnCount);
    widths = computeColumnWidths(header, body);

    renderColgroup();
    renderHead();
    recomputeView();
    goToPage(page);
  }

  function recomputeView(): void {
    view = filterIndices(body, filter);
    if (sort) view = sortIndices(body, view, sort.col, sort.dir);
  }

  /**
   * Every row the current filter and sort produce — across all pages, not just
   * the visible one. Copying only the open page would silently drop rows.
   */
  function visibleRows(): string[][] {
    return view.map((i) => body[i]);
  }

  function copy(text: string, button: HTMLButtonElement): void {
    api.postMessage({ type: 'copy', text });

    const original = button.textContent;
    button.textContent = labels.copied;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }

  function goToPage(next: number): void {
    page = clampPage(next, view.length, pageSize);
    viewport.scrollTop = 0;
    renderWindow();
    renderPager();
    renderStatus();
  }

  function renderDelimiterField(current: DelimiterName): void {
    delimiterText.textContent = labels.delimiter;
    delimiterSelect.textContent = '';

    for (const name of DELIMITER_NAMES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = labels[name];
      option.selected = name === current;
      delimiterSelect.append(option);
    }
  }

  function renderHeaderField(): void {
    headerToggle.checked = hasHeader;
    headerText.textContent = labels.headerRow;
  }

  function renderTransposeField(): void {
    transposeButton.textContent = labels.transpose;
    transposeButton.title = labels.transposeTitle;
    transposeButton.setAttribute('aria-pressed', String(transposed));
    transposeButton.classList.toggle('active', transposed);
  }

  function renderColgroup(): void {
    colgroup.textContent = '';

    const gutter = document.createElement('col');
    gutter.style.width = `${String(body.length).length * charWidth + 24}px`;
    colgroup.append(gutter);

    for (const width of widths) {
      const col = document.createElement('col');
      col.style.width = `${width * charWidth + 16}px`;
      colgroup.append(col);
    }
  }

  function renderHead(): void {
    thead.textContent = '';

    const row = document.createElement('tr');
    row.append(el('th', 'gutter corner'));

    header.forEach((name, col) => {
      const cell = el('th', 'head');
      cell.append(document.createTextNode(name));

      if (sort?.col === col) {
        const arrow = el('span', 'arrow');
        arrow.textContent = sort.dir === 'asc' ? '▲' : '▼';
        cell.append(arrow);
      }

      cell.addEventListener('click', () => toggleSort(col));
      row.append(cell);
    });

    thead.append(row);
  }

  /** asc → desc → unsorted. Sorting applies across all pages, not just this one. */
  function toggleSort(col: number): void {
    if (sort?.col !== col) {
      sort = { col, dir: 'asc' };
    } else if (sort.dir === 'asc') {
      sort = { col, dir: 'desc' };
    } else {
      sort = null;
    }

    renderHead();
    recomputeView();
    goToPage(0);
  }

  /**
   * Render the current page, windowed to the rows near the viewport so a large
   * `pageSize` stays responsive.
   */
  function renderWindow(): void {
    const rows = pageSlice(view, page, pageSize);
    const total = rows.length;
    const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewport.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(total, start + visible);
    const columns = header.length + 1;

    const fragment = document.createDocumentFragment();
    fragment.append(spacerRow(start * ROW_HEIGHT, columns));

    for (let i = start; i < end; i++) {
      const index = rows[i];
      const tr = document.createElement('tr');

      const gutter = el('td', 'gutter');
      gutter.textContent = String(index + 1);
      tr.append(gutter);

      for (let col = 0; col < header.length; col++) {
        const cell = document.createElement('td');
        // textContent, never innerHTML — cell values are untrusted input.
        cell.textContent = body[index]?.[col] ?? '';
        tr.append(cell);
      }

      fragment.append(tr);
    }

    fragment.append(spacerRow((total - end) * ROW_HEIGHT, columns));

    tbody.textContent = '';
    tbody.append(fragment);
  }

  function renderPager(): void {
    const pages = pageCount(view.length, pageSize);
    pageText.textContent = format(labels.page, page + 1, pages);

    const atFirst = page === 0;
    const atLast = page >= pages - 1;
    firstButton.disabled = atFirst;
    prevButton.disabled = atFirst;
    nextButton.disabled = atLast;
    lastButton.disabled = atLast;

    if (view.length === 0) {
      range.textContent = format(labels.rowsRange, 0, 0, 0);
      return;
    }

    const from = page * pageSize + 1;
    const to = Math.min(view.length, (page + 1) * pageSize);
    range.textContent = format(labels.rowsRange, from, to, view.length);
  }

  function renderStatus(): void {
    const parts = [format(labels.rowsColumns, body.length, header.length)];

    if (filter.trim() !== '') {
      parts.push(format(labels.filtered, view.length, body.length));
    }
    if (truncated) {
      parts.push(format(labels.truncated, maxRows));
    }

    status.textContent = parts.join(' · ');
    status.classList.toggle('warn', truncated);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function pagerButton(glyph: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'pager-button';
  button.textContent = glyph;
  return button;
}

function spacerRow(height: number, columns: number): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'spacer-row';
  const cell = document.createElement('td');
  cell.colSpan = columns;
  cell.style.height = `${height}px`;
  row.append(cell);
  return row;
}

/** Width of one character in the table font, used to size the columns. */
function measureCharWidth(reference: HTMLElement): number {
  const probe = document.createElement('span');
  probe.textContent = '0'.repeat(20);
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  reference.append(probe);
  const width = probe.getBoundingClientRect().width / 20;
  probe.remove();
  return width || 8;
}
