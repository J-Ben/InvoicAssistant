'use strict';
// Widgets Android : rien à enregistrer ni à mettre à jour hors d'Android.
const { createShim } = require('./_shim');

module.exports = createShim('react-native-android-widget', null, {
  registerWidgetTaskHandler: () => {},
  registerWidgetConfigurationScreen: () => {},
  requestWidgetUpdate: async () => {},
  requestWidgetUpdateById: async () => {},
  getWidgetInfo: async () => [],
});
