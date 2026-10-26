'use strict';
// Notifications : rien n'est programmé ni affiché dans le canevas.
const { createShim, tryLoad } = require('./_shim');

module.exports = createShim('expo-notifications', tryLoad(() => require('expo-notifications')), {
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => null,
  deleteNotificationChannelAsync: async () => {},
  scheduleNotificationAsync: async () => 'rn-canvas-notification',
  presentNotificationAsync: async () => 'rn-canvas-notification',
  cancelScheduledNotificationAsync: async () => {},
  cancelAllScheduledNotificationsAsync: async () => {},
  dismissNotificationAsync: async () => {},
  dismissAllNotificationsAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [],
  getPresentedNotificationsAsync: async () => [],
  getLastNotificationResponse: () => null,
  getLastNotificationResponseAsync: async () => null,
  useLastNotificationResponse: () => null,
  getBadgeCountAsync: async () => 0,
  setBadgeCountAsync: async () => true,
  getExpoPushTokenAsync: async () => ({ type: 'expo', data: 'ExponentPushToken[rn-canvas]' }),
  getDevicePushTokenAsync: async () => ({ type: 'web', data: 'rn-canvas' }),
});
