import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DELIMITERS } from '../src/delimited';

const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));

const pkg = read('package.json') as {
  activationEvents: string[];
  contributes: {
    customEditors: { viewType: string; priority?: string; selector: unknown[] }[];
    commands: { command: string; title: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
    configuration: { properties: Record<string, { description: string; enum?: string[] }> };
  };
};

/**
 * This extension is a secondary viewer: it must never take over as the default
 * editor for a file type. Only an explicit user action — the right-click
 * command or "Reopen Editor With…" — may open it.
 */
describe('the viewer never becomes a default editor', () => {
  it('registers every custom editor with priority "option"', () => {
    expect(pkg.contributes.customEditors.length).toBeGreaterThan(0);
    for (const editor of pkg.contributes.customEditors) {
      expect(editor.priority).toBe('option');
    }
  });

  it('never uses priority "default"', () => {
    const priorities = pkg.contributes.customEditors.map((e) => e.priority);
    expect(priorities).not.toContain('default');
  });

  it('declares no automatic activation events', () => {
    // Activation is driven by the contributed command and view type alone.
    expect(pkg.activationEvents).toEqual([]);
  });

  it('exposes the file view only behind an explicit user action', () => {
    const entries = Object.entries(pkg.contributes.menus).flatMap(([location, items]) =>
      items.map((item) => ({ location, ...item }))
    );
    const openFile = entries.filter((e) => e.command === 'csvTsvViewer.openFile');

    expect(openFile.map((e) => e.location).sort()).toEqual([
      'commandPalette',
      'editor/title',
      'explorer/context',
    ]);

    // Every surface is gated on the resource actually being CSV/TSV.
    for (const entry of openFile) {
      expect(entry.when).toMatch(/resourceExtname/);
    }
  });

  it('exposes the clipboard preview through the Command Palette only', () => {
    const locations = Object.entries(pkg.contributes.menus)
      .filter(([, items]) => items.some((i) => i.command === 'csvTsvViewer.previewClipboard'))
      .map(([location]) => location);

    // No context menu fits the clipboard, and adding one would be clutter.
    expect(locations).toEqual(['commandPalette']);
  });

  it('shows the selection preview only when text is selected', () => {
    const entries = Object.entries(pkg.contributes.menus).flatMap(([, items]) => items);
    const preview = entries.filter((e) => e.command === 'csvTsvViewer.previewSelection');

    expect(preview.length).toBeGreaterThan(0);
    for (const entry of preview) {
      expect(entry.when).toContain('editorHasSelection');
    }
  });
});

describe('manifest consistency', () => {
  it('backs every menu item with a declared command', () => {
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const items of Object.values(pkg.contributes.menus)) {
      for (const item of items) {
        expect(declared).toContain(item.command);
      }
    }
  });

  it('offers every supported delimiter in the settings enum', () => {
    // The setting and the parser must agree, or a configured value silently
    // falls through to the default.
    const setting = pkg.contributes.configuration.properties['csvTsvViewer.selectionDelimiter'];
    expect(setting.enum).toEqual(['auto', ...Object.keys(DELIMITERS)]);
  });

  it('resolves every %nls% placeholder in both languages', () => {
    const en = read('package.nls.json');
    const ja = read('package.nls.ja.json');

    const placeholders = [
      ...pkg.contributes.commands.map((c) => c.title),
      ...Object.values(pkg.contributes.configuration.properties).map((p) => p.description),
    ];

    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/^%.+%$/);
      const key = placeholder.slice(1, -1);
      expect(en, `missing in package.nls.json: ${key}`).toHaveProperty(key);
      expect(ja, `missing in package.nls.ja.json: ${key}`).toHaveProperty(key);
    }
  });
});
