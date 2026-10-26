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
      next(req, res, done);
    };
  };

  return config;
}

module.exports = { withRnCanvas, shimsFor, BUILTIN_SHIMS };
