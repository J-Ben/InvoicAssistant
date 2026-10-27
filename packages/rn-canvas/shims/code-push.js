'use strict';
// CodePush (react-native-code-push, @revopush/react-native-code-push) : pas de mise à jour OTA dans
// le canevas. codePush(options)(App) et codePush(App) renvoient App ; sync() ne fait rien.
const { deepShim } = require('./_shim');

const fallback = deepShim('code-push');

const CheckFrequency = { ON_APP_START: 0, ON_APP_RESUME: 1, MANUAL: 2 };
const InstallMode = { IMMEDIATE: 0, ON_NEXT_RESTART: 1, ON_NEXT_RESUME: 2, ON_NEXT_SUSPEND: 3 };
const SyncStatus = {
  UP_TO_DATE: 0,
  UPDATE_INSTALLED: 1,
  UPDATE_IGNORED: 2,
  UNKNOWN_ERROR: 3,
  SYNC_IN_PROGRESS: 4,
  CHECKING_FOR_UPDATE: 5,
  AWAITING_USER_ACTION: 6,
  DOWNLOADING_PACKAGE: 7,
  INSTALLING_UPDATE: 8,
};
const UpdateState = { RUNNING: 0, PENDING: 1, LATEST: 2 };
const DeploymentStatus = { FAILED: 'DeploymentFailed', SUCCEEDED: 'DeploymentSucceeded' };

function codePush(optionsOrComponent) {
  if (typeof optionsOrComponent === 'function') return optionsOrComponent;
  return (Component) => Component;
}
Object.assign(codePush, {
  sync: async () => SyncStatus.UP_TO_DATE,
  checkForUpdate: async () => null,
  getUpdateMetadata: async () => null,
  notifyAppReady: async () => {},
  restartApp: () => {},
  allowRestart: () => {},
  disallowRestart: () => {},
  clearUpdates: () => {},
  CheckFrequency,
  InstallMode,
  SyncStatus,
  UpdateState,
  DeploymentStatus,
});

// Appelable comme codePush(options)(App) ; toute autre propriété est sans effet.
module.exports = new Proxy(codePush, {
  get: (target, key) => (key === '__esModule' ? true : key === 'default' ? module.exports : key in target ? target[key] : fallback[key]),
});
