import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shareStoryBundle } = require('../metro.cjs');

/** Réponse HTTP minimale, comme celle que reçoit le middleware de Metro. */
function response() {
  const headers: Record<string, unknown> = {};
  const res = {
    statusCode: 200,
    body: null as Buffer | null,
    headers,
    setHeader: (k: string, v: unknown) => void (headers[k.toLowerCase()] = v),
    removeHeader: (k: string) => void delete headers[k.toLowerCase()],
    writeHead(status: number) {
      res.statusCode = status;
      return res;
    },
    write: (_chunk: unknown) => true,
    end(chunk?: Buffer | string) {
      res.body = chunk === undefined ? null : Buffer.from(chunk);
    },
  };
  return res;
}

const BUNDLE = '/index.bundle?platform=web&dev=true';

test('bundle demandé par un écran (sous-domaine) : redirigé vers l’hôte principal, URL commune', () => {
  const res = response();
  assert.equal(shareStoryBundle({ url: BUNDLE, method: 'GET', headers: { host: 'accueil-actuel-1k2j.localhost:8081', 'sec-fetch-dest': 'script' } }, res), true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `http://localhost:8081${BUNDLE}`);
});

test('bundle sur l’hôte principal : ETag, revalidation, 304 tant que le code ne change pas', () => {
  const first = response();
  assert.equal(shareStoryBundle({ url: BUNDLE, method: 'GET', headers: { host: 'localhost:8081' } }, first), false);
  // Metro répond ensuite, en plusieurs morceaux.
  first.setHeader('Cache-Control', 'no-store');
  first.write('var a = 1;');
  first.end('var b = 2;');
  assert.equal(first.statusCode, 200);
  assert.equal(first.body!.toString(), 'var a = 1;var b = 2;');
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.equal(first.headers['access-control-allow-origin'], '*');
  const etag = first.headers.etag as string;
  assert.match(etag, /^"rnc-[0-9a-f]{40}"$/);

  const again = response();
  shareStoryBundle({ url: BUNDLE, method: 'GET', headers: { host: 'localhost:8081', 'if-none-match': etag } }, again);
  again.end('var a = 1;var b = 2;');
  assert.equal(again.statusCode, 304);
  assert.equal(again.body, null);

  const changed = response();
  shareStoryBundle({ url: BUNDLE, method: 'GET', headers: { host: 'localhost:8081', 'if-none-match': etag } }, changed);
  changed.end('var a = 3;');
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, etag);
});

test('morceau chargé à la demande par fetch (expo-router) : pas redirigé, servi par le sous-domaine', () => {
  const res = response();
  const req = { url: '/src/app/_layout.bundle?platform=web&dev=true&modulesOnly=true', method: 'GET', headers: { host: 'a.localhost:8081', 'sec-fetch-dest': 'empty' } };
  assert.equal(shareStoryBundle(req, res), false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.location, undefined);
});

test('ni page, ni bundle natif : rien n’est touché', () => {
  const res = response();
  assert.equal(shareStoryBundle({ url: '/?rnc-story=x', method: 'GET', headers: { host: 'a.localhost:8081' } }, res), false);
  assert.equal(shareStoryBundle({ url: '/index.bundle?platform=ios', method: 'GET', headers: { host: 'a.localhost:8081' } }, res), false);
  assert.equal(res.statusCode, 200);
});
