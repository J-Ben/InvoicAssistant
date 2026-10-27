'use strict';
/**
 * Fabrique de remplacements web (canevas rn-canvas uniquement).
 *
 * Un remplacement expose la même API que le module natif :
 * 1. les comportements écrits à la main (`overrides`) ;
 * 2. sinon, la vraie fonction du module si elle existe sur le web, protégée : une erreur
 *    « non disponible sur le web » est remplacée par une valeur neutre ;
 * 3. sinon, une valeur neutre déduite du nom : permission refusée, écouteur avec remove(),
 *    promesse résolue, composant vide…
 */

const DENIED = Object.freeze({ status: 'denied', granted: false, canAskAgain: false, expires: 'never' });

function isUnavailable(error) {
  const message = String((error && error.message) || error);
  return (error && error.code === 'ERR_UNAVAILABLE') || /not available on web|is not available|not supported on web|Cannot read propert/i.test(message);
}

/** Valeur « universelle » : composant qui n'affiche rien, classe instanciable, enum tolérant. */
function universal(label) {
  function RnCanvasPlaceholder() {
    return null;
  }
  RnCanvasPlaceholder.displayName = label;
  return new Proxy(RnCanvasPlaceholder, {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol' || prop.startsWith('$$') || prop.startsWith('_') || prop === 'then') return target[prop];
      return `${label}.${prop}`;
    },
  });
}

function fallbackFor(moduleName, key) {
  if (/^use\w*Permissions?$/.test(key)) return () => [DENIED, async () => DENIED, async () => DENIED];
  if (/Permissions?(Async)?$/.test(key) || /^(get|request)\w*Permission/.test(key)) return async () => DENIED;
  if (/^add\w*Listener$/.test(key) || /^subscribe/.test(key)) return () => ({ remove() {} });
  if (/^on[A-Z]/.test(key)) return () => () => {};
  if (/^(is|has)[A-Z]\w*Async$/.test(key)) return async () => false;
  if (/^(get\w*s|list\w*)Async$/.test(key)) return async () => [];
  if (/Async$/.test(key)) return async () => undefined;
  if (/^use[A-Z]/.test(key)) return () => null;
  if (/^[A-Z]/.test(key)) return universal(`${moduleName}.${key}`);
  return () => undefined;
}

function protect(moduleName, key, fn) {
  return function rnCanvasProtected(...args) {
    let result;
    try {
      result = fn.apply(this, args);
    } catch (error) {
      if (isUnavailable(error)) return fallbackFor(moduleName, key)(...args);
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.catch((error) => {
        if (isUnavailable(error)) return fallbackFor(moduleName, key)(...args);
        throw error;
      });
    }
    return result;
  };
}

/**
 * @param {string} moduleName
 * @param {Record<string, unknown> | null} real   module d'origine s'il se charge sur le web
 * @param {Record<string, unknown>} overrides
 */
function createShim(moduleName, real, overrides = {}) {
  const cache = new Map();
  const shim = new Proxy(
    {},
    {
      get(_, key) {
        if (key === '__esModule') return true;
        if (typeof key === 'symbol') return undefined;
        if (cache.has(key)) return cache.get(key);
        let value;
        if (key in overrides) value = overrides[key];
        else if (key === 'default') value = real && real.default ? createShim(moduleName, real.default, overrides) : shim;
        else if (real && key in real) {
          const original = real[key];
          // Les classes et composants (majuscule) restent tels quels ; les fonctions sont protégées.
          value = typeof original === 'function' && !/^[A-Z]/.test(key) ? protect(moduleName, key, original) : original;
        } else value = fallbackFor(moduleName, key);
        cache.set(key, value);
        return value;
      },
      has: () => true,
    },
  );
  return shim;
}

/** Charge le vrai module sans planter si son import échoue sur le web. */
function tryLoad(load) {
  try {
    return load();
  } catch {
    return null;
  }
}

/**
 * Remplacement « profond » d'un module dont on ne connaît pas l'API : toute propriété, à toute
 * profondeur, est une fonction sans effet (`OneSignal.Notifications.addEventListener(…)`), et
 * un appel renvoie à nouveau un remplacement. Cas particuliers :
 * - un HOC reçoit un composant et le renvoie tel quel (`codePush(options)(App)`, `wrap(App)`) ;
 * - utilisé comme composant (props figées par React), il affiche ses enfants ;
 * - jamais « thenable » : `await x()` donne un remplacement, pas une attente infinie.
 */
function deepShim(label, overrides = {}) {
  const cache = new Map();
  function RnCanvasShim(...args) {
    const [first] = args;
    if (typeof first === 'function') return first;
    if (first && typeof first === 'object' && (Object.isFrozen(first) || 'children' in first)) return first.children ?? null;
    return deepShim(`${label}()`);
  }
  RnCanvasShim.displayName = label;
  const proxy = new Proxy(RnCanvasShim, {
    get(target, key) {
      if (key === '__esModule') return true;
      if (typeof key === 'symbol') return key === Symbol.toPrimitive ? () => label : target[key];
      if (key in overrides) return overrides[key];
      if (key === 'default') return proxy;
      if (key === 'then' || key === '$$typeof' || key === 'prototype' || key === 'displayName' || key === 'name' || key === 'length') return target[key];
      if (!cache.has(key)) cache.set(key, deepShim(`${label}.${key}`));
      return cache.get(key);
    },
    has: () => true,
  });
  return proxy;
}

/** Composant qui affiche simplement ses enfants (ErrorBoundary, Profiler…). */
function passThrough(props) {
  return (props && props.children) ?? null;
}

/** HOC sans effet : renvoie le composant tel quel. */
const identity = (Component) => Component;

module.exports = { createShim, deepShim, passThrough, identity, tryLoad, DENIED };
