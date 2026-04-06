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
    launchPanel: document.querySelector('#viewer-launch-panel'),
    playerStateLabel: document.querySelector('#viewer-player-state'),
    ballPhaseLabel: document.querySelector('#viewer-ball-phase'),
    ballMovementLabel: document.querySelector('#viewer-ball-movement'),
    launchBallSpeedLabel: document.querySelector('#viewer-launch-ball-speed'),
    launchVerticalAngleLabel: document.querySelector('#viewer-launch-vertical-angle'),
    launchHorizontalAngleLabel: document.querySelector('#viewer-launch-horizontal-angle'),
    launchSpinSpeedLabel: document.querySelector('#viewer-launch-spin-speed'),
    launchSpinAxisLabel: document.querySelector('#viewer-launch-spin-axis'),
  };
}