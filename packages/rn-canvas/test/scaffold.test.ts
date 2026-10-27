import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { proposeProviders, rootLayoutFile } from '../src/server/scaffold.ts';

const require = createRequire(import.meta.url);

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnc-scaffold-'));
  for (const [file, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), code);
  }
  return root;
}

test('fournisseurs du layout : chaîne jusqu’à la navigation, attente des polices, props calculées signalées', () => {
  const root = project({
    'node_modules/expo-font/package.json': '{}',
    'node_modules/@tanstack/react-query/package.json': '{}',
    'app/_layout.tsx': `import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../src/theme';
import { useSession } from '../src/auth';
import { Splash } from '../src/Splash';

const queryClient = new QueryClient();

function Inner() {
  return <Stack />;
}

export default function RootLayout() {
  const [loaded] = useFonts({ Inter: require('../assets/Inter.ttf') });
  const session = useSession();
  if (!loaded) return null;
  if (!session.ready) return <Splash />;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider mode="light" user={session.user}>
        <StatusBar style="auto" />
        <Inner />
      </ThemeProvider>
      {session.loading && <Splash />}
    </QueryClientProvider>
  );
}
`,
  });
  assert.equal(rootLayoutFile(root, 'app'), 'app/_layout.tsx');
  const proposal = proposeProviders(root, 'app/_layout.tsx')!;
  assert.deepEqual(proposal.wrappers, ['QueryClientProvider', 'ThemeProvider']);
  const code = proposal.code;
  assert.ok(code.includes(`import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`), code);
  assert.ok(code.includes(`import { ThemeProvider } from './src/theme';`), code);
  assert.ok(code.includes('const queryClient = new QueryClient();'));
  // Chemin relatif recalculé depuis la racine (où est rn-canvas.config.tsx).
  assert.ok(code.includes(`const [loaded] = useFonts({ Inter: require('./assets/Inter.ttf') });`), code);
  assert.ok(code.includes('if (!loaded) return null;'), code);
  // Variable du layout utilisée par une prop : son hook est repris (il s'exécutait déjà au-dessus des fournisseurs).
  assert.ok(code.includes('const session = useSession();'), code);
  assert.ok(code.includes(`import { useSession } from './src/auth';`), code);
  assert.ok(code.includes('<ThemeProvider mode="light" user={session.user}>'), code);
  assert.ok(!code.includes('StatusBar') && !code.includes('Splash') && !code.includes('Stack'), code);
  // La condition propre à l'app (session prête) n'est pas reprise : elle masquerait les écrans.
  assert.ok(!code.includes('if (!session.ready)'), code);
  // Composant local qui enveloppe la navigation : non repris, mais signalé.
  assert.equal(proposal.todo.length, 2);
  assert.match(proposal.todo[0], /<Inner> écarté : composant local/);
  assert.match(proposal.todo[1], /session\.ready/);
});

test('fournisseurs : App.tsx sans expo-router, arrêt sur NavigationContainer', () => {
  const root = project({
    'App.tsx': `import { NavigationContainer } from '@react-navigation/native';
import { Provider } from 'react-redux';
import { store } from './src/store';
const App = () => (
  <Provider store={store}>
    <NavigationContainer><Stack.Navigator /></NavigationContainer>
  </Provider>
);
export default App;
`,
  });
  assert.equal(rootLayoutFile(root, null), 'App.tsx');
  // Corps en expression (pas de return) : le JSX renvoyé directement.
  assert.deepEqual(proposeProviders(root, 'App.tsx')!.wrappers, ['Provider']);
  fs.writeFileSync(path.join(root, 'App.tsx'), fs.readFileSync(path.join(root, 'App.tsx'), 'utf8').replace('const App = () => (', 'function App() {\n  return (').replace(');\nexport default', ');\n}\nexport default'));
  const proposal = proposeProviders(root, 'App.tsx')!;
  assert.deepEqual(proposal.wrappers, ['Provider']);
  assert.ok(proposal.code.includes(`import { store } from './src/store';`));
  assert.ok(proposal.code.includes('<Provider store={store}>'));
});

test('exemples tirés des types : classes du projet, unions, tableaux, rappels, noms parlants', async () => {
  const { generateExamples } = await import('../src/server/examples.ts');
  const root = project({
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, jsx: 'react-jsx', baseUrl: '.', paths: { '@domain/*': ['src/domain/*'] } } }),
    'src/domain/Invoice.ts': `export type Category = 'food' | 'transport';
export class Invoice {
  constructor(readonly props: { id: string; title: string; amount: number; category: Category; date: Date; photos: string[]; note?: string }) {}
}
`,
    'src/components/InvoiceCard.tsx': `import { Invoice } from '@domain/Invoice';
interface Project { id: string; name: string; targetAmount: number }
export function InvoiceCard(props: { invoices: Invoice[]; project: Project; onPress: () => void; visible?: boolean; subtitle?: string; currency: string; totalAmount: string; summary: string }) { return null; }
`,
  });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(root, 'node_modules/typescript'));
  const result = generateExamples(root, [{ file: 'src/components/InvoiceCard.tsx', name: 'InvoiceCard' }], (file) => `../${file.replace(/\.tsx?$/, '')}`)!;
  assert.deepEqual(result.components, ['InvoiceCard']);
  const code = result.code;
  assert.ok(code.includes(`import { Invoice } from '../src/domain/Invoice';`), code);
  assert.ok(code.includes('new Invoice({'), code);
  assert.match(code, /category: 'food'/);
  assert.match(code, /category: 'transport'/);
  assert.match(code, /photos: \[\]/);
  assert.match(code, /date: new Date\('\d{4}-\d{2}-\d{2}'\)/);
  assert.match(code, /name: 'Vacances en Grèce'/);
  assert.match(code, /onPress: noop/);
  // Prop facultative d'ouverture : pas dans l'exemple (une modale n'y est jamais ouverte).
  assert.ok(!/visible:/.test(code), code);
  assert.match(code, /currency: 'EUR'/);
  assert.match(code, /totalAmount: '1 250,00 €'/);
  assert.match(code, /summary: 'Texte d’exemple'|summary: 'Exemple'/);
  assert.ok(!code.includes('subtitle') && !code.includes('note:'), code);
});
