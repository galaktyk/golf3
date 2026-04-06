import * as THREE from 'three';
import { decodeQuaternionPacket } from '/static/js/protocol.js';
import {
  BALL_DEFAULT_LAUNCH_DATA,
  CAMERA_LABEL_UPDATE_INTERVAL_MS,
  FPS_LABEL_UPDATE_INTERVAL_MS,
} from '/static/js/game/constants.js';
import { createBallPhysics } from '/static/js/game/ballPhysics.js';
import { getViewerDom } from '/static/js/game/dom.js';
import { createViewerHud } from '/static/js/game/hud.js';
import { loadCharacter, loadViewerModels } from '/static/js/game/models.js';
import { createViewerScene } from '/static/js/game/scene.js';

const animationClock = new THREE.Clock();
const incomingQuaternion = new THREE.Quaternion();
const dom = getViewerDom();
const viewerScene = createViewerScene(dom.canvas);
const hud = createViewerHud(dom);
const character = loadCharacter(viewerScene, (message) => hud.setStatus(message));
const ballPhysics = createBallPhysics(viewerScene);

let hasIncomingOrientation = false;
let lastCameraLabelUpdateTime = 0;
let lastFpsSampleTime = performance.now();
let lastPacketSampleTime = performance.now();
let packetsSinceLastSample = 0;
let framesSinceLastSample = 0;

loadViewerModels(viewerScene, (message) => hud.setStatus(message));
hud.initialize(viewerScene.camera.position, incomingQuaternion);

const socket = new WebSocket(`${getWebSocketBaseUrl()}/ws?role=viewer`);
socket.binaryType = 'arraybuffer';

socket.addEventListener('open', () => {
  hud.setStatus('Viewer connected. Waiting for phone data.');
  hud.updateSocketState('Connected');
});

socket.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    const payload = JSON.parse(event.data);
    if (payload.type === 'status') {
      hud.setStatus(payload.playerConnected
        ? 'Phone connected. Streaming live orientation.'
        : 'Viewer connected. Waiting for phone data.');
    }
    return;
  }

  decodeQuaternionPacket(event.data, incomingQuaternion);
  hasIncomingOrientation = true;
  packetsSinceLastSample += 1;
  hud.updateQuaternion(incomingQuaternion);
});

socket.addEventListener('close', () => {
  hud.setStatus('Viewer disconnected from server.');
  hud.updateSocketState('Disconnected');
  hud.updatePacketRate(0);
});

socket.addEventListener('error', () => {
  hud.updateSocketState('Error');
});

window.addEventListener('resize', () => {
  viewerScene.resize();
  hud.updateCameraPosition(viewerScene.camera.position);
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) {
    return;
  }

  if (event.code === 'KeyL') {
    ballPhysics.launch({
      ...BALL_DEFAULT_LAUNCH_DATA,
      horizontalLaunchAngle: 0,
    });
    return;
  }

  if (event.code === 'KeyR') {
    ballPhysics.reset();
  }
});

animate();

function animate() {
  requestAnimationFrame(animate);

  const deltaSeconds = animationClock.getDelta();
  framesSinceLastSample += 1;
  character.update(deltaSeconds, hasIncomingOrientation ? incomingQuaternion : null);
  ballPhysics.update(deltaSeconds);
  viewerScene.ballRoot.position.copy(ballPhysics.getPosition());
  viewerScene.ballRoot.quaternion.copy(ballPhysics.getOrientation());
  viewerScene.updateBallFollowCamera(deltaSeconds);
  updateCharacterDebugTelemetry();
  updateBallDebugTelemetry();
  updateFpsIfNeeded();
  updatePacketRateIfNeeded();
  viewerScene.controls.update();
  updateCameraPositionLabelIfNeeded();
  viewerScene.renderer.render(viewerScene.scene, viewerScene.camera);
}

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function updateCharacterDebugTelemetry() {
  const telemetry = character.getDebugTelemetry();
  hud.updateBoneQuaternion(telemetry.boneQuaternion);
  hud.updateMatchFrame(
    telemetry.currentMatchFrameIndex,
    telemetry.sampleCount,
    telemetry.targetAnimationTimeSeconds,
  );
}

function updateBallDebugTelemetry() {
  const telemetry = ballPhysics.getDebugTelemetry();
  hud.updateBallState(telemetry.mode, telemetry.speedMetersPerSecond);
}

function updatePacketRateIfNeeded() {
  const now = performance.now();
  const elapsedMs = now - lastPacketSampleTime;
  if (elapsedMs < 250) {
    return;
  }

  const packetsPerSecond = packetsSinceLastSample / (elapsedMs / 1000);
  hud.updatePacketRate(packetsPerSecond);
  packetsSinceLastSample = 0;
  lastPacketSampleTime = now;
}

function updateFpsIfNeeded() {
  const now = performance.now();
  const elapsedMs = now - lastFpsSampleTime;
  if (elapsedMs < FPS_LABEL_UPDATE_INTERVAL_MS) {
    return;
  }

  const framesPerSecond = framesSinceLastSample / (elapsedMs / 1000);
  hud.updateFps(framesPerSecond);
  framesSinceLastSample = 0;
  lastFpsSampleTime = now;
}

function updateCameraPositionLabelIfNeeded() {
  const now = performance.now();
  if (now - lastCameraLabelUpdateTime < CAMERA_LABEL_UPDATE_INTERVAL_MS) {
    return;
  }

  hud.updateCameraPosition(viewerScene.camera.position);
  lastCameraLabelUpdateTime = now;
}