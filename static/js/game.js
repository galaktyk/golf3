import * as THREE from 'three';
import { CONTROL_ACTIONS, decodeControlMessage, decodeSwingStatePacket } from '/static/js/protocol.js';
import {
  BALL_DEFAULT_LAUNCH_DATA,
  BALL_RADIUS,
  CAMERA_LABEL_UPDATE_INTERVAL_MS,
  CHARACTER_ROTATION_SPEED_DEGREES,
  CLUB_HEAD_CONTACT_RELEASE_DISTANCE,
  FPS_LABEL_UPDATE_INTERVAL_MS,
  HOLE_MARKER_LABEL_DEPTH,
  HOLE_MARKER_LABEL_EDGE_PADDING_PX,
  HOLE_MARKER_LABEL_TOP_OFFSET_RATIO,
  PHONE_ANGULAR_SPEED_TO_CLUB_HEAD_SPEED_GAIN,
  SHOT_AUDIO_PANGYA_MAX_HORIZONTAL_ANGLE_DEGREES,
} from '/static/js/game/constants.js';
import { ACTIVE_CLUB, ACTIVE_CLUB_SET } from '/static/js/game/clubData.js';
import { createBallPhysics } from '/static/js/game/ballPhysics.js';
import { createBallTrail } from '/static/js/game/ballTrail.js';
import { getViewerDom } from '/static/js/game/dom.js';
import { formatDistanceYards, formatHeightDeltaMeters } from '/static/js/game/formatting.js';
import { createViewerHud } from '/static/js/game/hud.js';
import { getClubLaunchPreview, resolveClubBallImpact } from '/static/js/game/impact/clubImpact.js';
import { createShotImpactAudio } from '/static/js/game/impact/shotAudio.js';
import { loadCharacter, loadViewerModels } from '/static/js/game/models.js';
import { createViewerScene } from '/static/js/game/scene.js';

const animationClock = new THREE.Clock();
const incomingQuaternion = new THREE.Quaternion();
const incomingSwingState = {
  perpendicularAngularSpeedRadiansPerSecond: 0,
  motionAgeMilliseconds: 65535,
  sequence: 0,
  receivedAtTimeMs: 0,
};
const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const LAUNCH_DEBUG_ENABLED = DEBUG_PARAMS.has('launchDebug');
const LAUNCH_DEBUG_INPUT_FIELDS = [
  { key: 'ballSpeed', inputKey: 'launchBallSpeedInput' },
  { key: 'verticalLaunchAngle', inputKey: 'launchVerticalAngleInput' },
  { key: 'horizontalLaunchAngle', inputKey: 'launchHorizontalAngleInput' },
  { key: 'spinSpeed', inputKey: 'launchSpinSpeedInput' },
  { key: 'spinAxis', inputKey: 'launchSpinAxisInput' },
];
const dom = getViewerDom();
const viewerScene = createViewerScene(dom.canvas);
const hud = createViewerHud(dom);
const character = loadCharacter(viewerScene, (message) => hud.setStatus(message));
const ballPhysics = createBallPhysics(viewerScene);
const ballTrail = createBallTrail(BALL_RADIUS);
const shotImpactAudio = createShotImpactAudio();

viewerScene.scene.add(ballTrail.root);

let hasIncomingOrientation = false;
let lastCameraLabelUpdateTime = 0;
let lastFpsSampleTime = performance.now();
let lastPacketSampleTime = performance.now();
let packetsSinceLastSample = 0;
let framesSinceLastSample = 0;
let playerState = 'control';
let clubBallContactLatched = false;
let activeClub = ACTIVE_CLUB;
let rotateCharacterLeft = false;
let rotateCharacterRight = false;
let freeCameraMoveForward = false;
let freeCameraMoveBackward = false;
let freeCameraMoveLeft = false;
let freeCameraMoveRight = false;
let freeCameraLookActive = false;
let hasFreeCameraFallbackPointerPosition = false;
let lastFreeCameraPointerClientX = 0;
let lastFreeCameraPointerClientY = 0;

const CHARACTER_ROTATION_SPEED_RADIANS = THREE.MathUtils.degToRad(CHARACTER_ROTATION_SPEED_DEGREES);
const holeProjection = new THREE.Vector3();
const holeCameraSpace = new THREE.Vector3();
const holeWorldPosition = new THREE.Vector3();

loadViewerModels(viewerScene, (message) => hud.setStatus(message));
hud.initialize(viewerScene.camera.position, incomingQuaternion);
hud.updateClubDebug(ACTIVE_CLUB_SET, activeClub);
initializeLaunchDebugUi();
initializeClubDebugUi();

const socket = new WebSocket(`${getWebSocketBaseUrl()}/ws?role=viewer`);
const controlSocket = new WebSocket(`${getWebSocketBaseUrl()}/ws/control?role=viewer`);
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

  const decodedSwingState = decodeSwingStatePacket(event.data, incomingQuaternion, incomingSwingState);
  if (!decodedSwingState) {
    return;
  }

  incomingSwingState.receivedAtTimeMs = performance.now();
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

controlSocket.addEventListener('message', (event) => {
  if (typeof event.data !== 'string') {
    return;
  }

  const controlMessage = decodeControlMessage(JSON.parse(event.data));
  if (!controlMessage) {
    return;
  }

  applyRemoteControl(controlMessage.action, controlMessage.active);
});

controlSocket.addEventListener('close', () => {
  rotateCharacterLeft = false;
  rotateCharacterRight = false;
});

window.addEventListener('resize', () => {
  viewerScene.resize();
  hud.updateCameraPosition(viewerScene.camera.position);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyF' && !event.repeat) {
    const freeCameraEnabled = viewerScene.setFreeCameraEnabled(!viewerScene.isFreeCameraEnabled());
    if (!freeCameraEnabled && document.pointerLockElement === dom.canvas) {
      document.exitPointerLock();
    }
    endFreeCameraLook();
    event.preventDefault();
    hud.setStatus(freeCameraEnabled ? 'Free camera enabled.' : 'Follow camera enabled.');
    return;
  }

  if (viewerScene.isFreeCameraEnabled()) {
    if (event.code === 'KeyW') {
      freeCameraMoveForward = true;
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyS') {
      freeCameraMoveBackward = true;
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyA') {
      freeCameraMoveLeft = true;
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyD') {
      freeCameraMoveRight = true;
      event.preventDefault();
      return;
    }
  }

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
    if (!LAUNCH_DEBUG_ENABLED || isTextEntryTarget(event.target)) {
      return;
    }

    launchDebugBallFromInput();
    return;
  }

  if (event.code === 'KeyR') {
    resetShotFlow();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyW') {
    freeCameraMoveForward = false;
    return;
  }

  if (event.code === 'KeyS') {
    freeCameraMoveBackward = false;
    return;
  }

  if (event.code === 'KeyA') {
    freeCameraMoveLeft = false;
    return;
  }

  if (event.code === 'KeyD') {
    freeCameraMoveRight = false;
    return;
  }

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
  freeCameraMoveForward = false;
  freeCameraMoveBackward = false;
  freeCameraMoveLeft = false;
  freeCameraMoveRight = false;
  endFreeCameraLook();
  if (document.pointerLockElement === dom.canvas) {
    document.exitPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === dom.canvas) {
    beginFreeCameraLook();
    return;
  }

  endFreeCameraLook();
});

dom.canvas.addEventListener('contextmenu', (event) => {
  if (!viewerScene.isFreeCameraEnabled()) {
    return;
  }

  event.preventDefault();
});

dom.canvas.addEventListener('mousedown', (event) => {
  if (!viewerScene.isFreeCameraEnabled() || event.button !== 2) {
    return;
  }

  if (dom.canvas.requestPointerLock) {
    dom.canvas.requestPointerLock();
  } else {
    beginFreeCameraLook(event.clientX, event.clientY);
  }
  event.preventDefault();
});

window.addEventListener('mouseup', (event) => {
  if (event.button !== 2) {
    return;
  }

  if (document.pointerLockElement === dom.canvas) {
    document.exitPointerLock();
    return;
  }

  endFreeCameraLook();
});

window.addEventListener('mousemove', (event) => {
  if (!viewerScene.isFreeCameraEnabled() || !freeCameraLookActive) {
    return;
  }

  if (document.pointerLockElement === dom.canvas) {
    viewerScene.rotateFreeCamera(event.movementX, event.movementY);
    return;
  }

  if (!hasFreeCameraFallbackPointerPosition) {
    hasFreeCameraFallbackPointerPosition = true;
    lastFreeCameraPointerClientX = event.clientX;
    lastFreeCameraPointerClientY = event.clientY;
    return;
  }

  viewerScene.rotateFreeCamera(
    event.clientX - lastFreeCameraPointerClientX,
    event.clientY - lastFreeCameraPointerClientY,
  );
  lastFreeCameraPointerClientX = event.clientX;
  lastFreeCameraPointerClientY = event.clientY;
});

animate();

function beginFreeCameraLook(pointerClientX = null, pointerClientY = null) {
  freeCameraLookActive = true;
  hasFreeCameraFallbackPointerPosition = Number.isFinite(pointerClientX) && Number.isFinite(pointerClientY);
  if (hasFreeCameraFallbackPointerPosition) {
    lastFreeCameraPointerClientX = pointerClientX;
    lastFreeCameraPointerClientY = pointerClientY;
  }
}

function endFreeCameraLook() {
  freeCameraLookActive = false;
  hasFreeCameraFallbackPointerPosition = false;
}

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
    if (!viewerScene.isFreeCameraEnabled()) {
      faceCameraTowardHole(ballTelemetry.position);
    }
    ballPhysics.prepareForNextShot();
    playerState = 'control';
    clubBallContactLatched = true;
    ballTelemetry = ballPhysics.getDebugTelemetry();
  }

  viewerScene.ballRoot.position.copy(ballPhysics.getPosition());
  viewerScene.ballRoot.quaternion.copy(ballPhysics.getOrientation());
  ballTrail.update(ballPhysics.getPosition(), trailTelemetry, deltaSeconds);
  viewerScene.updateFreeCamera(deltaSeconds, {
    forward: Number(freeCameraMoveForward) - Number(freeCameraMoveBackward),
    right: Number(freeCameraMoveRight) - Number(freeCameraMoveLeft),
  });
  viewerScene.updateBallFollowCamera(deltaSeconds);
  updateCharacterDebugTelemetry(characterTelemetry);
  updateBallDebugTelemetry(ballTelemetry);
  updateFpsIfNeeded();
  updatePacketRateIfNeeded();
  viewerScene.updateControls();
  viewerScene.applyCameraTilt();
  updateHoleMarker(ballTelemetry);
  updateCameraPositionLabelIfNeeded();
  viewerScene.renderer.render(viewerScene.scene, viewerScene.camera);
}

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function updateCharacterRotationInput(deltaSeconds) {
  if (viewerScene.isFreeCameraEnabled()) {
    return;
  }

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

function applyRemoteControl(action, active) {
  switch (action) {
    case CONTROL_ACTIONS.clubPrevious:
      if (active) {
        selectPreviousClub();
      }
      break;
    case CONTROL_ACTIONS.clubNext:
      if (active) {
        selectNextClub();
      }
      break;
    case CONTROL_ACTIONS.rotateLeft:
      rotateCharacterLeft = active;
      if (active) {
        rotateCharacterRight = false;
      }
      break;
    case CONTROL_ACTIONS.rotateRight:
      rotateCharacterRight = active;
      if (active) {
        rotateCharacterLeft = false;
      }
      break;
    default:
      break;
  }
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
  hud.updateGroundTransitionDebug(telemetry.groundTransitionDebug);
  hud.updateShotStates(playerState, telemetry.phase, telemetry.movementState);
  updateLaunchDebugUiState();
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

  const impact = resolveClubBallImpact(
    characterTelemetry,
    ballTelemetry.position,
    getIncomingClubHeadSpeedMetersPerSecond(),
    activeClub,
  );
  if (!impact) {
    return;
  }

  hud.updateLaunchPreview(getClubLaunchPreview(characterTelemetry, getIncomingClubHeadSpeedMetersPerSecond(), activeClub));
  launchBall(impact.launchData, impact.referenceForward, impact.impactSpeedMetersPerSecond);
  clubBallContactLatched = true;
}

function getIncomingClubHeadSpeedMetersPerSecond() {
  if (
    !Number.isFinite(incomingSwingState.perpendicularAngularSpeedRadiansPerSecond)
    || incomingSwingState.perpendicularAngularSpeedRadiansPerSecond <= 0
  ) {
    return 0;
  }

  const receiveAgeMilliseconds = incomingSwingState.receivedAtTimeMs > 0
    ? Math.max(performance.now() - incomingSwingState.receivedAtTimeMs, 0)
    : 65535;
  const totalAgeMilliseconds = incomingSwingState.motionAgeMilliseconds + receiveAgeMilliseconds;
  if (totalAgeMilliseconds > 250) {
    return 0;
  }

  const effectiveLengthMeters = Number.isFinite(activeClub?.effectiveLengthMeters)
    ? activeClub.effectiveLengthMeters
    : 0.9;
  return incomingSwingState.perpendicularAngularSpeedRadiansPerSecond
    * effectiveLengthMeters
    * PHONE_ANGULAR_SPEED_TO_CLUB_HEAD_SPEED_GAIN;
}

function launchBall(launchData, referenceForward, impactSpeedMetersPerSecond = null) {
  if (Math.abs(launchData.horizontalLaunchAngle) <= SHOT_AUDIO_PANGYA_MAX_HORIZONTAL_ANGLE_DEGREES) {
    shotImpactAudio.playPangya();
  }
  shotImpactAudio.playForImpactSpeed(
    getLaunchImpactSpeedMetersPerSecond(launchData, impactSpeedMetersPerSecond),
  );
  playerState = 'waiting';
  ballTrail.reset();
  ballPhysics.launch(launchData, referenceForward);
}

function getLaunchImpactSpeedMetersPerSecond(launchData, impactSpeedMetersPerSecond) {
  if (Number.isFinite(impactSpeedMetersPerSecond) && impactSpeedMetersPerSecond > 0) {
    return impactSpeedMetersPerSecond;
  }

  if (!Number.isFinite(launchData?.ballSpeed) || launchData.ballSpeed <= 0) {
    return 0;
  }

  const smashFactor = Number.isFinite(activeClub?.smashFactor)
    ? activeClub.smashFactor
    : 1.35;
  return launchData.ballSpeed / smashFactor;
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
  if (!viewerScene.isFreeCameraEnabled()) {
    faceCameraTowardHole(ballPhysics.getPosition());
  }
  playerState = 'control';
  clubBallContactLatched = true;
  updateLaunchDebugUiState();
}

function initializeLaunchDebugUi() {
  hud.updateLaunchPanelVisible(LAUNCH_DEBUG_ENABLED);

  if (!LAUNCH_DEBUG_ENABLED || !hasLaunchDebugInputs() || !dom.launchDebugButton || !dom.launchDebugMessage) {
    return;
  }

  for (const { key, inputKey } of LAUNCH_DEBUG_INPUT_FIELDS) {
    dom[inputKey].value = String(BALL_DEFAULT_LAUNCH_DATA[key]);
    dom[inputKey].addEventListener('input', () => {
      updateLaunchDebugUiState();
    });
  }

  dom.launchDebugButton.addEventListener('click', () => {
    launchDebugBallFromInput();
  });
  updateLaunchDebugUiState();
}

function initializeClubDebugUi() {
  if (!dom.clubPrevButton || !dom.clubNextButton) {
    return;
  }

  dom.clubPrevButton.addEventListener('click', () => {
    selectPreviousClub();
  });
  dom.clubNextButton.addEventListener('click', () => {
    selectNextClub();
  });
}

function selectPreviousClub() {
  moveActiveClub(1);
}

function selectNextClub() {
  moveActiveClub(-1);
}

function moveActiveClub(delta) {
  const clubIndex = ACTIVE_CLUB_SET.clubs.findIndex((club) => club.id === activeClub.id);
  const nextClubIndex = clubIndex >= 0
    ? Math.min(Math.max(clubIndex + delta, 0), ACTIVE_CLUB_SET.clubs.length - 1)
    : 0;
  activeClub = ACTIVE_CLUB_SET.clubs[nextClubIndex];
  hud.updateClubDebug(ACTIVE_CLUB_SET, activeClub);
}

function launchDebugBallFromInput() {
  if (!LAUNCH_DEBUG_ENABLED || !canLaunchDebugShot()) {
    updateLaunchDebugUiState();
    return;
  }

  const launchDebugInputState = getLaunchDebugInputState();
  if (!launchDebugInputState.launchData) {
    updateLaunchDebugUiState(launchDebugInputState.errorMessage);
    return;
  }

  launchBall(launchDebugInputState.launchData);
  updateLaunchDebugUiState('Debug shot launched. Wait for the ball to settle before launching again.');
}

function updateLaunchDebugUiState(statusMessage = null) {
  if (!LAUNCH_DEBUG_ENABLED || !hasLaunchDebugInputs() || !dom.launchDebugButton || !dom.launchDebugMessage) {
    return;
  }

  const launchDebugInputState = getLaunchDebugInputState();
  const canLaunch = canLaunchDebugShot() && Boolean(launchDebugInputState.launchData);

  for (const { inputKey } of LAUNCH_DEBUG_INPUT_FIELDS) {
    dom[inputKey].setAttribute('aria-invalid', String(Boolean(launchDebugInputState.errorMessage)));
  }
  dom.launchDebugButton.disabled = !canLaunch;

  if (statusMessage) {
    dom.launchDebugMessage.textContent = statusMessage;
    return;
  }

  if (launchDebugInputState.errorMessage) {
    dom.launchDebugMessage.textContent = launchDebugInputState.errorMessage;
    return;
  }

  if (!canLaunchDebugShot()) {
    dom.launchDebugMessage.textContent = 'Launch is available only while player control is active and the ball is ready.';
    return;
  }

  dom.launchDebugMessage.textContent = 'Edit the launch values, then click Launch or press L.';
}

function canLaunchDebugShot() {
  return playerState === 'control' && ballPhysics.getStateSnapshot().phase === 'ready';
}

function getLaunchDebugInputState() {
  if (!LAUNCH_DEBUG_ENABLED || !hasLaunchDebugInputs()) {
    return { launchData: null, errorMessage: '' };
  }

  const launchData = { ...BALL_DEFAULT_LAUNCH_DATA };
  for (const { key, inputKey } of LAUNCH_DEBUG_INPUT_FIELDS) {
    const rawValue = dom[inputKey].value.trim();
    if (!rawValue) {
      return { launchData: null, errorMessage: `Launch field "${key}" is required.` };
    }

    const fieldValue = Number(rawValue);
    if (!Number.isFinite(fieldValue)) {
      return { launchData: null, errorMessage: `Launch field "${key}" must be a finite number.` };
    }

    launchData[key] = fieldValue;
  }

  if (launchData.ballSpeed <= 0) {
    return { launchData: null, errorMessage: 'Launch field "ballSpeed" must be greater than 0.' };
  }

  return { launchData, errorMessage: '' };
}

function hasLaunchDebugInputs() {
  return LAUNCH_DEBUG_INPUT_FIELDS.every(({ inputKey }) => Boolean(dom[inputKey]));
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT';
}

function faceCameraTowardHole(ballPosition) {
  const holeMarker = viewerScene.getHoleMarker();
  if (!holeMarker) {
    return;
  }

  holeMarker.beamRoot.updateWorldMatrix(true, false);
  holeMarker.beamRoot.getWorldPosition(holeWorldPosition);
  viewerScene.faceViewToward(ballPosition, holeWorldPosition);
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

function updateHoleMarker(ballTelemetry) {
  const holeMarker = viewerScene.getHoleMarker();
  if (!holeMarker) {
    return;
  }

  holeMarker.beamRoot.updateWorldMatrix(true, false);
  holeMarker.beamRoot.getWorldPosition(holeWorldPosition);

  const ballPosition = ballTelemetry.position;
  const horizontalDistanceMeters = Math.hypot(
    holeWorldPosition.x - ballPosition.x,
    holeWorldPosition.z - ballPosition.z,
  );
  const heightDeltaMeters = holeWorldPosition.y - ballPosition.y;

  if (ballTelemetry.phase === 'moving') {
    holeMarker.setMoveModeLabelText(
      formatDistanceYards(ballTelemetry.shotTravelDistanceMeters),
      formatDistanceYards(horizontalDistanceMeters),
    );
    holeMarker.setMoveModeLabelVisible(true);
    holeMarker.setLabelVisible(false);
    return;
  }

  holeMarker.setMoveModeLabelVisible(false);

  holeMarker.setLabelText(
    formatHeightDeltaMeters(heightDeltaMeters),
    formatDistanceYards(horizontalDistanceMeters),
  );

  holeCameraSpace.copy(holeWorldPosition).applyMatrix4(viewerScene.camera.matrixWorldInverse);
  if (holeCameraSpace.z >= 0) {
    holeMarker.setLabelVisible(false);
    return;
  }

  holeProjection.copy(holeWorldPosition).project(viewerScene.camera);
  const horizontalPaddingNdc = (HOLE_MARKER_LABEL_EDGE_PADDING_PX / window.innerWidth) * 2;
  const clampedProjectionX = THREE.MathUtils.clamp(
    holeProjection.x,
    -1 + horizontalPaddingNdc,
    1 - horizontalPaddingNdc,
  );
  const overlayHeightAtDepth = 2 * Math.tan(THREE.MathUtils.degToRad(viewerScene.camera.fov * 0.5)) * HOLE_MARKER_LABEL_DEPTH;
  const overlayWidthAtDepth = overlayHeightAtDepth * viewerScene.camera.aspect;
  const overlayY = (1 - (HOLE_MARKER_LABEL_TOP_OFFSET_RATIO * 2)) * overlayHeightAtDepth * 0.5;

  holeMarker.setLabelOverlayPosition(
    clampedProjectionX * overlayWidthAtDepth * 0.5,
    overlayY,
    -HOLE_MARKER_LABEL_DEPTH,
  );
  holeMarker.setLabelVisible(true);
}

function updateCameraPositionLabelIfNeeded() {
  const now = performance.now();
  if (now - lastCameraLabelUpdateTime < CAMERA_LABEL_UPDATE_INTERVAL_MS) {
    return;
  }

  hud.updateCameraPosition(viewerScene.camera.position);
  lastCameraLabelUpdateTime = now;
}