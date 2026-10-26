// Construit le CLI/serveur (Node) et l'éditeur (navigateur) dans dist/.
import { build, context } from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/editor', { recursive: true });
fs.copyFileSync('src/editor/index.html', 'dist/editor/index.html');

const node = {
  entryPoints: { cli: 'src/cli/index.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};

const editor = {
  entryPoints: { editor: 'src/editor/main.tsx' },
  outdir: 'dist/editor',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: true,
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

if (watch) {
  for (const options of [node, editor]) await (await context(options)).watch();
} else {
  await Promise.all([build(node), build(editor)]);
}
