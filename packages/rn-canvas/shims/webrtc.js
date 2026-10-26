'use strict';
// WebRTC : on s'appuie sur l'implémentation du navigateur ; RTCView n'affiche rien.
const { createShim } = require('./_shim');

const g = typeof window !== 'undefined' ? window : globalThis;
function RTCView() {
  return null;
}
module.exports = createShim('react-native-webrtc', null, {
  RTCPeerConnection: g.RTCPeerConnection,
  RTCIceCandidate: g.RTCIceCandidate,
  RTCSessionDescription: g.RTCSessionDescription,
  MediaStream: g.MediaStream,
  MediaStreamTrack: g.MediaStreamTrack,
  mediaDevices: g.navigator && g.navigator.mediaDevices,
  permissions: g.navigator && g.navigator.permissions,
  registerGlobals: () => {},
  RTCView,
  ScreenCapturePickerView: RTCView,
});
