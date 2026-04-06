import * as THREE from 'three';
import { decodeQuaternionPacket } from '/static/js/protocol.js';
import {
  BALL_DEFAULT_LAUNCH_DATA,
  BALL_IMPACT_DEBUG_SPIN_AXIS,
  BALL_IMPACT_DEBUG_SPIN_SPEED,
  BALL_IMPACT_VERTICAL_LAUNCH_ANGLE,
  BALL_RADIUS,
  CAMERA_LABEL_UPDATE_INTERVAL_MS,
  CHARACTER_ROTATION_SPEED_DEGREES,
  CLUB_HEAD_COLLIDER_RADIUS,
  CLUB_HEAD_CONTACT_RELEASE_DISTANCE,
  CLUB_HEAD_IMPACT_MIN_SPEED,
  CLUB_HEAD_LAUNCH_DIRECTION_LOCAL,
  CLUB_HEAD_TO_BALL_SPEED_FACTOR,
  CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
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
let playerState = 'control';
let currentLaunchData = null;
let clubBallContactLatched = false;
let rotateCharacterLeft = false;
let rotateCharacterRight = false;

const CLUB_HEAD_SWEEP = new THREE.Vector3();
const CLUB_HEAD_TO_CLOSEST_POINT = new THREE.Vector3();
const CLUB_TO_BALL = new THREE.Vector3();
const CLUB_HEAD_LAUNCH_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_PITCH_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_SIDE_AXIS = new THREE.Vector3();
const HORIZONTAL_ARRIVAL_DIRECTION = new THREE.Vector3();
const HORIZONTAL_FACING_FORWARD = new THREE.Vector3();
const SWEEP_CLOSEST_POINT = new THREE.Vector3();
const SIGNED_ANGLE_CROSS = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
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

  const ballPosition = ballTelemetry.position;
  const contactDistance = CLUB_HEAD_COLLIDER_RADIUS + BALL_RADIUS;
  if (clubBallContactLatched || !didClubHeadSweepHitBall(characterTelemetry, ballPosition, contactDistance)) {
    return;
  }

  if (characterTelemetry.clubHeadSpeedMetersPerSecond < CLUB_HEAD_IMPACT_MIN_SPEED) {
    return;
  }

  CLUB_TO_BALL.subVectors(ballPosition, characterTelemetry.clubHeadPreviousPosition);
  if (CLUB_HEAD_SWEEP.dot(CLUB_TO_BALL) <= 0) {
    return;
  }

  const launchData = buildImpactLaunchData(characterTelemetry);
  launchBall(launchData, characterTelemetry.characterFacingForward);
  clubBallContactLatched = true;
}

function didClubHeadSweepHitBall(characterTelemetry, ballPosition, contactDistance) {
  CLUB_HEAD_SWEEP.subVectors(characterTelemetry.clubHeadPosition, characterTelemetry.clubHeadPreviousPosition);
  const sweepLengthSquared = CLUB_HEAD_SWEEP.lengthSq();
  if (sweepLengthSquared <= 1e-10) {
    return characterTelemetry.clubHeadPosition.distanceTo(ballPosition) <= contactDistance;
  }

  const ballProjection = CLUB_HEAD_TO_CLOSEST_POINT
    .subVectors(ballPosition, characterTelemetry.clubHeadPreviousPosition)
    .dot(CLUB_HEAD_SWEEP) / sweepLengthSquared;
  const clampedProjection = THREE.MathUtils.clamp(ballProjection, 0, 1);

  SWEEP_CLOSEST_POINT.copy(characterTelemetry.clubHeadPreviousPosition)
    .addScaledVector(CLUB_HEAD_SWEEP, clampedProjection);

  return SWEEP_CLOSEST_POINT.distanceToSquared(ballPosition) <= contactDistance * contactDistance;
}

function buildImpactLaunchData(characterTelemetry) {
  HORIZONTAL_ARRIVAL_DIRECTION.copy(characterTelemetry.clubHeadVelocity);
  HORIZONTAL_ARRIVAL_DIRECTION.y = 0;
  if (HORIZONTAL_ARRIVAL_DIRECTION.lengthSq() <= 1e-8) {
    HORIZONTAL_ARRIVAL_DIRECTION.copy(characterTelemetry.characterFacingForward);
  } else {
    HORIZONTAL_ARRIVAL_DIRECTION.normalize();
  }

  HORIZONTAL_FACING_FORWARD.copy(characterTelemetry.characterFacingForward);
  HORIZONTAL_FACING_FORWARD.y = 0;
  if (HORIZONTAL_FACING_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FACING_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FACING_FORWARD.normalize();
  }

  return {
    ballSpeed: characterTelemetry.clubHeadSpeedMetersPerSecond * CLUB_HEAD_TO_BALL_SPEED_FACTOR,
    verticalLaunchAngle: getVerticalLaunchAngleDegrees(characterTelemetry),
    horizontalLaunchAngle: getSignedHorizontalAngleDegrees(
      HORIZONTAL_FACING_FORWARD,
      HORIZONTAL_ARRIVAL_DIRECTION,
    ),
    spinSpeed: BALL_IMPACT_DEBUG_SPIN_SPEED,
    spinAxis: BALL_IMPACT_DEBUG_SPIN_AXIS,
  };
}

function getSignedHorizontalAngleDegrees(fromDirection, toDirection) {
  const dot = THREE.MathUtils.clamp(fromDirection.dot(toDirection), -1, 1);
  SIGNED_ANGLE_CROSS.crossVectors(fromDirection, toDirection);
  const radians = Math.atan2(SIGNED_ANGLE_CROSS.y, dot);
  return THREE.MathUtils.radToDeg(radians);
}

function getVerticalLaunchAngleDegrees(characterTelemetry) {
  if (!characterTelemetry.clubHeadQuaternion) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION_LOCAL)
    .applyQuaternion(characterTelemetry.clubHeadQuaternion);
  if (CLUB_HEAD_LAUNCH_DIRECTION.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.normalize();
  if (CLUB_HEAD_LAUNCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION) < 0) {
    CLUB_HEAD_LAUNCH_DIRECTION.multiplyScalar(-1);
  }

  CLUB_HEAD_SIDE_AXIS.crossVectors(HORIZONTAL_ARRIVAL_DIRECTION, WORLD_UP);
  if (CLUB_HEAD_SIDE_AXIS.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_SIDE_AXIS.normalize();
  CLUB_HEAD_PITCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION);
  CLUB_HEAD_PITCH_DIRECTION.addScaledVector(
    CLUB_HEAD_SIDE_AXIS,
    -CLUB_HEAD_PITCH_DIRECTION.dot(CLUB_HEAD_SIDE_AXIS),
  );
  if (CLUB_HEAD_PITCH_DIRECTION.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_PITCH_DIRECTION.normalize();
  if (CLUB_HEAD_PITCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION) < 0) {
    CLUB_HEAD_PITCH_DIRECTION.multiplyScalar(-1);
  }

  const radians = Math.atan2(
    CLUB_HEAD_PITCH_DIRECTION.y,
    Math.max(CLUB_HEAD_PITCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION), 1e-6),
  );
  return THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(radians),
    CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
    CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  );
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