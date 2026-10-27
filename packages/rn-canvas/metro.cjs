'use strict';
/**
 * Configuration Metro de rn-canvas :
 *
 *   const { getDefaultConfig } = require('expo/metro-config');
 *   const { withRnCanvas } = require('rn-canvas/metro');
 *   module.exports = withRnCanvas(getDefaultConfig(__dirname));
 *
 * Quand Expo est lancé par rn-canvas (variable RN_CANVAS=1), le bundle web remplace les modules
 * natifs sans version web par des versions inoffensives (voir shims/). iOS, Android, la version
 * web normale et les builds de production ne sont pas touchés.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHIMS_DIR = path.join(__dirname, 'shims');

/** Module → remplacement fourni par rn-canvas. */
const BUILTIN_SHIMS = {
  'expo-notifications': 'expo-notifications.js',
  'expo-file-system': 'expo-file-system.js',
  'expo-file-system/legacy': 'expo-file-system-legacy.js',
  'expo-secure-store': 'expo-secure-store.js',
  'expo-local-authentication': 'expo-local-authentication.js',
  'expo-media-library': 'expo-media-library.js',
  '@notifee/react-native': 'notifee.js',
  '@react-native-ml-kit/text-recognition': 'mlkit-text-recognition.js',
  'react-native-android-widget': 'android-widget.js',
  'react-native-webrtc': 'webrtc.js',
  'react-native-code-push': 'code-push.js',
  '@revopush/react-native-code-push': 'code-push.js',
  'react-native-onesignal': 'onesignal.js',
  '@sentry/react-native': 'sentry.js',
};

/**
 * Paquets dont l'entrée « navigateur » vise le DOM (<div>) et plante sous react-native-web :
 * on prend leur entrée React Native (champ "react-native" du package.json).
 */
const BUILTIN_PREFER_NATIVE = ['react-zero-skeleton'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Remplacements actifs pour un projet : ceux de rn-canvas + `shims` de rn-canvas.json. */
function shimsFor(projectRoot) {
  const config = readJson(path.join(projectRoot, 'rn-canvas.json')) || {};
  const shims = {};
  for (const [name, file] of Object.entries(BUILTIN_SHIMS)) shims[name] = path.join(SHIMS_DIR, file);
  for (const [name, file] of Object.entries(config.shims || {})) {
    if (file === false) delete shims[name];
    else shims[name] = path.resolve(projectRoot, file);
  }
  return { shims, preferNative: [...BUILTIN_PREFER_NATIVE, ...(config.preferNative || [])] };
}

function nativeEntry(projectRoot, name) {
  const dir = path.join(projectRoot, 'node_modules', name);
  const pkg = readJson(path.join(dir, 'package.json'));
  const entry = pkg && typeof pkg['react-native'] === 'string' ? pkg['react-native'] : null;
  return entry ? path.join(dir, entry) : null;
}

function withRnCanvas(config, options = {}) {
  const projectRoot = options.projectRoot || config.projectRoot || process.cwd();
  const enabled = options.enabled ?? process.env.RN_CANVAS === '1';

  // expo-sqlite charge sa base en WebAssembly sur le web.
  config.resolver = config.resolver || {};
  config.resolver.assetExts = [...new Set([...(config.resolver.assetExts || []), 'wasm'])];

  const { shims, preferNative } = shimsFor(projectRoot);
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolve = upstream || context.resolveRequest;
    // Les remplacements eux-mêmes chargent les vrais modules : pas de redirection pour eux.
    const fromShim = context.originModulePath && context.originModulePath.startsWith(SHIMS_DIR);
    if (enabled && platform === 'web' && !fromShim) {
      if (shims[moduleName]) return { type: 'sourceFile', filePath: shims[moduleName] };
      if (preferNative.includes(moduleName)) {
        const entry = nativeEntry(projectRoot, moduleName);
        if (entry) return { type: 'sourceFile', filePath: entry };
      }
    }
    return resolve(context, moduleName, platform);
  };

  // Permet à `rn-canvas dev` de vérifier qu'Expo tourne bien avec les remplacements.
  config.server = config.server || {};
  const upstreamMiddleware = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = upstreamMiddleware ? upstreamMiddleware(middleware, server) : middleware;
    return (req, res, done) => {
      if (req.url === '/__rn-canvas') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ shims: enabled, modules: Object.keys(shims) }));
        return;
      }
      if (enabled && shareStoryBundle(req, res)) return;
      next(req, res, done);
    };
  };

  return config;
}

/**
 * Écrans du canevas : chacun est servi depuis son sous-domaine (`ecran-1k2j.localhost:8081`, stockage
 * isolé) et chargerait sa propre copie du bundle de développement, servi sans cache (plusieurs dizaines
 * de Mo, recompilés à chaque fois). Le bundle demandé depuis un sous-domaine est redirigé vers l'hôte
 * principal (`localhost:8081`) : une seule URL pour tous les écrans. Il y est servi avec un ETag : le
 * navigateur le revalide (304 tant que le code n'a pas changé) et réutilise sa compilation. Seul
 * l'emplacement du script change : la page, donc le stockage, reste celle du sous-domaine. Rien ne
 * change pour l'app ouverte normalement (`localhost:8081`).
 */
function shareStoryBundle(req, res) {
  const url = req.url || '';
  if (!/\.bundle(\?|$)/.test(url) || !/[?&]platform=web\b/.test(url) || req.method !== 'GET') return false;
  const host = String(req.headers.host || '');
  const main = host.replace(/^[^:]+\.(localhost(:\d+)?)$/, '$1');
  // Seul le script principal (balise <script>) est redirigé : les morceaux chargés à la demande
  // (expo-router) passent par fetch, dont la requête préalable CORS ne suit pas une redirection.
  if (main !== host && req.headers['sec-fetch-dest'] === 'script') {
    res.statusCode = 302;
    res.setHeader('Location', `http://${main}${url}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.end();
    return true;
  }
  if (main !== host) return false;
  // Les morceaux chargés à la demande (expo-router) passent par fetch : après la redirection depuis le
  // sous-domaine, leur origine vaut « null » ; on la renvoie telle quelle.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  const ifNoneMatch = req.headers['if-none-match'];
  holdBody(res, (body) => {
    const etag = `"rnc-${crypto.createHash('sha1').update(body).digest('hex')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.removeHeader('Surrogate-Control');
    return ifNoneMatch === etag;
  });
  return false;
}

/**
 * Retient la réponse de Metro jusqu'à son dernier octet : `notModified` (appelé avec le corps, pour
 * poser ses en-têtes) peut alors répondre 304 à la place. Seules les réponses 200 sont touchées.
 */
function holdBody(res, notModified) {
  const chunks = [];
  const write = res.write;
  const end = res.end;
  const writeHead = res.writeHead;
  let head = null;
  res.writeHead = function (...args) {
    head = args;
    return this;
  };
  res.write = function (chunk, encoding) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    return true;
  };
  res.end = function (chunk, encoding) {
    if (chunk && typeof chunk !== 'function') res.write(chunk, encoding);
    res.write = write;
    res.end = end;
    res.writeHead = writeHead;
    if (head) {
      res.statusCode = head[0];
      const headers = head.find((h) => h && typeof h === 'object');
      if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    }
    const body = Buffer.concat(chunks);
    if (res.statusCode === 200 && notModified(body)) {
      res.statusCode = 304;
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Type');
      return end.call(res);
    }
    return end.call(res, body);
  };
}

module.exports = { withRnCanvas, shimsFor, BUILTIN_SHIMS, shareStoryBundle };
