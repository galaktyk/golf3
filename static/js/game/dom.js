export function getViewerDom() {
  return {
    canvas: document.querySelector('#scene'),
    statusLabel: document.querySelector('#viewer-status'),
    socketStateLabel: document.querySelector('#viewer-socket-state'),
    fpsLabel: document.querySelector('#viewer-fps'),
    packetRateLabel: document.querySelector('#viewer-packet-rate'),
    quaternionLabel: document.querySelector('#viewer-quaternion'),
    boneQuaternionLabel: document.querySelector('#viewer-bone01-quaternion'),
    matchFrameLabel: document.querySelector('#viewer-match-frame'),
    cameraPositionLabel: document.querySelector('#viewer-camera-position'),
    ballStateLabel: document.querySelector('#viewer-ball-state'),
    ballSpeedLabel: document.querySelector('#viewer-ball-speed'),
  };
}