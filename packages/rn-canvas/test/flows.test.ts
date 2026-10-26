import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from '../src/server/ast.ts';
import { PARAM, matchRoute, navigationLinks, routesOf } from '../src/server/flows.ts';

const links = (code: string) => navigationLinks(parse(code, 'Screen.tsx'), 'Screen.tsx');

test('liens : appel direct dans un on…, fonction du fichier, Link, cible calculée ignorée', () => {
  const found = links(`
    import { router, Link } from 'expo-router';
    export default function Screen({ id, target }) {
      const handleCreate = useCallback(() => router.push('/invoice/create'), []);
      function openDetail() { router.navigate({ pathname: '/invoice/[id]', params: { id } }); }
      useEffect(() => { router.replace('/login'); }, []);
      return (
        <View>
          <Button onPress={() => router.push(\`/invoice/\${id}?mode=edit\`)} title="Modifier" />
          <TouchableOpacity onPress={handleCreate}><Text>Nouvelle facture</Text></TouchableOpacity>
          <Row onSelect={() => openDetail()} />
          <Link href="/stats">Voir les stats</Link>
          <Button onPress={() => router.push(target)} />
        </View>
      );
    }
  `);
  const summary = found.map((l) => [l.name, l.label, l.action, l.href, l.loc === null]);
  assert.deepEqual(summary, [
    [null, undefined, 'replace', '/login', true],
    ['Button', 'Modifier', 'push', `/invoice/${PARAM}?mode=edit`, false],
    ['Link', 'Voir les stats', 'link', '/stats', false],
    ['TouchableOpacity', 'Nouvelle facture', 'push', '/invoice/create', false],
    ['Row', undefined, 'navigate', '/invoice/[id]', false],
  ]);
});

test('routes expo-router : groupes, index, segments dynamiques ; correspondance la plus précise', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rnc-routes-'));
  for (const file of ['app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/budget.tsx', 'app/invoice/[id].tsx', 'app/invoice/create.tsx', 'app/+not-found.tsx']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export default () => null;');
  }
  const routes = routesOf(root, 'app');
  assert.deepEqual(routes.map((r) => r.file).sort(), ['app/(tabs)/budget.tsx', 'app/(tabs)/index.tsx', 'app/invoice/[id].tsx', 'app/invoice/create.tsx']);
  const target = (href: string) => matchRoute(href, routes)?.file ?? null;
  assert.equal(target('/'), 'app/(tabs)/index.tsx');
  assert.equal(target('/(tabs)/budget'), 'app/(tabs)/budget.tsx');
  assert.equal(target('/invoice/create'), 'app/invoice/create.tsx');
  assert.equal(target(`/invoice/${PARAM}?mode=edit`), 'app/invoice/[id].tsx');
  assert.equal(target('/invoice/[id]'), 'app/invoice/[id].tsx');
  assert.equal(target('/nope'), null);
  assert.equal(target('https://example.com'), null);
});
