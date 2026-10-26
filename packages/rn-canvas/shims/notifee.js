'use strict';
// Notifee : notifications et canaux ignorés, événements jamais émis.
const { createShim } = require('./_shim');

module.exports = createShim('@notifee/react-native', null, {
  createChannel: async (channel) => (channel && channel.id) || 'rn-canvas-channel',
  createChannels: async () => {},
  displayNotification: async () => 'rn-canvas-notification',
  createTriggerNotification: async () => 'rn-canvas-notification',
  getInitialNotification: async () => null,
  requestPermission: async () => ({ authorizationStatus: 0 }),
  getNotificationSettings: async () => ({ authorizationStatus: 0 }),
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MIN: 1, NONE: 0 },
  EventType: { UNKNOWN: -1, DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3, APP_BLOCKED: 4, CHANNEL_BLOCKED: 5, CHANNEL_GROUP_BLOCKED: 6, TRIGGER_NOTIFICATION_CREATED: 7, FG_ALREADY_EXIST: 8 },
  TriggerType: { TIMESTAMP: 0, INTERVAL: 1 },
  RepeatFrequency: { NONE: -1, HOURLY: 0, DAILY: 1, WEEKLY: 2 },
});
