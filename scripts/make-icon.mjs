/**
 * Render images/icon.svg to the 128x128 PNG the Marketplace requires.
 *
 * Run with `npm run icon` after editing the SVG, and commit both files —
 * packaging reads the PNG, not the SVG.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'images', 'icon.svg'), 'utf8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 128 },
  font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();

writeFileSync(join(root, 'images', 'icon.png'), png);
console.log(`images/icon.png written (${png.length} bytes)`);
