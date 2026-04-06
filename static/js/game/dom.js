export function getViewerDom() {
  return {
    canvas: document.querySelector('#scene'),
    statusLabel: document.querySelector('#viewer-status'),
    mappingSummaryLabel: document.querySelector('#viewer-mapping-summary'),
    socketStateLabel: document.querySelector('#viewer-socket-state'),
    fpsLabel: document.querySelector('#viewer-fps'),
    packetRateLabel: document.querySelector('#viewer-packet-rate'),
    quaternionLabel: document.querySelector('#viewer-quaternion'),
    boneQuaternionLabel: document.querySelector('#viewer-bone01-quaternion'),
    matchFrameLabel: document.querySelector('#viewer-match-frame'),
    cameraPositionLabel: document.querySelector('#viewer-camera-position'),
    socketAxisSelect: document.querySelector('#socket-axis-select'),
    socketRefAxisSelect: document.querySelector('#socket-ref-axis-select'),
    showAxesCheckbox: document.querySelector('#show-axes-checkbox'),
  };
}