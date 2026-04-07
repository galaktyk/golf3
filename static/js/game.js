import * as THREE from 'three';
import { decodeQuaternionPacket } from '/static/js/protocol.js';
import {
  BALL_DEFAULT_LAUNCH_DATA,
  BALL_RADIUS,
  CAMERA_LABEL_UPDATE_INTERVAL_MS,
  CHARACTER_ROTATION_SPEED_DEGREES,
  CLUB_HEAD_CONTACT_RELEASE_DISTANCE,
  FPS_LABEL_UPDATE_INTERVAL_MS,
} from '/static/js/game/constants.js';
import { createBallPhysics } from '/static/js/game/ballPhysics.js';
import { createBallTrail } from '/static/js/game/ballTrail.js';
import { getViewerDom } from '/static/js/game/dom.js';
import { createViewerHud } from '/static/js/game/hud.js';
import { resolveClubBallImpact } from '/static/js/game/impact/clubImpact.js';
import { loadCharacter, loadViewerModels } from '/static/js/game/models.js';
import { createViewerScene } from '/static/js/game/scene.js';

const animationClock = new THREE.Clock();
const incomingQuaternion = new THREE.Quaternion();
const dom = getViewerDom();
const viewerScene = createViewerScene(dom.canvas);
const hud = createViewerHud(dom);
const character = loadCharacter(viewerScene, (message) => hud.setStatus(message));
const ballPhysics = createBallPhysics(viewerScene);
const ballTrail = createBallTrail(BALL_RADIUS);

viewerScene.scene.add(ballTrail.root);

let hasIncomingOrientation = false;
let lastCameraLabelUpdateTime = 0;
let lastFpsSampleTime = performance.now();
let lastPacketSampleTime = performance.now();
let packetsSinceLastSample = 0;
let framesSinceLastSample = 0;
let playerState = 'control';
let currentLaunchData = null;
let clubBallContactLatched = false;
let rotateCharacterLeft = false;
let rotateCharacterRight = false;

const CHARACTER_ROTATION_SPEED_RADIANS = THREE.MathUtils.degToRad(CHARACTER_ROTATION_SPEED_DEGREES);

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
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    if (event.code === 'ArrowLeft') {
      rotateCharacterLeft = true;
    } else {
      rotateCharacterRight = true;
    }

    event.preventDefault();
    return;
  }

  if (event.repeat) {
    return;
  }

  if (event.code === 'KeyL') {
    if (playerState !== 'control' || ballPhysics.getStateSnapshot().phase !== 'ready') {
      return;
    }

    launchBall({
      ...BALL_DEFAULT_LAUNCH_DATA,
      horizontalLaunchAngle: 0,
    });
    return;
  }

  if (event.code === 'KeyR') {
    resetShotFlow();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowLeft') {
    rotateCharacterLeft = false;
    event.preventDefault();
    return;
  }

  if (event.code === 'ArrowRight') {
    rotateCharacterRight = false;
    event.preventDefault();
  }
});

window.addEventListener('blur', () => {
  rotateCharacterLeft = false;
  rotateCharacterRight = false;
});

animate();

function animate() {
  requestAnimationFrame(animate);

  const deltaSeconds = animationClock.getDelta();
  framesSinceLastSample += 1;
  updateCharacterRotationInput(deltaSeconds);
  character.update(deltaSeconds, hasIncomingOrientation ? incomingQuaternion : null);
  const characterTelemetry = character.getDebugTelemetry();
  detectClubBallImpact(characterTelemetry);
  ballPhysics.update(deltaSeconds);
  let ballTelemetry = ballPhysics.getDebugTelemetry();
  const trailTelemetry = ballTelemetry;

  if (playerState === 'waiting' && ballPhysics.consumeShotSettled()) {
    viewerScene.positionCharacterForBall(ballTelemetry.position);
    ballPhysics.prepareForNextShot();
    playerState = 'control';
    currentLaunchData = null;
    clubBallContactLatched = true;
    ballTelemetry = ballPhysics.getDebugTelemetry();
  }

  viewerScene.ballRoot.position.copy(ballPhysics.getPosition());
  viewerScene.ballRoot.quaternion.copy(ballPhysics.getOrientation());
  ballTrail.update(ballPhysics.getPosition(), trailTelemetry, deltaSeconds);
  viewerScene.updateBallFollowCamera(deltaSeconds);
  updateCharacterDebugTelemetry(characterTelemetry);
  updateBallDebugTelemetry(ballTelemetry);
  updateLaunchDebugTelemetry(ballTelemetry);
  updateFpsIfNeeded();
  updatePacketRateIfNeeded();
  viewerScene.controls.update();
  viewerScene.applyCameraTilt();
  updateCameraPositionLabelIfNeeded();
  viewerScene.renderer.render(viewerScene.scene, viewerScene.camera);
}

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function updateCharacterRotationInput(deltaSeconds) {
  if (playerState !== 'control' || ballPhysics.getStateSnapshot().phase !== 'ready') {
    return;
  }

  const rotationDirection = Number(rotateCharacterLeft) - Number(rotateCharacterRight);
  if (rotationDirection === 0) {
    return;
  }

  viewerScene.rotateCharacterAroundBall(
    ballPhysics.getPosition(),
    rotationDirection * CHARACTER_ROTATION_SPEED_RADIANS * deltaSeconds,
  );
}

function updateCharacterDebugTelemetry(telemetry) {
  hud.updateBoneQuaternion(telemetry.boneQuaternion);
  hud.updateMatchFrame(
    telemetry.currentMatchFrameIndex,
    telemetry.sampleCount,
    telemetry.targetAnimationTimeSeconds,
  );
}

function updateBallDebugTelemetry(telemetry) {
  hud.updateBallState(telemetry.phase, telemetry.movementState, telemetry.speedMetersPerSecond);
  hud.updateShotStates(playerState, telemetry.phase, telemetry.movementState);
}

function updateLaunchDebugTelemetry(telemetry) {
  const isBallMoving = telemetry.phase === 'moving';
  hud.updateLaunchPanelVisible(isBallMoving);

  if (!isBallMoving || !currentLaunchData) {
    hud.clearLaunchData();
    return;
  }

  hud.updateLaunchData(currentLaunchData);
}

function detectClubBallImpact(characterTelemetry) {
  releaseClubBallContactLatch(characterTelemetry.clubHeadPosition);

  const ballTelemetry = ballPhysics.getDebugTelemetry();
  if (playerState !== 'control' || ballTelemetry.phase !== 'ready' || !characterTelemetry.hasClubHeadSample) {
    return;
  }

  if (clubBallContactLatched) {
    return;
  }

  const impact = resolveClubBallImpact(characterTelemetry, ballTelemetry.position);
  if (!impact) {
    return;
  }

  launchBall(impact.launchData, impact.referenceForward);
  clubBallContactLatched = true;
}

function launchBall(launchData, referenceForward) {
  currentLaunchData = {
    ballSpeed: launchData.ballSpeed,
    verticalLaunchAngle: launchData.verticalLaunchAngle,
    horizontalLaunchAngle: launchData.horizontalLaunchAngle,
    spinSpeed: launchData.spinSpeed,
    spinAxis: launchData.spinAxis,
  };
  playerState = 'waiting';
  ballTrail.reset();
  ballPhysics.launch(launchData, referenceForward);
}

function releaseClubBallContactLatch(clubHeadPosition) {
  if (!clubBallContactLatched) {
    return;
  }

  if (clubHeadPosition.distanceTo(ballPhysics.getPosition()) > CLUB_HEAD_CONTACT_RELEASE_DISTANCE) {
    clubBallContactLatched = false;
  }
}

function resetShotFlow() {
  ballPhysics.reset();
  ballTrail.reset();
  viewerScene.positionCharacterForBall(ballPhysics.getPosition());
  playerState = 'control';
  currentLaunchData = null;
  clubBallContactLatched = true;
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