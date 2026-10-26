import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createShim } = require('../shims/_shim.js');
const { withRnCanvas } = require('../metro.cjs');

test('remplacement générique : valeurs neutres déduites du nom', async () => {
  const shim = createShim('demo', null, {});
  assert.deepEqual(await shim.getPermissionsAsync(), { status: 'denied', granted: false, canAskAgain: false, expires: 'never' });
  assert.equal((await shim.requestCameraPermissionsAsync()).granted, false);
  const [permission, request] = shim.useCameraPermissions();
  assert.equal(permission.granted, false);
  assert.equal(typeof request, 'function');
  assert.equal(typeof shim.addNotificationResponseReceivedListener(() => {}).remove, 'function');
  assert.equal(typeof shim.onForegroundEvent(() => {}), 'function', 'les « on… » renvoient une fonction de désabonnement');
  assert.equal(await shim.hasHardwareAsync(), false);
  assert.deepEqual(await shim.getAllScheduledNotificationsAsync(), []);
  assert.equal(await shim.doSomethingAsync(), undefined);
  assert.equal(shim.AndroidImportance.HIGH, 'demo.AndroidImportance.HIGH', 'enum tolérant');
  assert.equal(shim.SomeView({}), null, 'un composant inconnu n’affiche rien');
  assert.ok(new shim.SomeClass(), 'une classe inconnue reste instanciable');
  assert.equal(shim.default.getPermissionsAsync, shim.getPermissionsAsync, 'default = le module lui-même');
});

test('le vrai module est gardé, ses erreurs « non disponible sur le web » sont neutralisées', async () => {
  const unavailable = () => {
    const e = new Error('The method or property X.y is not available on web');
    (e as Error & { code?: string }).code = 'ERR_UNAVAILABLE';
    throw e;
  };
  const real = {
    works: () => 42,
    breaksSync: unavailable,
    breaksAsync: async () => unavailable(),
    realBug: () => {
      throw new Error('vrai bug');
    },
    Constant: { A: 1 },
  };
  const shim = createShim('demo', real, { overridden: () => 'à la main' });
  assert.equal(shim.works(), 42);
  assert.equal(shim.breaksSync(), undefined);
  assert.equal(await shim.breaksAsync(), undefined);
  assert.throws(() => shim.realBug(), /vrai bug/, 'les autres erreurs ne sont pas masquées');
  assert.deepEqual(shim.Constant, { A: 1 });
  assert.equal(shim.overridden(), 'à la main');
});

test('expo-file-system : fichiers et dossiers en mémoire', async () => {
  const { File, Directory, Paths } = require('../shims/expo-file-system.js');
  const dir = new Directory(Paths.document, 'invoices', 'f1');
  assert.equal(dir.exists, false);
  dir.create();
  assert.equal(dir.exists, true);
  const photo = new File(dir, 'a.jpg');
  photo.write('contenu');
  assert.equal(await photo.text(), 'contenu');
  assert.deepEqual(dir.list().map((e: { name: string }) => e.name), ['a.jpg']);
  const copy = new File(dir, 'b.jpg');
  new File('blob:http://x/123').copy(copy);
  assert.equal(copy.textSync(), 'blob:http://x/123', 'un fichier externe garde son URI');
  new Directory(Paths.document, 'invoices').delete();
  assert.equal(photo.exists, false);
  assert.equal(Paths.extname('x/y.png'), '.png');
});

test('expo-secure-store : stocké dans le localStorage de l’écran', async () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } };
  const secure = require('../shims/expo-secure-store.js');
  await secure.setItemAsync('pin', '1234');
  assert.equal(await secure.getItemAsync('pin'), '1234');
  await secure.deleteItemAsync('pin');
  assert.equal(await secure.getItemAsync('pin'), null);
  delete (globalThis as { window?: unknown }).window;
});

test('withRnCanvas : redirections seulement sur le web, activées par rn-canvas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-canvas-metro-'));
  fs.mkdirSync(path.join(root, 'node_modules/react-zero-skeleton'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/react-zero-skeleton/package.json'), JSON.stringify({ main: 'dist/index.js', 'react-native': 'dist/native/index.js' }));
  fs.writeFileSync(path.join(root, 'rn-canvas.json'), JSON.stringify({ shims: { 'my-native-lib': './shims/my-lib.js', 'expo-media-library': false } }));
  const upstream = (_ctx: unknown, name: string) => ({ type: 'sourceFile', filePath: `upstream:${name}` });
  const resolveWith = (enabled: boolean) => withRnCanvas({ projectRoot: root, resolver: { assetExts: ['png'], resolveRequest: upstream } }, { enabled });
  const ctx = { originModulePath: path.join(root, 'src/a.js') };

  const on = resolveWith(true);
  assert.ok(on.resolver.assetExts.includes('wasm'));
  const r = (name: string, platform = 'web', c = ctx) => on.resolver.resolveRequest(c, name, platform).filePath;
  assert.match(r('expo-notifications'), /shims[/\\]expo-notifications\.js$/);
  assert.equal(r('expo-notifications', 'ios'), 'upstream:expo-notifications');
  assert.equal(r('my-native-lib'), path.join(root, 'shims/my-lib.js'));
  assert.equal(r('expo-media-library'), 'upstream:expo-media-library', 'un remplacement désactivé (false)');
  assert.equal(r('react-zero-skeleton'), path.join(root, 'node_modules/react-zero-skeleton/dist/native/index.js'));
  assert.equal(r('expo-notifications', 'web', { originModulePath: path.join(path.dirname(new URL(import.meta.url).pathname), '../shims/expo-notifications.js') }), 'upstream:expo-notifications', 'un remplacement charge le vrai module');

  const off = resolveWith(false);
  assert.equal(off.resolver.resolveRequest(ctx, 'expo-notifications', 'web').filePath, 'upstream:expo-notifications');
});
