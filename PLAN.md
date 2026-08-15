# CSV/TSV Viewer — Implementation Plan

VS Code extension that renders CSV/TSV as a read-only table, from two entry points:
selected text in the editor, and a file in the Explorer.

Reference projects: `simple-excel-editor` (build/CD/parser/i18n), `diagramix` (build.mjs, context-menu commands, webview CSP).

---

## 0. Identity

| | |
|---|---|
| name | `csv-tsv-viewer` |
| displayName | CSV/TSV Viewer |
| publisher | `nobuyuki-inaba` |
| repo | `https://github.com/Nobuyuki-Inaba/csv-tsv-viewer` |
| engines.vscode | `^1.85.0` |
| license | MIT |
| main | `./dist/extension.js` |

---

## 0.1 Dependencies & licensing (decided)

The extension ships to the VS Code Marketplace under MIT, so every bundled byte must be
permissively licensed and its notice must travel inside the `.vsix`.

**Decision: zero runtime dependencies.**

| Concern | Choice | License |
|---|---|---|
| Grid rendering | hand-rolled HTML table + virtual scroll (`src/webview/render.ts`) | ours, MIT |
| CSV/TSV parsing | port of `simple-excel-editor/src/CsvUtils.ts`, generalized to a `delim` parameter | ours, MIT |
| Encoding | `TextDecoder` (built into Electron/Node — includes `shift_jis`) | platform |

Consequences: `.vsix` stays ≈50 KB, `dependencies: {}` in package.json, no transitive-license
audit needed, and the webview styles against VS Code theme variables directly with no CSS
overrides to fight.

Evaluated and rejected:

- **Handsontable / SheetJS Pro — excluded on license.** Non-commercial-only terms; not
  distributable via the Marketplace under MIT.
- **Tabulator (MIT), AG Grid Community (MIT), Grid.js (MIT)** — licenses are fine, but each adds
  90 KB–1.2 MB and theme-override work for features we can write in ~300 lines. AG Grid also
  carries an Enterprise upsell surface: `ag-grid-enterprise` is commercial, so it must never be
  pulled in.
- **PapaParse (MIT), d3-dsv (ISC)** — licenses are fine; the existing parser already covers
  RFC4180 quoting, embedded newlines and CRLF, and is unit-tested.

Guardrails:

- Keep `dependencies` empty. Any future addition needs a license check first — MIT / ISC / BSD /
  Apache-2.0 only, no GPL/LGPL (viral over a bundled `.vsix`), no source-available or
  non-commercial terms.
- Keep esbuild's `--legal-comments=inline` (as in simple-excel-editor's `build:ext`) so any
  vendored notice survives bundling.
- Add a `npx license-checker --production --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0'`
  step to CI as a tripwire, even while the dependency list is empty.

---

## Phase 1 — Base: build, CI, CD

Scaffolding first, with a trivial "hello" command, so the pipeline is green before any feature lands.

### 1.1 Toolchain

| Concern | Choice | Why |
|---|---|---|
| Type check | `typescript@^7` (`tsc --noEmit`) | requested; Go-native, fast |
| Emit | esbuild only | TS7 has no transform API — esbuild must own all emit |
| Bundler entry | `build.mjs` (diagramix style) | one file builds ext + webview, `--watch` / `--dev` flags |
| Tests | `vitest@^3` | esbuild-based transform; **`ts-node`/mocha from simple-excel-editor cannot be reused under TS7** |
| Package | `@vscode/vsce@^3` | matches diagramix |
| CI node | 24 | matches simple-excel-editor release.yml |

`devDependencies`: `typescript@^7`, `esbuild@^0.25`, `vitest@^3`, `@types/vscode@^1.85.0`, `@types/node@^24`, `@vscode/vsce@^3`.
`dependencies`: **none** — parser is hand-written (ported from `simple-excel-editor/src/CsvUtils.ts`), no papaparse.

### 1.2 Repo layout

```
csv_tsv_viewer/
├─ src/
│  ├─ extension.ts            # activate(): registers 2 commands + readonly editor provider
│  ├─ delimited.ts            # parseDelimited / detectDelimiter / sniff  (pure, unit-tested)
│  ├─ CsvViewProvider.ts      # CustomReadonlyEditorProvider (Explorer path)
│  ├─ previewPanel.ts         # WebviewPanel factory (selection path)
│  ├─ webviewHtml.ts          # shared HTML shell + CSP nonce
│  ├─ i18n.ts                 # runtime en/ja strings (port of simple-excel-editor/src/i18n.ts)
│  └─ webview/
│     ├─ main.ts              # webview entry (browser/iife)
│     ├─ render.ts            # table render + virtual scroll
│     └─ table.css
├─ test/
│  ├─ delimited.test.ts
│  └─ detect.test.ts
├─ .github/workflows/{ci.yml,release.yml}
├─ .vscode/{launch.json,tasks.json}
├─ build.mjs
├─ tsconfig.json              # src + test, strict, noEmit
├─ package.json
├─ package.nls.json / package.nls.ja.json
├─ .vscodeignore  .gitignore  .gitattributes
├─ README.md  CHANGELOG.md  LICENSE  CLAUDE.md
```

### 1.3 build.mjs

Two esbuild configs, as in `diagramix/build.mjs`:

- **extension** — `src/extension.ts` → `dist/extension.js`, `platform: node`, `format: cjs`, `external: ['vscode']`, `target: node20`.
- **webview** — `src/webview/main.ts` → `dist/webview/main.js`, `platform: browser`, `format: iife`, `target: es2020`. CSS bundled to `dist/webview/main.css`.

`minify: !dev`, `sourcemap: dev`, `--watch` runs both contexts.

### 1.4 npm scripts

```jsonc
"typecheck": "tsc --noEmit",
"build":     "node build.mjs",
"dev":       "node build.mjs --dev",
"watch":     "node build.mjs --watch --dev",
"test":      "vitest run",
"compile":   "npm run typecheck && npm run build",
"package":   "npm run compile && vsce package",
"vscode:prepublish": "npm run build"
```

### 1.5 CI — `.github/workflows/ci.yml` (new; neither reference repo has one)

```yaml
on: { pull_request: , push: { branches: [main] } }
jobs.build:  ubuntu-latest, node 24, cache npm
  npm ci → npm run typecheck → npm test → npm run build → license-checker → npx vsce package
  upload-artifact: '*.vsix'   # PR reviewers can install the build
```

### 1.6 CD — `.github/workflows/release.yml` (copied from simple-excel-editor)

```yaml
on: { push: { tags: ['v*'] } }
permissions: { contents: write }
  actions/checkout@v5 → setup-node@v5 (24, cache npm)
  npm ci → npm run package
  softprops/action-gh-release@v2 with files '*.vsix', generate_release_notes: true
```
Optional follow-up: `npx vsce publish -p ${{ secrets.VSCE_PAT }}` step, gated on a repo secret.

### 1.7 Supporting config

- `.vscodeignore` — ship only `dist/**`, `package.nls*.json`, `README`, `CHANGELOG`, `LICENSE`, `images/`. Exclude `src/**`, `test/**`, `node_modules/**`, `.github/**`, `*.ts`, `tsconfig*.json`, `build.mjs`, `CLAUDE.md`, `.claude/**`.
- `.gitignore` — `node_modules/ dist/ *.vsix .claude/`.
- `.gitattributes` — `* text=auto` + LF for ts/js/css/json/md (copy verbatim).
- `.vscode/launch.json` — `extensionHost`, `--extensionDevelopmentPath=${workspaceFolder}`, `preLaunchTask: npm: compile`, `outFiles: dist/**/*.js`.

**Phase 1 exit criteria:** `npm run compile` green, `npm test` green, F5 launches a host window, CI passes on a PR, a `v0.0.1` tag produces a GitHub release with a `.vsix`.

---

## Phase 2 — Feature A: preview selected text (editor context menu)

**Flow:** select CSV/TSV text in any editor → right-click → *"CSV/TSV: Preview Selection as Table"* → webview opens `ViewColumn.Beside`.

### package.json contributions

```jsonc
"commands": [
  { "command": "csvTsvViewer.previewSelection", "title": "%command.previewSelection.title%", "icon": "$(table)" }
],
"menus": {
  "editor/context": [
    { "command": "csvTsvViewer.previewSelection", "when": "editorHasSelection", "group": "navigation@1" }
  ]
}
```
`editorHasSelection` guard is lifted from `diagramix` — the item stays hidden until text is actually selected, so it doesn't clutter the menu.

### Implementation

1. `vscode.window.activeTextEditor`; error toast if none (diagramix pattern, but via `msg.*` i18n).
2. `editor.document.getText(editor.selection)`; empty → fall back to whole document (configurable, default: fall back).
3. **Delimiter**: `csvTsvViewer.selectionDelimiter` = `auto` (default) | `comma` | `tab` | `semicolon` | `pipe`.
   `auto` = count unquoted candidates in the first ~20 lines, pick the one with the most consistent per-line count (tie → comma). Pure function in `delimited.ts`, unit-tested.
4. `parseDelimited(text, delim)` — port of `CsvUtils.parseCsv` with the `,` literal replaced by a parameter. Keeps RFC4180 quote handling: `""` escapes, embedded newlines, CRLF, trailing-empty-row trim.
5. Create panel (`previewPanel.ts`), post `{type:'render', rows, hasHeader}` on `ready`.
6. **Live re-render**: `onDidChangeTextEditorSelection` on the source editor re-posts rows while the panel is open (debounced 150 ms). Behind `csvTsvViewer.followSelection`, default `true`.

---

## Phase 3 — Feature B: open file from Explorer

**Flow:** right-click a `.csv`/`.tsv` in the Explorer → *"CSV/TSV: View as Table"* → opens as a tab.

### package.json contributions

```jsonc
"customEditors": [{
  "viewType": "csvTsvViewer.tableView",
  "displayName": "CSV/TSV Viewer",
  "selector": [{ "filenamePattern": "*.csv" }, { "filenamePattern": "*.tsv" }, { "filenamePattern": "*.tab" }],
  "priority": "option"          // ← plain text editor stays the default; never hijacks .csv
}],
"commands": [
  { "command": "csvTsvViewer.openFile", "title": "%command.openFile.title%", "icon": "$(table)" }
],
"menus": {
  "explorer/context": [
    { "command": "csvTsvViewer.openFile",
      "when": "resourceExtname =~ /\\.(csv|tsv|tab)$/i", "group": "navigation@10" }
  ],
  "editor/title": [
    { "command": "csvTsvViewer.openFile",
      "when": "resourceExtname =~ /\\.(csv|tsv|tab)$/i && activeCustomEditorId != csvTsvViewer.tableView",
      "group": "navigation" }
  ],
  "commandPalette": [
    { "command": "csvTsvViewer.openFile", "when": "resourceExtname =~ /\\.(csv|tsv|tab)$/i" }
  ]
}
```
`editor/title` icon is the simple-excel-editor `openCsvWithEditor` pattern — a one-click switch from the text tab to the table tab.

### Implementation

- `CsvViewProvider implements vscode.CustomReadonlyEditorProvider<CsvDocument>` — read-only, so no `onDidChangeCustomDocument` / save plumbing (much smaller than `ExcelEditorProvider`'s 695 lines).
- `openCustomDocument`: `vscode.workspace.fs.readFile`, decode, parse. Delimiter from extension (`.tsv`/`.tab` → tab, `.csv` → comma), overridable per-tab from the webview toolbar.
- Encoding: `csvTsvViewer.encoding` = `auto` | `utf8` | `shift_jis`. `auto` = UTF-8 BOM → UTF-8; otherwise UTF-8 decode with fatal check, fall back to Shift_JIS via `TextDecoder('shift_jis')` (built into Node/Electron, no dep).
- Command handler signature `(uri?: vscode.Uri, uris?: vscode.Uri[])` — handles Explorer multi-select (open each), falls back to `activeTextEditor.document.uri`, then delegates to `vscode.commands.executeCommand('vscode.openWith', uri, 'csvTsvViewer.tableView')`.
- `onDidChangeTextDocument` / a `FileSystemWatcher` reloads the tab when the file changes on disk.

---

## Phase 4 — Webview (shared by both features)

One bundle serves both entry points; the only difference is the message source.

- **HTML shell** (`webviewHtml.ts`): strict CSP with nonce, exactly as diagramix — `default-src 'none'; script-src 'nonce-…'; style-src ${cspSource}; font-src ${cspSource}`. `localResourceRoots` limited to `dist/webview`.
- **Theming**: VS Code CSS variables (`--vscode-editor-background`, `--vscode-list-hoverBackground`, `--vscode-panel-border`), *not* diagramix's hardcoded white — a viewer lives in the editor area and must follow the theme.
- **Table**: sticky header row, sticky row-number gutter, zebra rows, monospace, per-column resize.
- **Virtual scroll**: render a windowed slice; target 100k+ rows without freezing. Parsed rows stay in the webview; the host is stateless after `init` (the host↔webview split simple-excel-editor uses).
- **Toolbar**: header-row toggle, delimiter switch, row/column count, filter box, "Copy as TSV/Markdown", open-settings link.
- **Sort** by clicking a header (string / numeric / date auto-detect, tri-state asc→desc→original).
- **Ragged rows**: pad short rows, flag over-long rows with a warning badge rather than silently truncating.
- Messages host→webview: `init`, `render`, `error`. Webview→host: `ready`, `openSettings`, `copy`.

---

## Phase 5 — Config, i18n, docs

### Settings (`csvTsvViewer.*`)

| Key | Type | Default | Note |
|---|---|---|---|
| `selectionDelimiter` | enum auto/comma/tab/semicolon/pipe | `auto` | Feature A |
| `hasHeader` | boolean | `true` | first row as header |
| `encoding` | enum auto/utf8/shift_jis | `auto` | Feature B |
| `maxRows` | number | `100000` | hard cap, warn + truncate above |
| `followSelection` | boolean | `true` | live re-render on selection change |
| `language` | enum auto/en/ja | `auto` | mirrors simple-excel-editor |

### i18n

`package.nls.json` + `package.nls.ja.json` for command titles and setting descriptions (`%key%` refs); `src/i18n.ts` for runtime strings, the `isJa()` + `msg.*` shape from `simple-excel-editor/src/i18n.ts`, honoring `csvTsvViewer.language`.

### Tests (vitest, pure functions only — no VS Code host tests)

- `parseDelimited`: quoted fields, `""` escapes, embedded delimiter/newline, CRLF vs LF, trailing newline, ragged rows, empty input, tab delimiter.
- `detectDelimiter`: comma/tab/semicolon/pipe samples, quoted-delimiter decoys, single-column input, ambiguous → comma.
- encoding sniff: BOM, valid UTF-8, Shift_JIS bytes.

### Docs

`README.md` (both features w/ screenshots, settings table, install), `CHANGELOG.md` (Keep a Changelog), `CLAUDE.md` (commands + architecture, modeled on the reference repos), `LICENSE` (MIT).

---

## Order of work

1. ~~**P1** scaffold + CI + CD green~~ — **done**. `delimited.ts` and its tests landed here rather
   than in P2, so `npm test` was meaningful from the start.
2. ~~**P2** selection preview end-to-end~~ — **done**, including follow-selection.
3. ~~**P3** Explorer / custom-editor path~~ — **done**, incl. encoding detection and disk-change
   reload.
4. ~~**P4** webview: paging, sort, filter~~ — **done**. Two changes from the original plan, both at
   the user's request: display is **paged** (`pageSize`, default 200, matching simple-excel-editor)
   rather than one long scroll, and **copy-as-TSV was dropped**. Windowed rendering was kept
   *inside* each page so a large `pageSize` stays responsive. Column *resize* is not implemented;
   widths are auto-measured from content instead.
5. ~~**P5** config, i18n, docs, Marketplace icon, README screenshot~~ — **done**. Verified by hand
   in the Extension Development Host (Explorer context menu → table view, toolbar, both copy
   actions).

The extension ships as **v0.0.1**; it does not track the version numbers of the reference
projects.

### Not built

- **Column resize by dragging.** Widths are measured from a 200-row sample and clamped to 60
  characters; drag-to-resize would be additive.
- **CSV clipboard export.** Only TSV (for Excel) and Markdown are offered.
- **Streaming for files larger than memory.** `maxRows` truncates instead.

## Decisions worth confirming before I start

1. **Read-only.** "Viewer" is taken literally — no cell editing, no save. Editing is `simple-excel-editor`'s job.
2. **`priority: "option"`** on the custom editor — `.csv` keeps opening in the text editor by default; the table is opt-in per the right-click menu. (`"default"` would hijack every `.csv` in the workspace.)
3. ~~No runtime dependencies~~ — **confirmed**: hand-rolled grid + ported parser, no third-party
   view or parse library. See §0.1.
4. **vitest replaces mocha/ts-node**, forced by TypeScript 7's lack of a transform API.
