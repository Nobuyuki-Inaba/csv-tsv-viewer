# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.1]

### Added

- Project scaffold: esbuild build (`build.mjs`), TypeScript 7 type checking, vitest unit tests,
  GitHub Actions CI and tag-triggered release.
- RFC 4180 delimited-text parser with delimiter auto-detection (comma, tab, semicolon, pipe).
- `CSV/TSV: Preview Selection as Table` — editor right-click menu, shown when text is selected.
- `CSV/TSV: View as Table` — Explorer right-click menu for `.csv` / `.tsv` / `.tab` files,
  plus an editor-title button.
- Table webview shared by both entry points: paged display with first/previous/next/last controls,
  sticky header and row-number gutter, click-to-sort (numeric aware, blanks last), filter box, and
  delimiter switching. Sorting and filtering span the whole file, not the current page.
- Copy for Excel (tab-separated) and Copy as Markdown, both covering every filtered row across all
  pages.
- Read-only custom editor (`priority: "option"`) with reload on external file change.
- Encoding detection: BOM, then strict UTF-8, falling back to Shift_JIS.
- Settings: `selectionDelimiter`, `hasHeader`, `pageSize`, `encoding`, `followSelection`,
  `maxRows`, `language`.
- English and Japanese UI strings.
- Marketplace icon, rendered from `images/icon.svg` by `npm run icon`.
