# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type check (extension host + webview) then bundle both
npm run compile

# Bundle only (no type check)
npm run build

# Watch mode — use alongside the F5 debug launch
npm run watch

# Unit tests (vitest)
npm test

# Build a .vsix
npm run package

# Re-render images/icon.png from images/icon.svg (commit both)
npm run icon
```

There is no linter configured. TypeScript is `strict: true`.

## Architecture

A **VS Code extension that views CSV/TSV data as a read-only table**. It never edits or saves —
editing is the job of the separate `simple-excel-editor` extension.

Three entry points, one renderer:

1. **Selection preview** — `csvTsvViewer.previewSelection`, contributed to `editor/context` behind
   `when: editorHasSelection`. Parses the selected text (delimiter auto-detected) into a webview
   panel opened beside the editor.
2. **Clipboard preview** — `csvTsvViewer.previewClipboard`, Command Palette only; the clipboard has
   no right-clickable surface. Guarded by `looksTabular()` because the user cannot see the input
   beforehand.
3. **File view** — `csvTsvViewer.openFile`, contributed to `explorer/context` and `editor/title`
   for `.csv` / `.tsv` / `.tab`. Delimiter comes from the file extension.

Entry points 1 and 2 both go through `previewPanel.ts`: `showTextPreview` takes plain text, and
`showSelectionPreview` wraps it with the follow-the-selection subscription.

**This is a secondary viewer and must never become a default editor.** The custom editor is
registered with `priority: "option"` so the plain text editor stays the default; the table opens
only on an explicit user action. `test/contributions.test.ts` locks this down — do not change the
priority to `"default"` or add activation events that open the view automatically.

### Build

- **Extension host** (`src/`): type-checked by `tsc --noEmit` (TypeScript 7), bundled by esbuild
  into `dist/extension.js` (CJS, node18 target).
- **Webview** (`src/webview/`): type-checked against `tsconfig.webview.json` (DOM lib, no node
  types), bundled into `dist/webview/main.js` (IIFE, ES2020) plus `main.css` from the imported
  stylesheet.
- Both builds live in `build.mjs`, which takes `--watch` and `--dev`.

**TypeScript 7 is the Go-native compiler: it type-checks but performs no emit, and exposes no
transform API.** esbuild must own all emit. This is why tests run on vitest (esbuild transform)
rather than the mocha + `ts-node` setup used in `simple-excel-editor` — `ts-node` cannot work
under TS7.

### No runtime dependencies

`dependencies` is intentionally empty and should stay that way. The extension ships to the
Marketplace under MIT, so anything bundled must be permissively licensed.

- The delimited-text parser (`src/delimited.ts`) is a port of `simple-excel-editor/src/CsvUtils.ts`,
  generalized from a hardcoded comma to a delimiter parameter.
- The grid is hand-rolled in `src/webview/`, not a third-party grid library.
- Encoding uses the platform `TextDecoder` (which includes `shift_jis`).

Before adding any *runtime* dependency: MIT / ISC / BSD / Apache-2.0 only. No GPL/LGPL (viral over
a bundled `.vsix`), and no source-available or non-commercial terms — this rules out Handsontable
and SheetJS Pro. CI runs `license-checker-rseidelsohn` with an allowlist as a tripwire; it is
scoped to `--production`, so devDependencies are deliberately out of scope.

`@resvg/resvg-js` (the icon renderer) is **MPL-2.0**, which the runtime allowlist would reject. It
is fine here because it is a dev-only build tool: nothing it ships ends up in the `.vsix`, only the
PNG it renders from our own SVG. Keep it in `devDependencies`.

### Keep the .vsix minimal

The package must never carry anything the user's disk does not need. It currently sits at
**12 files / ~23 KB**: the two minified bundles, the icon, the manifest and nls files, and the
three Marketplace-facing documents (readme, changelog, license). Everything else — sources, tests,
fixtures, the icon SVG, the README screenshot, `scripts/`, `node_modules/` — is excluded by
`.vscodeignore`.

Rules that keep it that way:

- Builds are minified with no sourcemaps (`minify: !dev`, `sourcemap: dev` in `build.mjs`). Never
  ship a `--dev` build.
- README images are referenced by their `raw.githubusercontent.com` URL rather than bundled.
- Only `README.md` ships. The Marketplace renders that one file, so `README.ja.md` is excluded and
  linked from it instead. Keep the two in sync when either changes.
- After changing `.vscodeignore`, `build.mjs` or anything under `images/`, run `npm run package`
  and read the file list it prints — vsce lists every file it includes. Anything unexpected in
  that list is a bug.

### Icon

`images/icon.svg` is the source; `images/icon.png` (128×128) is what the Marketplace consumes via
the `icon` field. Edit the SVG, run `npm run icon`, and commit both. `.vscodeignore` ships the PNG
and excludes the SVG and `scripts/`.

### Layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | `activate()`, command registration, both entry points |
| `src/delimited.ts` | Parsing and delimiter detection |
| `src/encoding.ts` | BOM / UTF-8 / Shift_JIS decoding |
| `src/tableWebview.ts` | Binds a webview to a text source; owns parsing and host messages |
| `src/previewPanel.ts` | Feature A: the selection preview panel, incl. follow-selection |
| `src/CsvViewProvider.ts` | Feature B: `CustomReadonlyEditorProvider` + file watcher |
| `src/webviewHtml.ts` | CSP-locked HTML shell |
| `src/shared/protocol.ts` | Host ↔ webview message and label types |
| `src/shared/table.ts` | Pure sort/filter/measure/paging/clipboard-format helpers |
| `src/i18n.ts` | Runtime en/ja strings, keyed off `csvTsvViewer.language` |
| `src/webview/render.ts` | The table renderer; owns all view state |
| `test/` | vitest specs — node for pure modules, jsdom for `render.ts` |
| `samples/` | Fixtures for manual testing; excluded from the `.vsix` |
| `images/`, `scripts/make-icon.mjs` | Marketplace icon and its renderer |

`src/delimited.ts`, `src/encoding.ts` and `src/shared/**` have no `vscode` import by design — keep
it that way so they stay testable.

### Host ↔ webview split

The host owns file I/O and parsing; the webview owns all view state (sort, filter, header toggle,
scroll window). The host re-parses only when the delimiter changes or the file is reloaded, and
both cases go through `bindTableWebview`, which is shared by the panel and the custom editor.

Messages host → webview: `init`. Webview → host: `ready`, `setDelimiter`, `copy`, `openSettings`.

Copy is formatted in the webview and written to the clipboard by the host (`vscode.env.clipboard`)
— the webview sandbox has no reliable clipboard access. Both formats copy the full filtered/sorted
row set across all pages, not the visible page.

Paging, sorting and filtering all happen in the webview over the full row set — the host never
sends a page. `view` holds source row indices after filtering and sorting; `pageSlice` cuts the
current page out of it; the renderer then windows *that* so a large `pageSize` stays responsive.
Because indices are carried through, the gutter always shows the original file row number.

Cell values are untrusted input: the renderer writes them with `textContent`, never `innerHTML`,
and the webview runs under a nonce CSP with `default-src 'none'`.

### Three tsconfigs

`tsc` runs three times because the three source sets need different libs:

| Project | Covers | Lib |
| --- | --- | --- |
| `tsconfig.json` | `src` minus `src/webview` | ES2022 + node types |
| `tsconfig.webview.json` | `src/webview`, `src/shared` | ES2020 + DOM, no node types |
| `tsconfig.test.json` | `test` | ES2022 + DOM + node types |

Keeping DOM out of the host project is deliberate — it stops extension-host code from reaching for
browser APIs that do not exist there.

### i18n

Two layers, both needed:

- `package.nls.json` / `package.nls.ja.json` — command titles and setting descriptions, referenced
  as `%key%` from `package.json`.
- `src/i18n.ts` — runtime notifications, following the `isJa()` + `msg.*` shape from
  `simple-excel-editor/src/i18n.ts`.

### CI/CD

- `.github/workflows/ci.yml` — on PR and push to main: type check, tests, build, license check,
  `vsce package`, uploads the `.vsix` as an artifact.
- `.github/workflows/release.yml` — on a `v*` tag: packages and creates a GitHub Release with the
  `.vsix` attached.

Both run Node 24 on ubuntu-latest. Keep the actions on majors that declare `runs.using: node24`
(`checkout@v5`, `setup-node@v5`, `upload-artifact@v7`, `action-gh-release@v3`); older majors still
work but make every run emit a Node 20 deprecation annotation.

**Publishing is manual.** `npm run package` writes `csv-tsv-viewer-<version>.vsix` to the project
root and that file is uploaded to the Marketplace by hand. Do not add a `vsce publish` step or a
`VSCE_PAT` secret unless asked — CI holds no publish credentials by design.

## Plan

`PLAN.md` holds the phased implementation plan and the reasoning behind the toolchain and
licensing decisions. Keep it updated as phases land.
