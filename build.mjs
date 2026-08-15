import * as esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');
const dev = argv.includes('--dev');

const common = {
  bundle: true,
  minify: !dev,
  sourcemap: dev,
  legalComments: 'inline',
  logLevel: 'info',
};

// Extension host — runs in Node.js inside VS Code
const extensionConfig = {
  ...common,
  entryPoints: ['src/extension.ts'],
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// Webview — runs in the browser sandbox; emits dist/webview/main.js + main.css
const webviewConfig = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/webview/main.js',
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
