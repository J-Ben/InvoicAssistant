import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnose } from '../src/cli/doctor.ts';

function write(root: string, file: string, content: string | object) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
}

function project(pkg: object, files: Record<string, string | object> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-doctor-'));
  write(root, 'package.json', pkg);
  write(root, 'node_modules/expo/package.json', { version: '58.0.19' });
  write(root, 'node_modules/expo/bundledNativeModules.json', { 'react-dom': '19.3.0', 'react-native-web': '~0.21.4', '@expo/metro-runtime': '~58.0.15' });
  for (const [f, c] of Object.entries(files)) write(root, f, c);
  return root;
}

const find = (checks: ReturnType<typeof diagnose>, re: RegExp) => checks.find((c) => re.test(c.title));

test('projet sans Expo : refusé avec explication', () => {
  const root = project({ dependencies: { 'react-native': '0.88.0' } });
  const checks = diagnose(root);
  assert.equal(find(checks, /sans Expo/)?.level, 'error');
});

test('projet Expo à brancher : chaque problème avec sa correction', () => {
  const root = project(
    {
      dependencies: { expo: '~58.0.19', 'expo-router': '~58.0.26', react: '19.3.0', 'react-dom': '19.3.0', 'react-native-web': '~0.21.0', 'expo-notifications': '~58.1.6', 'native-lib': '1.0.0', 'pure-js': '1.0.0', 'web-ready': '1.0.0', 'never-imported': '1.0.0', nativewind: '^4.0.0' },
    },
    {
      'babel.config.js': "module.exports = { presets: ['babel-preset-expo'] };",
      'app/_layout.tsx': 'export default function RootLayout() { return null; }',
      'app/Home.canvas.tsx': 'export const A = {};',
      'src/uses.ts': "import * as N from 'expo-notifications';\nimport x from 'native-lib';\nconst w = require('web-ready');\nimport 'pure-js';",
      'rn-canvas.json': { include: ['app'] },
      'node_modules/expo-notifications/package.json': { name: 'expo-notifications' },
      'node_modules/expo-notifications/android/build.gradle': '',
      'node_modules/native-lib/package.json': { name: 'native-lib' },
      'node_modules/native-lib/ios/Lib.m': '',
      'node_modules/pure-js/package.json': { name: 'pure-js' },
      'node_modules/web-ready/package.json': { name: 'web-ready' },
      'node_modules/never-imported/package.json': { name: 'never-imported' },
      'node_modules/never-imported/ios/X.m': '',
      'node_modules/web-ready/android/x': '',
      'node_modules/web-ready/lib/index.web.js': '',
    },
  );
  const checks = diagnose(root);
  assert.equal(find(checks, /Support web absent : @expo\/metro-runtime/)?.fix, 'npx expo install @expo/metro-runtime');
  assert.equal(find(checks, /ne charge pas le plugin/)?.level, 'error');
  assert.equal(find(checks, /Pas de metro.config.js/)?.level, 'warn');
  assert.equal(find(checks, /app\/_layout.tsx n'est pas branché/)?.level, 'error');
  assert.equal(find(checks, /Fichiers canvas dans app\//)?.level, 'error');
  assert.match(find(checks, /Remplacés dans le canevas/)?.title ?? '', /expo-notifications/);
  assert.equal(find(checks, /^native-lib : module natif sans version web/)?.level, 'warn');
  assert.ok(!find(checks, /^web-ready/), 'un module natif avec .web.js passe');
  assert.ok(!find(checks, /^pure-js/), 'un module JavaScript pur passe');
  assert.ok(!find(checks, /never-imported/), 'un module natif jamais importé est ignoré');
  assert.equal(find(checks, /NativeWind/)?.level, 'warn');
});

test('projet branché : tout est vert', () => {
  const root = project(
    { main: 'index.ts', dependencies: { expo: '~58.0.19', react: '19.3.0', 'react-dom': '19.3.0', 'react-native-web': '~0.21.4', '@expo/metro-runtime': '~58.0.15' }, devDependencies: { 'babel-preset-expo': '~58.0.20' } },
    {
      'index.ts': "import { withCanvas } from 'rn-canvas/runtime';",
      'babel.config.js': "module.exports = { plugins: ['rn-canvas/babel'] };",
      'metro.config.js': "const { withRnCanvas } = require('rn-canvas/metro');",
      'rn-canvas.json': {},
      'src/A.canvas.tsx': 'export const A = {};',
      'rn-canvas.stories.ts': '',
    },
  );
  const checks = diagnose(root);
  assert.deepEqual(checks.filter((c) => c.level !== 'ok').map((c) => c.title), []);
});
