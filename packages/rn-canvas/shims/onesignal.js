'use strict';
// OneSignal (react-native-onesignal) : pas d'inscription aux notifications dans le canevas.
// Toute l'API (OneSignal.Notifications.addEventListener, OneSignal.User.addTag…) est sans effet.
const { deepShim } = require('./_shim');

const LogLevel = { None: 0, Fatal: 1, Error: 2, Warn: 3, Info: 4, Debug: 5, Verbose: 6 };
module.exports = deepShim('react-native-onesignal', { LogLevel, OneSignal: deepShim('OneSignal', { LogLevel }) });
