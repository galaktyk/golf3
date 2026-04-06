export function getViewerDom() {
  return {
    canvas: document.querySelector('#scene'),
    statusLabel: document.querySelector('#viewer-status'),
    socketStateLabel: document.querySelector('#viewer-socket-state'),
    fpsLabel: document.querySelector('#viewer-fps'),
    packetRateLabel: document.querySelector('#viewer-packet-rate'),
    quaternionLabel: document.querySelector('#viewer-quaternion'),
    cameraPositionLabel: document.querySelector('#viewer-camera-position'),
  };
}