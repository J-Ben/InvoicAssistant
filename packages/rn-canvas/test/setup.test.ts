import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { addBabelPlugin } from '../src/cli/patch.ts';
import { proposeProviders, rootComponentFile } from '../src/server/scaffold.ts';
import { analyzeEntry, METRO_TEMPLATE, patchEntry, patchLayout, patchMetro } from '../src/server/setup.ts';
import { parse } from '../src/server/ast.ts';

const require = createRequire(import.meta.url);

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnc-setup-'));
  for (const [file, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), code);
  }
  return root;
}

// Forme courante : RN CLI migré vers Expo, React Navigation, index.js + AppRegistry, app/ = sources.
const APP = `import React from 'react';
import * as Sentry from '@sentry/react-native';
import codePush from '@revopush/react-native-code-push';
import { NavigationContainer } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalHost } from '@gorhom/portal';
import { Toaster } from './components/Toaster';
import { ThemeProvider } from 'styled-components/native';
import { theme } from './theme';
import { queryClient, persister } from './query';
import { withObserve } from './observe';
import { RootStack } from './navigation';

const App = () => {
  const toaster = React.useRef(null);
  return (
    <Sentry.ErrorBoundary>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
          <ThemeProvider theme={theme}>
            <NavigationContainer>
              <RootStack />
            </NavigationContainer>
            <PortalHost name="sheets" />
            <Toaster ref={toaster} />
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </Sentry.ErrorBoundary>
  );
};

export default Sentry.wrap(codePush({ checkFrequency: 0 })(withObserve(App)));
`;

test("point d'entrée AppRegistry : composant suivi jusqu'à son fichier, branchement tolérant", () => {
  const index = `import { AppRegistry } from 'react-native';\nimport App from './app/app';\nimport { name as appName } from './app.json';\n\nAppRegistry.registerComponent(appName, () => App);\n`;
  const root = project({ 'package.json': '{"name":"pro"}', 'index.js': index, 'app/app.tsx': APP, 'app.json': '{"name":"pro"}' });
  assert.deepEqual(analyzeEntry(root), { file: 'index.js', kind: 'AppRegistry', component: 'App', componentFile: 'app/app.tsx', componentExport: 'default', patched: false });
  assert.deepEqual(rootComponentFile(root, null), { file: 'app/app.tsx', exportName: 'default' });

  const patched = patchEntry(index, 'index.js', './rn-canvas.stories')!;
  assert.match(patched, /AppRegistry\.registerComponent\(appName, \(\) => withRnCanvas\(App\)\);/);
  assert.match(patched, /function withRnCanvas\(App\) \{/);
  assert.match(patched, /try \{\n {4}return require\('rn-canvas\/runtime'\)\.withCanvas\(App, \(\) => require\('\.\/rn-canvas\.stories'\)\.default\);/);
  assert.doesNotThrow(() => parse(patched, 'index.js'));
  // Déjà branché : rien à faire.
  assert.equal(patchEntry(patched, 'index.js', './rn-canvas.stories'), null);
});

test('point d’entrée registerRootComponent (TypeScript, guillemets doubles) et main du package.json', () => {
  const entry = `import { registerRootComponent } from "expo"\nimport { App } from "./src/App"\nregisterRootComponent(App)\n`;
  const root = project({ 'package.json': '{"main":"src/main.ts"}', 'src/main.ts': entry, 'src/src/App.tsx': 'export function App() { return null; }\n' });
  const info = analyzeEntry(root)!;
  assert.equal(info.file, 'src/main.ts');
  assert.equal(info.componentExport, 'App');
  const patched = patchEntry(entry, 'src/main.ts', '../rn-canvas.stories')!;
  assert.match(patched, /registerRootComponent\(withRnCanvas\(App\)\)/);
  assert.match(patched, /function withRnCanvas<T>\(App: T\): T \{/);
  assert.doesNotThrow(() => parse(patched, 'src/main.ts'));
});

test('mise en page expo-router branchée sans import dur de rn-canvas', () => {
  const layout = `import { Stack } from 'expo-router';\n\nexport default function RootLayout() {\n  return <Stack />;\n}\n`;
  const patched = patchLayout(layout, 'app/_layout.tsx', '../rn-canvas.stories')!;
  assert.match(patched, /^function RootLayout\(\) \{/m);
  assert.match(patched, /export default withRnCanvas\(RootLayout\);/);
  assert.ok(!/^import .*rn-canvas/m.test(patched), patched);
  assert.doesNotThrow(() => parse(patched, 'app/_layout.tsx'));
});

test('metro.config.js existant enveloppé, et sans le paquet la configuration reste la même', () => {
  const metro = `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');\nconst defaultConfig = getDefaultConfig(__dirname);\nconst config = { resolver: {} };\nmodule.exports = mergeConfig(defaultConfig, config);\n`;
  const patched = patchMetro(metro)!;
  assert.match(patched, /module\.exports = withRnCanvas\(mergeConfig\(defaultConfig, config\)\);/);
  assert.match(patched, /try \{\n {2}\(\{ withRnCanvas \} = require\('rn-canvas\/metro'\)\);\n\} catch \{\}/);
  assert.equal(patchMetro(patched), null);

  // Évaluation réelle, dans un dossier où rn-canvas n'est pas installé : export inchangé.
  const root = project({
    'metro.config.js': patched.replace("require('@react-native/metro-config')", "({ getDefaultConfig: () => ({ a: 1 }), mergeConfig: (x, y) => ({ ...x, ...y }) })"),
    'template.js': METRO_TEMPLATE.replace("require('expo/metro-config')", '({ getDefaultConfig: () => ({ b: 2 }) })'),
  });
  assert.deepEqual(require(path.join(root, 'metro.config.js')), { a: 1, resolver: {} });
  assert.deepEqual(require(path.join(root, 'template.js')), { b: 2 });
});

test('plugin Babel ignoré quand rn-canvas n’est pas installé', () => {
  const code = `module.exports = function (api) {\n  api.cache(true);\n  return {\n    presets: ['babel-preset-expo'],\n  };\n};\n`;
  const root = project({ 'babel.config.js': addBabelPlugin(code)! });
  const config = require(path.join(root, 'babel.config.js'))({ cache: () => {} });
  assert.deepEqual(config.plugins, []);
});

test('fournisseurs : HOC déballés, effets de bord écartés, cache persistant remplacé, portail gardé', () => {
  const root = project({ 'app/app.tsx': APP, 'node_modules/@tanstack/react-query/package.json': '{}' });
  const proposal = proposeProviders(root, 'app/app.tsx')!;
  assert.deepEqual(proposal.wrappers, ['SafeAreaProvider', 'QueryClientProvider', 'ThemeProvider']);
  const code = proposal.code;
  assert.ok(!code.includes('Sentry') || /écarté/.test(code), code);
  assert.ok(!/import .*Sentry/.test(code), code);
  assert.ok(code.includes("import { QueryClient, QueryClientProvider } from '@tanstack/react-query';"), code);
  assert.ok(code.includes('const canvasQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });'), code);
  assert.ok(code.includes('<QueryClientProvider client={canvasQueryClient}>'), code);
  assert.ok(!code.includes('persister'), code);
  // Thème issu d'une constante importée : repris avec son import (chemin depuis la racine).
  assert.ok(code.includes('<ThemeProvider theme={theme}>'), code);
  assert.ok(code.includes("import { theme } from './app/theme';"), code);
  // PortalHost gardé à côté de l'enfant ; Toaster piloté par une ref écarté.
  // À sa place d'origine : à côté de la navigation, dans le ThemeProvider.
  assert.match(code, /\{children\}\n\s*<PortalHost name="sheets" \/>\n\s*<\/ThemeProvider>/);
  assert.ok(!code.includes('useRef'), code);
  assert.ok(code.includes("import { PortalHost } from '@gorhom/portal';"), code);
  assert.ok(!/^\s*<Toaster/m.test(code), code);
  assert.match(proposal.todo.join('\n'), /Sentry\.ErrorBoundary> écarté/);
  assert.match(proposal.todo.join('\n'), /Toaster> écarté : piloté par une ref/);
  assert.match(proposal.todo.join('\n'), /PersistQueryClientProvider> remplacé/);
});

test('rn-canvas shim : remplacement écrit dans canvas/shims, exports des types listés, rn-canvas.json complété', async () => {
  const { writeShim } = await import('../src/server/shim.ts');
  const root = project({
    'rn-canvas.json': '{"appUrl":"http://localhost:8081"}',
    'node_modules/@acme/native-pay/package.json': '{"name":"@acme/native-pay","types":"lib/index.d.ts"}',
    'node_modules/@acme/native-pay/lib/index.d.ts': "export declare function pay(): Promise<void>;\nexport type Options = {};\nexport * from './events';\ndeclare const Pay: { init(): void };\nexport default Pay;\n",
    'node_modules/@acme/native-pay/lib/events.d.ts': 'export declare const PayEvents: { onDone(cb: () => void): void };\nexport { a as alias, type Hidden };\n',
  });
  fs.symlinkSync(path.resolve('.'), path.join(root, 'node_modules/rn-canvas'));
  const result = writeShim(root, '@acme/native-pay');
  assert.equal(result.file, 'canvas/shims/acme__native-pay.js');
  assert.deepEqual(result.exports, ['default', 'alias', 'pay', 'PayEvents']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'rn-canvas.json'), 'utf8')).shims, { '@acme/native-pay': 'canvas/shims/acme__native-pay.js' });
  const shim = require(path.join(root, result.file));
  assert.equal(typeof shim.default.init, 'function');
  shim.PayEvents.onDone(() => {});
  assert.notEqual(shim.pay(), undefined);
  // Relancé : le fichier (peut-être complété à la main) n'est pas écrasé.
  fs.writeFileSync(path.join(root, result.file), '// à la main\n');
  assert.equal(writeShim(root, '@acme/native-pay').created, false);
  assert.equal(fs.readFileSync(path.join(root, result.file), 'utf8'), '// à la main\n');
});
