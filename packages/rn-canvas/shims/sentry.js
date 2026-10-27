'use strict';
// Sentry (@sentry/react-native) : aucun envoi depuis le canevas. wrap(App) renvoie App, les
// composants (ErrorBoundary, TouchEventBoundary, Profiler) affichent leurs enfants.
const { deepShim, passThrough, identity } = require('./_shim');

module.exports = deepShim('@sentry/react-native', {
  init: () => {},
  wrap: identity,
  withErrorBoundary: identity,
  withProfiler: identity,
  withTouchEventBoundary: identity,
  ErrorBoundary: passThrough,
  TouchEventBoundary: passThrough,
  Profiler: passThrough,
  captureException: () => 'rn-canvas-event',
  captureMessage: () => 'rn-canvas-event',
  withScope: (callback) => callback(deepShim('Scope')),
  getCurrentScope: () => deepShim('Scope'),
});
