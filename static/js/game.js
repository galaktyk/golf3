import * as THREE from 'three';
import { CONTROL_ACTIONS, decodeControlMessage, decodeJoystickMessage, decodeSwingStatePacket } from '/static/js/protocol.js';
import {
  AIMING_CAMERA_ENTRY_MIN_MAGNITUDE,
  AIMING_CAMERA_ENTRY_VERTICAL_TOLERANCE_DEGREES,
  AIMING_MARKER_PIXEL_HEIGHT,
  AIMING_PREVIEW_HEAD_SPEED_ANALOG_RESPONSE_EXPONENT,
  AIMING_PREVIEW_HEAD_SPEED_ANALOG_RAMP_SECONDS,
  AIMING_PREVIEW_HEAD_SPEED_ADJUST_MAX_RATE_METERS_PER_SECOND,
  AIMING_PREVIEW_HEAD_SPEED_ADJUST_MIN_RATE_METERS_PER_SECOND,
  AIMING_PREVIEW_HEAD_SPEED_ADJUST_RAMP_SECONDS,
  AIMING_ROTATION_DISTANCE_MAX_MULTIPLIER,
  AIMING_ROTATION_DISTANCE_MIN_MULTIPLIER,
  AIMING_ROTATION_DISTANCE_REFERENCE_METERS,
  AIMING_PREVIEW_HEAD_SPEED_MAX_METERS_PER_SECOND,
  AIMING_PREVIEW_HEAD_SPEED_MIN_METERS_PER_SECOND,
  AIMING_PREVIEW_HEAD_SPEED_METERS_PER_SECOND,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_ROLLING_RESISTANCE,
  BALL_DEFAULT_LAUNCH_DATA,
  BALL_RADIUS,
  CAMERA_LABEL_UPDATE_INTERVAL_MS,
  CHARACTER_ROTATION_ANALOG_RESPONSE_EXPONENT,
  CHARACTER_ROTATION_ACCELERATION_MAX_MULTIPLIER,
  CHARACTER_ROTATION_ACCELERATION_MIN_MULTIPLIER,
  CHARACTER_ROTATION_ACCELERATION_RAMP_SECONDS,
  CHARACTER_ROTATION_SPEED_DEGREES,
  CLUB_HEAD_CONTACT_RELEASE_DISTANCE,
  CLUB_SWING_WHOOSH_COOLDOWN_MS,
  CLUB_SWING_WHOOSH_MIN_SPEED,
  CLUB_SWING_WHOOSH_REARM_SPEED,
  COURSE_HOLE_POSITION,
  FPS_LABEL_UPDATE_INTERVAL_MS,
  HOLE_MARKER_LABEL_DEPTH,
  HOLE_MARKER_LABEL_EDGE_PADDING_PX,
  HOLE_MARKER_LABEL_TOP_OFFSET_RATIO,
  PHONE_ANGULAR_SPEED_TO_CLUB_HEAD_SPEED_GAIN,
  REMOTE_CONTROL_INPUT_SMOOTHING,
  REMOTE_CONTROL_INPUT_SNAP_EPSILON,
  SHOT_AUDIO_PANGYA_MAX_HORIZONTAL_ANGLE_DEGREES,
} from '/static/js/game/constants.js';
import { ACTIVE_CLUB, ACTIVE_CLUB_SET } from '/static/js/game/clubData.js';
import { buildPuttGridPreview, predictFirstContactPoint } from '/static/js/game/aimPreview.js';
import { createBallPhysics } from '/static/js/game/ballPhysics.js';
import { createBallTrail } from '/static/js/game/ballTrail.js';
import { raycastCourseSurface, sampleCourseSurface } from '/static/js/game/collision.js';
import { getViewerDom } from '/static/js/game/dom.js';
import { formatDistanceYards, formatHeightDeltaMeters, formatMetersPerSecond } from '/static/js/game/formatting.js';
import { createViewerHud } from '/static/js/game/hud.js';
import { getNeutralClubLaunchPreview, resolveClubBallImpact } from '/static/js/game/impact/clubImpact.js';
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
const DEBUG_UI_ENABLED = DEBUG_PARAMS.get('debug') === 'true';
console.log(`Debug UI enabled: ${DEBUG_UI_ENABLED}`);
const LAUNCH_DEBUG_INPUT_FIELDS = [
  { key: 'ballSpeed', inputKey: 'launchBallSpeedInput' },
  { key: 'verticalLaunchAngle', inputKey: 'launchVerticalAngleInput' },
  { key: 'horizontalLaunchAngle', inputKey: 'launchHorizontalAngleInput' },
  { key: 'spinSpeed', inputKey: 'launchSpinSpeedInput' },
  { key: 'spinAxis', inputKey: 'launchSpinAxisInput' },
];
document.body.classList.toggle('viewer-debug-enabled', DEBUG_UI_ENABLED);
const dom = getViewerDom();
const viewerScene = createViewerScene(dom.canvas);
const hud = createViewerHud(dom);
const character = loadCharacter(viewerScene, (message) => hud.setStatus(message));
const ballPhysics = createBallPhysics(viewerScene);
const ballTrail = createBallTrail(BALL_RADIUS);
const shotImpactAudio = createShotImpactAudio();
const practiceSwingBallColor = new THREE.Color('#31e0ff');
const PRACTICE_SWING_BALL_OPACITY = 0.26;
const ballMaterialVisualState = new WeakMap();
const AIMING_TARGET_DISTANCE_MIN_METERS = 0.25;
const AIMING_TARGET_DISTANCE_MAX_METERS = 999;
const AIMING_TARGET_RESET_HOLE_DISTANCE_SCALE = 0.95;
const PUTT_AIM_DISTANCE_ADJUST_MIN_RATE_METERS_PER_SECOND = 0.25;
const PUTT_AIM_DISTANCE_ADJUST_MAX_RATE_METERS_PER_SECOND = 18;
const PUTT_PREVIEW_SPEED_BIAS_METERS_PER_SECOND = 0.15;
const PUTT_PREVIEW_UPHILL_SPEED_PER_METER = 1.8;
const PUTT_PREVIEW_DOWNHILL_SPEED_PER_METER = 0.8;
const PUTT_PREVIEW_MIN_BALL_SPEED_METERS_PER_SECOND = 0.05;
const PUTT_PREVIEW_GRAVITY_ACCELERATION = 9.81;
const PUTT_PREVIEW_EFFECTIVE_ROLL_FRICTION_MULTIPLIER = 6;
const PUTT_AIM_HOLE_CLAMP_MARGIN_METERS = Math.max(BALL_RADIUS * 2, 0.08);
const PUTT_AIM_HOLE_ALIGNMENT_TOLERANCE_METERS = Math.max(BALL_RADIUS * 3.5, 0.14);

viewerScene.scene.add(ballTrail.root);

let hasIncomingOrientation = false;
let lastCameraLabelUpdateTime = 0;
let lastFpsSampleTime = performance.now();
let lastPacketSampleTime = performance.now();
let packetsSinceLastSample = 0;
let framesSinceLastSample = 0;
let playerState = 'control';
let clubBallContactLatched = true;
let clubWhooshLatched = false;
let lastClubWhooshTimeMs = -Infinity;
let activeClub = ACTIVE_CLUB;
let practiceSwingMode = false;
let rotateCharacterLeft = false;
let rotateCharacterRight = false;
let increaseAimingPreviewHeadSpeed = false;
let decreaseAimingPreviewHeadSpeed = false;
let remoteJoystickX = 0;
let remoteJoystickY = 0;
let remoteJoystickTargetX = 0;
let remoteJoystickTargetY = 0;
let freeCameraMoveForward = false;
let freeCameraMoveBackward = false;
let freeCameraMoveLeft = false;
let freeCameraMoveRight = false;
let freeCameraLookActive = false;
let hasFreeCameraFallbackPointerPosition = false;
let lastFreeCameraPointerClientX = 0;
let lastFreeCameraPointerClientY = 0;
let hasCursorPointerPosition = false;
let lastCursorPointerClientX = 0;
let lastCursorPointerClientY = 0;
let aimingPreviewHeadSpeedMetersPerSecond = AIMING_PREVIEW_HEAD_SPEED_METERS_PER_SECOND;
let aimingTargetDistanceMeters = 5;
let puttAimDistanceMeters = 5;
let characterRotationHoldSeconds = 0;
let characterRotationDirection = 0;
let aimingPreviewHeadSpeedHoldSeconds = 0;
let aimingPreviewHeadSpeedDirection = 0;
let aimingPreviewHeadSpeedAnalogHoldSeconds = 0;
let aimingPreviewHeadSpeedAnalogDirection = 0;
let practiceSwingBallVisualDirty = true;
let practiceSwingBallVisualChildCount = -1;

const CHARACTER_ROTATION_SPEED_RADIANS = THREE.MathUtils.degToRad(CHARACTER_ROTATION_SPEED_DEGREES);
const AIMING_CAMERA_ENTRY_VERTICAL_TOLERANCE_RADIANS = THREE.MathUtils.degToRad(
  AIMING_CAMERA_ENTRY_VERTICAL_TOLERANCE_DEGREES,
);
const holeProjection = new THREE.Vector3();
const holeCameraSpace = new THREE.Vector3();
const holeWorldPosition = new THREE.Vector3();
const cursorRaycaster = new THREE.Raycaster();
const cursorRayNdc = new THREE.Vector2();
const aimingMarkerCameraSpace = new THREE.Vector3();
const aimingPreviewLandingPoint = new THREE.Vector3();
const aimingPreviewTargetProbePoint = new THREE.Vector3();
const aimingPreviewTargetForward = new THREE.Vector3();
const aimingPreviewTargetLateralOffset = new THREE.Vector3();
const characterForwardForPreview = new THREE.Vector3();
const puttHoleOffset = new THREE.Vector3();
const aimingPreview = {
  dirty: true,
  isVisible: false,
  carryDistanceMeters: 0,
  hasTargetPoint: false,
  mode: 'landing',
  puttGrid: null,
};

loadViewerModels(viewerScene, (message) => hud.setStatus(message));
hud.initialize(viewerScene.camera.position, incomingQuaternion);
hud.updateClubDebug(ACTIVE_CLUB_SET, activeClub);
syncPuttAimDistanceToHole();
syncSwingPreviewTarget();
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

  const payload = JSON.parse(event.data);
  const joystickMessage = decodeJoystickMessage(payload);
  if (joystickMessage) {
    applyRemoteJoystickInput(joystickMessage.x, joystickMessage.y);
    return;
  }

  const controlMessage = decodeControlMessage(payload);
  if (!controlMessage) {
    return;
  }

  applyRemoteControl(controlMessage.action, controlMessage.active, controlMessage.value);
});

controlSocket.addEventListener('close', () => {
  resetRemoteJoystickInput();
  if (!rotateCharacterLeft && !rotateCharacterRight) {
    resetCharacterRotationAcceleration();
  }
  if (!increaseAimingPreviewHeadSpeed && !decreaseAimingPreviewHeadSpeed) {
    resetAimingPreviewHeadSpeedAcceleration();
  }
});

window.addEventListener('resize', () => {
  viewerScene.resize();
  hud.updateCameraPosition(viewerScene.camera.position);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyG' && event.altKey && !event.repeat) {
    event.preventDefault();
    warpBallToMousePosition();
    return;
  }

  if (event.code === 'KeyF' && !event.repeat) {
    const freeCameraEnabled = viewerScene.setFreeCameraEnabled(!viewerScene.isFreeCameraEnabled());
    rotateCharacterLeft = false;
    rotateCharacterRight = false;
    resetCharacterRotationAcceleration();
    increaseAimingPreviewHeadSpeed = false;
    decreaseAimingPreviewHeadSpeed = false;
    resetAimingPreviewHeadSpeedAcceleration();
    freeCameraMoveForward = false;
    freeCameraMoveBackward = false;
    freeCameraMoveLeft = false;
    freeCameraMoveRight = false;
    if (!freeCameraEnabled && document.pointerLockElement === dom.canvas) {
      document.exitPointerLock();
    }
    endFreeCameraLook();
    event.preventDefault();
    hud.setStatus(freeCameraEnabled ? 'Free camera enabled.' : getGameplayCameraStatusMessage());
    return;
  }

  if (event.code === 'Space' && !event.repeat) {
    if (isTextEntryTarget(event.target) || viewerScene.isFreeCameraEnabled()) {
      return;
    }

    if (toggleAimingCamera()) {
      event.preventDefault();
    }
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
    if (viewerScene.isFreeCameraEnabled()) {
      event.preventDefault();
      return;
    }

    if (event.code === 'ArrowLeft') {
      rotateCharacterLeft = true;
    } else {
      rotateCharacterRight = true;
    }

    event.preventDefault();
    return;
  }

  if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
    if (isTextEntryTarget(event.target)) {
      return;
    }

    if (viewerScene.isFreeCameraEnabled()) {
      event.preventDefault();
      return;
    }

    if (!canUseAimingControls()) {
      event.preventDefault();
      return;
    }

    const aimingWasEnabled = viewerScene.isAimingCameraEnabled();
    viewerScene.setAimingCameraEnabled(true);
    let shouldResetHeadSpeedAcceleration = !event.repeat;
    if (event.code === 'ArrowUp') {
      shouldResetHeadSpeedAcceleration = shouldResetHeadSpeedAcceleration || decreaseAimingPreviewHeadSpeed;
      increaseAimingPreviewHeadSpeed = true;
      decreaseAimingPreviewHeadSpeed = false;
    } else {
      shouldResetHeadSpeedAcceleration = shouldResetHeadSpeedAcceleration || increaseAimingPreviewHeadSpeed;
      decreaseAimingPreviewHeadSpeed = true;
      increaseAimingPreviewHeadSpeed = false;
    }
    if (shouldResetHeadSpeedAcceleration) {
      resetAimingPreviewHeadSpeedAcceleration();
    }
    if (!aimingWasEnabled) {
      hud.setStatus(getGameplayCameraStatusMessage());
    }
    event.preventDefault();
    return;
  }

  if (event.repeat) {
    return;
  }

  if (event.code === 'KeyL') {
    if (!DEBUG_UI_ENABLED || isTextEntryTarget(event.target)) {
      return;
    }

    launchDebugBallFromInput();
    return;
  }

  if (event.code === 'KeyR') {
    resetShotFlow();
    event.preventDefault();
    return;
  }

  if (event.code === 'KeyP') {
    if (isTextEntryTarget(event.target)) {
      return;
    }

    togglePracticeSwingMode();
    event.preventDefault();
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
    resetCharacterRotationAcceleration();
    event.preventDefault();
    return;
  }

  if (event.code === 'ArrowRight') {
    rotateCharacterRight = false;
    resetCharacterRotationAcceleration();
    event.preventDefault();
    return;
  }

  if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
    if (event.code === 'ArrowUp') {
      increaseAimingPreviewHeadSpeed = false;
    } else {
      decreaseAimingPreviewHeadSpeed = false;
    }
    resetAimingPreviewHeadSpeedAcceleration();
    event.preventDefault();
  }
});

window.addEventListener('blur', () => {
  rotateCharacterLeft = false;
  rotateCharacterRight = false;
  resetCharacterRotationAcceleration();
  increaseAimingPreviewHeadSpeed = false;
  decreaseAimingPreviewHeadSpeed = false;
  resetAimingPreviewHeadSpeedAcceleration();
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
  rememberCursorPointerPosition(event.clientX, event.clientY);

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

/**
 * Keeps the last visible mouse position available so debug movement can raycast from the cursor.
 */
function rememberCursorPointerPosition(clientX, clientY) {
  hasCursorPointerPosition = Number.isFinite(clientX) && Number.isFinite(clientY);
  if (!hasCursorPointerPosition) {
    return;
  }

  lastCursorPointerClientX = clientX;
  lastCursorPointerClientY = clientY;
}

function animate() {
  requestAnimationFrame(animate);

  const deltaSeconds = animationClock.getDelta();
  framesSinceLastSample += 1;
  updateRemoteControlInput(deltaSeconds);
  updateCharacterRotationInput(deltaSeconds);
  updateAimingPreviewHeadSpeedInput(deltaSeconds);
  character.update(deltaSeconds, hasIncomingOrientation ? incomingQuaternion : null);
  const characterTelemetry = character.getDebugTelemetry();
  updateAimingPreviewIfNeeded();
  updateClubWhooshAudio();
  detectClubBallImpact(characterTelemetry);
  ballPhysics.update(deltaSeconds);
  let ballTelemetry = ballPhysics.getDebugTelemetry();
  const trailTelemetry = ballTelemetry;

  if (playerState === 'waiting' && ballPhysics.consumeShotSettled()) {
    viewerScene.positionCharacterForBall(ballTelemetry.position);
    if (!viewerScene.isFreeCameraEnabled()) {
      viewerScene.setAimingCameraEnabled(false);
      faceCameraTowardHole(ballTelemetry.position);
    }
    ballPhysics.prepareForNextShot();
    playerState = 'control';
    clubBallContactLatched = true;
    ballTelemetry = ballPhysics.getDebugTelemetry();
    syncPuttAimDistanceToHole(ballTelemetry.position);
    hud.updateSwingPreviewCapture(null, getCurrentAimingPreviewHeadSpeed(ballTelemetry.position));
    invalidateAimingPreview();
  }

  viewerScene.ballRoot.position.copy(ballPhysics.getPosition());
  viewerScene.ballRoot.quaternion.copy(ballPhysics.getOrientation());
  syncPracticeSwingBallVisualState();
  ballTrail.update(ballPhysics.getPosition(), trailTelemetry, deltaSeconds);
  viewerScene.updateFreeCamera(deltaSeconds, {
    forward: Number(freeCameraMoveForward) - Number(freeCameraMoveBackward),
    right: Number(freeCameraMoveRight) - Number(freeCameraMoveLeft),
  });
  viewerScene.updateBallFollowCamera(deltaSeconds, aimingPreview.isVisible
    ? { isVisible: aimingPreview.hasTargetPoint, point: aimingPreview.hasTargetPoint ? aimingPreviewLandingPoint : null }
    : { isVisible: false, point: null });
  updateCharacterDebugTelemetry(characterTelemetry);
  updateBallDebugTelemetry(ballTelemetry);
  updateFpsIfNeeded();
  updatePacketRateIfNeeded();
  viewerScene.updateControls();
  viewerScene.applyCameraTilt();
  updateHoleMarker(ballTelemetry);
  updateAimingMarker(ballTelemetry);
  updateCameraPositionLabelIfNeeded();
  viewerScene.renderer.render(viewerScene.scene, viewerScene.camera);
}

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function updateCharacterRotationInput(deltaSeconds) {
  if (viewerScene.isFreeCameraEnabled()) {
    resetCharacterRotationAcceleration();
    return;
  }

  if (!canUseAimingControls()) {
    resetCharacterRotationAcceleration();
    return;
  }

  const keyboardRotationDirection = getKeyboardRotationInputDirection();
  const remoteRotationDirection = getRemoteRotationInputDirection();
  const rotationDirection = keyboardRotationDirection !== 0 ? keyboardRotationDirection : remoteRotationDirection;
  if (rotationDirection === 0) {
    resetCharacterRotationAcceleration();
    return;
  }

  let rotationSpeedMultiplier = 1;
  if (keyboardRotationDirection !== 0) {
    if (rotationDirection !== characterRotationDirection) {
      characterRotationDirection = rotationDirection;
      characterRotationHoldSeconds = 0;
    } else {
      characterRotationHoldSeconds += deltaSeconds;
    }

    rotationSpeedMultiplier = getCharacterRotationAccelerationMultiplier(characterRotationHoldSeconds);
  } else {
    characterRotationDirection = rotationDirection;
    characterRotationHoldSeconds = 0;
    rotationSpeedMultiplier = getAnalogResponseMagnitude(
      Math.abs(rotationDirection),
      CHARACTER_ROTATION_ANALOG_RESPONSE_EXPONENT,
    );
  }

  const aimingRotationDistanceMultiplier = getAimingRotationDistanceMultiplier();
  const rotationRadians = rotationDirection
    * CHARACTER_ROTATION_SPEED_RADIANS
    * rotationSpeedMultiplier
    * aimingRotationDistanceMultiplier
    * deltaSeconds;

  viewerScene.rotateCharacterAroundBall(
    ballPhysics.getPosition(),
    rotationRadians,
  );
  viewerScene.orbitNormalCameraAroundBall(
    ballPhysics.getPosition(),
    rotationRadians,
  );
  invalidateAimingPreview();

}

/**
 * Converts held up/down input into either a head-speed change or a putt target-distance change.
 * Keyboard input may still enter aim mode directly, while phone joystick input only adjusts after a double-tap toggle.
 */
function updateAimingPreviewHeadSpeedInput(deltaSeconds) {
  if (viewerScene.isFreeCameraEnabled()) {
    resetAimingPreviewHeadSpeedAcceleration();
    resetAimingPreviewHeadSpeedAnalogAcceleration();
    return;
  }

  if (!canUseAimingControls()) {
    resetAimingPreviewHeadSpeedAcceleration();
    resetAimingPreviewHeadSpeedAnalogAcceleration();
    return;
  }

  const keyboardHeadSpeedDirection = getKeyboardAimingPreviewHeadSpeedInputDirection();
  const remoteHeadSpeedDirection = getRemoteAimingPreviewHeadSpeedInputDirection();
  const isKeyboardInputActive = keyboardHeadSpeedDirection !== 0;
  const isRemoteAimEntryActive = !isKeyboardInputActive && isRemoteAimEntryGestureActive();
  const headSpeedDirection = isKeyboardInputActive ? keyboardHeadSpeedDirection : remoteHeadSpeedDirection;
  if (headSpeedDirection === 0) {
    resetAimingPreviewHeadSpeedAcceleration();
    resetAimingPreviewHeadSpeedAnalogAcceleration();
    return;
  }

  if (!viewerScene.isAimingCameraEnabled()) {
    if (!isKeyboardInputActive && !isRemoteAimEntryActive) {
      resetAimingPreviewHeadSpeedAnalogAcceleration();
      return;
    }

    viewerScene.setAimingCameraEnabled(true);
    hud.setStatus(getGameplayCameraStatusMessage());
  }

  const useLaunchPreview = usesLaunchAimingPreview();
  let adjustmentRate = useLaunchPreview
    ? AIMING_PREVIEW_HEAD_SPEED_ADJUST_MIN_RATE_METERS_PER_SECOND
    : PUTT_AIM_DISTANCE_ADJUST_MIN_RATE_METERS_PER_SECOND;
  if (isKeyboardInputActive) {
    resetAimingPreviewHeadSpeedAnalogAcceleration();
    if (headSpeedDirection !== aimingPreviewHeadSpeedDirection) {
      aimingPreviewHeadSpeedDirection = headSpeedDirection;
      aimingPreviewHeadSpeedHoldSeconds = 0;
    } else {
      aimingPreviewHeadSpeedHoldSeconds += deltaSeconds;
    }

    adjustmentRate = useLaunchPreview
      ? getAimingPreviewHeadSpeedAdjustmentRate(aimingPreviewHeadSpeedHoldSeconds)
      : getPuttAimDistanceAdjustmentRate(aimingPreviewHeadSpeedHoldSeconds);
  } else {
    resetAimingPreviewHeadSpeedAcceleration();
    adjustmentRate = useLaunchPreview
      ? getAnalogAimingPreviewHeadSpeedAdjustmentRate(headSpeedDirection, deltaSeconds)
      : getAnalogPuttAimDistanceAdjustmentRate(headSpeedDirection, deltaSeconds);
  }

  const previewDelta = headSpeedDirection * adjustmentRate * deltaSeconds;
  if (useLaunchPreview) {
    adjustAimingPreviewHeadSpeed(previewDelta);
    return;
  }

  adjustPuttAimDistance(previewDelta);
}

/**
 * Clears the hold-duration state so tap-versus-hold acceleration always restarts cleanly.
 */
function resetCharacterRotationAcceleration() {
  characterRotationHoldSeconds = 0;
  characterRotationDirection = 0;
}

/**
 * Clears held up/down acceleration so the next tap starts from the fine-adjustment rate.
 */
function resetAimingPreviewHeadSpeedAcceleration() {
  aimingPreviewHeadSpeedHoldSeconds = 0;
  aimingPreviewHeadSpeedDirection = 0;
}

/**
 * Clears the mobile analog hold state so the next joystick pull starts from the precise initial adjustment rate.
 */
function resetAimingPreviewHeadSpeedAnalogAcceleration() {
  aimingPreviewHeadSpeedAnalogHoldSeconds = 0;
  aimingPreviewHeadSpeedAnalogDirection = 0;
}

/**
 * Ramps rotation speed from a precise tap speed into a faster sustained turn while the input is held.
 */
function getCharacterRotationAccelerationMultiplier(holdSeconds) {
  const holdAlpha = CHARACTER_ROTATION_ACCELERATION_RAMP_SECONDS > 1e-8
    ? THREE.MathUtils.clamp(holdSeconds / CHARACTER_ROTATION_ACCELERATION_RAMP_SECONDS, 0, 1)
    : 1;
  return THREE.MathUtils.lerp(
    CHARACTER_ROTATION_ACCELERATION_MIN_MULTIPLIER,
    CHARACTER_ROTATION_ACCELERATION_MAX_MULTIPLIER,
    holdAlpha,
  );
}

/**
 * Scales aiming rotation by preview carry distance so near and far landing points shift more consistently.
 */
function getAimingRotationDistanceMultiplier() {
  if (!viewerScene.isAimingCameraEnabled() || !aimingPreview.isVisible) {
    return 1;
  }

  const carryDistanceMeters = Math.max(aimingPreview.carryDistanceMeters, 1);
  return THREE.MathUtils.clamp(
    AIMING_ROTATION_DISTANCE_REFERENCE_METERS / carryDistanceMeters,
    AIMING_ROTATION_DISTANCE_MIN_MULTIPLIER,
    AIMING_ROTATION_DISTANCE_MAX_MULTIPLIER,
  );
}

/**
 * Ramps the aiming-preview head-speed change rate from a small nudge into a faster hold adjustment.
 */
function getAimingPreviewHeadSpeedAdjustmentRate(holdSeconds) {
  const holdAlpha = AIMING_PREVIEW_HEAD_SPEED_ADJUST_RAMP_SECONDS > 1e-8
    ? THREE.MathUtils.clamp(holdSeconds / AIMING_PREVIEW_HEAD_SPEED_ADJUST_RAMP_SECONDS, 0, 1)
    : 1;
  return THREE.MathUtils.lerp(
    AIMING_PREVIEW_HEAD_SPEED_ADJUST_MIN_RATE_METERS_PER_SECOND,
    AIMING_PREVIEW_HEAD_SPEED_ADJUST_MAX_RATE_METERS_PER_SECOND,
    holdAlpha,
  );
}

/**
 * Ramps putt target-distance changes from fine nudges into faster sweeps while the input stays held.
 */
function getPuttAimDistanceAdjustmentRate(holdSeconds) {
  const holdAlpha = AIMING_PREVIEW_HEAD_SPEED_ADJUST_RAMP_SECONDS > 1e-8
    ? THREE.MathUtils.clamp(holdSeconds / AIMING_PREVIEW_HEAD_SPEED_ADJUST_RAMP_SECONDS, 0, 1)
    : 1;
  return THREE.MathUtils.lerp(
    PUTT_AIM_DISTANCE_ADJUST_MIN_RATE_METERS_PER_SECOND,
    PUTT_AIM_DISTANCE_ADJUST_MAX_RATE_METERS_PER_SECOND,
    holdAlpha,
  );
}

/**
 * Applies a dedicated ramp for mobile analog input so small stick holds stay precise while sustained larger pulls can still speed up.
 */
function getAnalogAimingPreviewHeadSpeedAdjustmentRate(headSpeedDirection, deltaSeconds) {
  const analogDirection = Math.sign(headSpeedDirection);
  if (analogDirection !== aimingPreviewHeadSpeedAnalogDirection) {
    aimingPreviewHeadSpeedAnalogDirection = analogDirection;
    aimingPreviewHeadSpeedAnalogHoldSeconds = 0;
  } else {
    aimingPreviewHeadSpeedAnalogHoldSeconds += deltaSeconds;
  }

  const targetRate = THREE.MathUtils.lerp(
    AIMING_PREVIEW_HEAD_SPEED_ADJUST_MIN_RATE_METERS_PER_SECOND,
    AIMING_PREVIEW_HEAD_SPEED_ADJUST_MAX_RATE_METERS_PER_SECOND,
    getAnalogResponseMagnitude(
      Math.abs(headSpeedDirection),
      AIMING_PREVIEW_HEAD_SPEED_ANALOG_RESPONSE_EXPONENT,
    ),
  );
  const rampAlpha = AIMING_PREVIEW_HEAD_SPEED_ANALOG_RAMP_SECONDS > 1e-8
    ? THREE.MathUtils.clamp(
      aimingPreviewHeadSpeedAnalogHoldSeconds / AIMING_PREVIEW_HEAD_SPEED_ANALOG_RAMP_SECONDS,
      0,
      1,
    )
    : 1;

  return THREE.MathUtils.lerp(
    AIMING_PREVIEW_HEAD_SPEED_ADJUST_MIN_RATE_METERS_PER_SECOND,
    targetRate,
    rampAlpha,
  );
}

/**
 * Applies the same analog hold behavior to putt target distance so mobile aiming stays consistent across club types.
 */
function getAnalogPuttAimDistanceAdjustmentRate(headSpeedDirection, deltaSeconds) {
  const analogDirection = Math.sign(headSpeedDirection);
  if (analogDirection !== aimingPreviewHeadSpeedAnalogDirection) {
    aimingPreviewHeadSpeedAnalogDirection = analogDirection;
    aimingPreviewHeadSpeedAnalogHoldSeconds = 0;
  } else {
    aimingPreviewHeadSpeedAnalogHoldSeconds += deltaSeconds;
  }

  const targetRate = THREE.MathUtils.lerp(
    PUTT_AIM_DISTANCE_ADJUST_MIN_RATE_METERS_PER_SECOND,
    PUTT_AIM_DISTANCE_ADJUST_MAX_RATE_METERS_PER_SECOND,
    getAnalogResponseMagnitude(
      Math.abs(headSpeedDirection),
      AIMING_PREVIEW_HEAD_SPEED_ANALOG_RESPONSE_EXPONENT,
    ),
  );
  const rampAlpha = AIMING_PREVIEW_HEAD_SPEED_ANALOG_RAMP_SECONDS > 1e-8
    ? THREE.MathUtils.clamp(
      aimingPreviewHeadSpeedAnalogHoldSeconds / AIMING_PREVIEW_HEAD_SPEED_ANALOG_RAMP_SECONDS,
      0,
      1,
    )
    : 1;

  return THREE.MathUtils.lerp(
    PUTT_AIM_DISTANCE_ADJUST_MIN_RATE_METERS_PER_SECOND,
    targetRate,
    rampAlpha,
  );
}

/**
 * Returns whether the player can currently change the gameplay aiming state.
 */
function canUseAimingControls() {
  return playerState === 'control' && ballPhysics.getStateSnapshot().phase === 'ready';
}

/**
 * Returns whether the current club uses the neutral launch preview instead of the putt slope grid.
 */
function usesLaunchAimingPreview() {
  return activeClub?.category !== 'putter';
}

/**
 * Keeps practice mode in the viewer layer so practice swings can reuse impact math without entering physics.
 */
function togglePracticeSwingMode() {
  return setPracticeSwingMode(!practiceSwingMode);
}

/**
 * Applies an explicit swing mode so remote UI buttons can select practice or actual play directly.
 */
function setPracticeSwingMode(enabled) {
  const shouldEnablePracticeMode = Boolean(enabled);
  if (shouldEnablePracticeMode && !canUseAimingControls()) {
    hud.setStatus('Practice swing mode is available only while the ball is ready.');
    return false;
  }

  practiceSwingMode = shouldEnablePracticeMode;
  practiceSwingBallVisualDirty = true;
  syncPracticeSwingBallVisualState();
  hud.setStatus(shouldEnablePracticeMode
    ? 'Practice swing mode enabled.'
    : 'Actual swing mode enabled.');
  return true;
}

/**
 * Applies the practice ball look lazily so the ball model can load asynchronously and still pick up the mode.
 */
function syncPracticeSwingBallVisualState() {
  const childCount = viewerScene.ballRoot.children.length;
  if (!practiceSwingBallVisualDirty && childCount === practiceSwingBallVisualChildCount) {
    return;
  }

  practiceSwingBallVisualDirty = false;
  practiceSwingBallVisualChildCount = childCount;
  viewerScene.ballRoot.traverse((node) => {
    if (!node.isMesh || !node.material) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      if (!ballMaterialVisualState.has(material)) {
        ballMaterialVisualState.set(material, {
          wireframe: Boolean(material.wireframe),
          transparent: Boolean(material.transparent),
          opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
          color: material.color?.clone?.() ?? null,
        });
      }

      const visualState = ballMaterialVisualState.get(material);
      material.wireframe = visualState.wireframe;
      material.transparent = practiceSwingMode ? true : visualState.transparent;
      material.opacity = practiceSwingMode ? PRACTICE_SWING_BALL_OPACITY : visualState.opacity;
      if (visualState.color && material.color) {
        material.color.copy(practiceSwingMode ? practiceSwingBallColor : visualState.color);
      }
      material.needsUpdate = true;
    }
  });
}

/**
 * Maps the current gameplay camera mode to a short HUD status message.
 */
function getGameplayCameraStatusMessage() {
  return viewerScene.isAimingCameraEnabled() ? 'Aiming camera enabled.' : 'Normal camera enabled.';
}

/**
 * Smooths remote joystick values so packet jitter and inconsistent mobile event timing do not show up as camera jitter.
 */
function updateRemoteControlInput(deltaSeconds) {
  remoteJoystickX = smoothRemoteStrength(remoteJoystickX, remoteJoystickTargetX, deltaSeconds);
  remoteJoystickY = smoothRemoteStrength(remoteJoystickY, remoteJoystickTargetY, deltaSeconds);
}

/**
 * Returns the local keyboard rotation direction without mixing in networked analog input.
 */
function getKeyboardRotationInputDirection() {
  return Number(rotateCharacterLeft) - Number(rotateCharacterRight);
}

/**
 * Returns the smoothed mobile joystick rotation direction.
 */
function getRemoteRotationInputDirection() {
  if (isRemoteAimEntryGestureActive()) {
    return 0;
  }

  return -remoteJoystickX;
}

/**
 * Returns the local keyboard aiming-preview direction without mixing in networked analog input.
 */
function getKeyboardAimingPreviewHeadSpeedInputDirection() {
  return Number(increaseAimingPreviewHeadSpeed) - Number(decreaseAimingPreviewHeadSpeed);
}

/**
 * Returns the smoothed mobile joystick aiming-preview direction.
 */
function getRemoteAimingPreviewHeadSpeedInputDirection() {
  return remoteJoystickY;
}

/**
 * Treats a strong near-vertical remote joystick pull as the mobile equivalent of keyboard up/down so it can enter aim mode directly.
 */
function isRemoteAimEntryGestureActive() {
  const verticalDirection = remoteJoystickTargetY;
  if (verticalDirection === 0) {
    return false;
  }

  const horizontalDirection = remoteJoystickTargetX;
  const radialMagnitude = Math.hypot(horizontalDirection, verticalDirection);
  if (radialMagnitude < AIMING_CAMERA_ENTRY_MIN_MAGNITUDE) {
    return false;
  }

  const verticalMagnitude = Math.abs(verticalDirection);
  const horizontalMagnitude = Math.abs(horizontalDirection);
  if (horizontalMagnitude <= 1e-6) {
    return true;
  }

  const angleFromVerticalRadians = Math.atan2(horizontalMagnitude, verticalMagnitude);
  return angleFromVerticalRadians <= AIMING_CAMERA_ENTRY_VERTICAL_TOLERANCE_RADIANS;
}

/**
 * Shapes analog stick magnitude so small deflections stay controllable while full deflection still reaches full speed.
 */
function getAnalogResponseMagnitude(magnitude, exponent) {
  return Math.pow(THREE.MathUtils.clamp(magnitude, 0, 1), exponent);
}

function smoothRemoteStrength(current, target, deltaSeconds) {
  const smoothingAlpha = 1 - Math.exp(-REMOTE_CONTROL_INPUT_SMOOTHING * deltaSeconds);
  const next = THREE.MathUtils.lerp(current, target, smoothingAlpha);
  return Math.abs(next - target) <= REMOTE_CONTROL_INPUT_SNAP_EPSILON ? target : next;
}

/**
 * Applies the latest raw mobile joystick axes so gameplay state can interpret them centrally.
 */
function applyRemoteJoystickInput(x, y) {
  remoteJoystickTargetX = THREE.MathUtils.clamp(x, -1, 1);
  remoteJoystickTargetY = THREE.MathUtils.clamp(y, -1, 1);
}

function resetRemoteJoystickInput() {
  remoteJoystickX = 0;
  remoteJoystickY = 0;
  remoteJoystickTargetX = 0;
  remoteJoystickTargetY = 0;
}

/**
 * Mirrors the Space-bar gameplay rule: aiming can always be turned off, but only turned on while the ball is ready.
 */
function toggleAimingCamera() {
  if (!viewerScene.isAimingCameraEnabled() && !canUseAimingControls()) {
    return false;
  }

  viewerScene.setAimingCameraEnabled(!viewerScene.isAimingCameraEnabled());
  resetCharacterRotationAcceleration();
  if (!viewerScene.isAimingCameraEnabled()) {
    increaseAimingPreviewHeadSpeed = false;
    decreaseAimingPreviewHeadSpeed = false;
    resetAimingPreviewHeadSpeedAcceleration();
  }
  hud.setStatus(getGameplayCameraStatusMessage());
  return true;
}

function applyRemoteControl(action, active, value = null) {
  const analogStrength = active ? Math.max(0, Math.min(1, value ?? 1)) : 0;

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
    case CONTROL_ACTIONS.practiceSwingEnable:
      if (active) {
        setPracticeSwingMode(true);
      }
      break;
    case CONTROL_ACTIONS.actualSwingEnable:
      if (active) {
        setPracticeSwingMode(false);
      }
      break;
    case CONTROL_ACTIONS.rotateLeft:
      remoteJoystickTargetX = active ? -analogStrength : Math.max(remoteJoystickTargetX, 0);
      if (!rotateCharacterLeft && remoteJoystickTargetX === 0 && !rotateCharacterRight) {
        resetCharacterRotationAcceleration();
      }
      break;
    case CONTROL_ACTIONS.rotateRight:
      remoteJoystickTargetX = active ? analogStrength : Math.min(remoteJoystickTargetX, 0);
      if (!rotateCharacterLeft && remoteJoystickTargetX === 0 && !rotateCharacterRight) {
        resetCharacterRotationAcceleration();
      }
      break;
    case CONTROL_ACTIONS.aimIncrease:
      remoteJoystickTargetY = active ? analogStrength : Math.min(remoteJoystickTargetY, 0);
      if (remoteJoystickTargetY === 0 && !increaseAimingPreviewHeadSpeed && !decreaseAimingPreviewHeadSpeed) {
        resetAimingPreviewHeadSpeedAcceleration();
      }
      break;
    case CONTROL_ACTIONS.aimDecrease:
      remoteJoystickTargetY = active ? -analogStrength : Math.max(remoteJoystickTargetY, 0);
      if (remoteJoystickTargetY === 0 && !increaseAimingPreviewHeadSpeed && !decreaseAimingPreviewHeadSpeed) {
        resetAimingPreviewHeadSpeedAcceleration();
      }
      break;
    case CONTROL_ACTIONS.aimCameraToggle:
      if (active) {
        toggleAimingCamera();
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

  hud.updateLaunchPreview(impact.launchPreview);
  updateSwingPreviewCaptureFromImpact(impact);
  if (practiceSwingMode) {
    handlePracticeLaunch(impact);
  } else {
    launchBall(impact.launchData, impact.referenceForward, impact.impactSpeedMetersPerSecond);
  }
  clubBallContactLatched = true;
}

/**
 * Plays a single swing whoosh when the incoming club speed crosses the configured whoosh threshold, even if the swing misses the ball.
 */
function updateClubWhooshAudio() {
  const ballTelemetry = ballPhysics.getDebugTelemetry();
  const canPlayWhoosh = playerState === 'control' && ballTelemetry.phase === 'ready';

  if (!canPlayWhoosh) {
    clubWhooshLatched = false;
    return;
  }

  const incomingClubHeadSpeedMetersPerSecond = getIncomingClubHeadSpeedMetersPerSecond();
  const now = performance.now();
  if (clubWhooshLatched && incomingClubHeadSpeedMetersPerSecond < CLUB_SWING_WHOOSH_REARM_SPEED) {
    clubWhooshLatched = false;
  }

  if (incomingClubHeadSpeedMetersPerSecond > CLUB_SWING_WHOOSH_MIN_SPEED) {
    const isWhooshOffCooldown = now - lastClubWhooshTimeMs >= CLUB_SWING_WHOOSH_COOLDOWN_MS;
    if (!clubWhooshLatched && isWhooshOffCooldown) {
      shotImpactAudio.playWhoosh(incomingClubHeadSpeedMetersPerSecond);
      clubWhooshLatched = true;
      lastClubWhooshTimeMs = now;
    }
    return;
  }
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
  if (!viewerScene.isFreeCameraEnabled()) {
    viewerScene.setAimingCameraEnabled(false);
  }
  if (Math.abs(launchData.horizontalLaunchAngle) <= SHOT_AUDIO_PANGYA_MAX_HORIZONTAL_ANGLE_DEGREES) {
    shotImpactAudio.playPangya();
  }
  shotImpactAudio.playForImpactSpeed(
    getLaunchImpactSpeedMetersPerSecond(launchData, impactSpeedMetersPerSecond),
  );
  playerState = 'waiting';
  ballTrail.reset();
  ballPhysics.launch(launchData, referenceForward);
  invalidateAimingPreview();
}

/**
 * Emits practice launch data locally so preview UI can react without advancing the real shot state.
 */
function handlePracticeLaunch(impact) {
  shotImpactAudio.playPractice();

  window.dispatchEvent(new CustomEvent('practiceLaunch', {
    detail: {
      practiceSwingMode: true,
      impactSpeedMetersPerSecond: impact.impactSpeedMetersPerSecond,
      launchData: { ...impact.launchData },
      launchPreview: impact.launchPreview ? { ...impact.launchPreview } : null,
      referenceForward: impact.referenceForward ? impact.referenceForward.clone() : null,
      timestampMs: performance.now(),
    },
  }));
  hud.setStatus(`Practice launch captured at ${formatMetersPerSecond(impact.launchPreview?.ballSpeed ?? 0)} ball speed.`);
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

function resetShotFlow(surfacePoint = null, surfaceNormal = null) {
  if (surfacePoint) {
    ballPhysics.teleportToSurface(surfacePoint, surfaceNormal);
  } else {
    ballPhysics.reset();
  }
  ballTrail.reset();
  viewerScene.ballRoot.position.copy(ballPhysics.getPosition());
  viewerScene.ballRoot.quaternion.copy(ballPhysics.getOrientation());
  practiceSwingBallVisualDirty = true;
  syncPracticeSwingBallVisualState();
  viewerScene.positionCharacterForBall(ballPhysics.getPosition());
  if (!viewerScene.isFreeCameraEnabled()) {
    viewerScene.setAimingCameraEnabled(false);
    faceCameraTowardHole(ballPhysics.getPosition());
  }
  clubWhooshLatched = false;
  lastClubWhooshTimeMs = -Infinity;
  playerState = 'control';
  clubBallContactLatched = true;
  syncPuttAimDistanceToHole(ballPhysics.getPosition());
  syncSwingPreviewTarget();
  hud.updateSwingPreviewCapture(null, getCurrentAimingPreviewHeadSpeed(ballPhysics.getPosition()));
  updateLaunchDebugUiState();
  invalidateAimingPreview();
}

/**
 * Raycasts from the current cursor position and moves the ball to the nearest grounded course point.
 */
function warpBallToMousePosition() {
  if (!viewerScene.courseCollision?.root) {
    hud.setStatus('Ball warp unavailable until the course collision data is ready.');
    return false;
  }

  const warpTarget = resolveCursorWarpTarget();
  if (!warpTarget) {
    hud.setStatus('Ball warp failed. Move the mouse over the course and try again.');
    return false;
  }

  resetShotFlow(warpTarget.point, warpTarget.normal);
  hud.setStatus('Ball warped to cursor.');
  return true;
}

/**
 * Resolves a stable grounded warp target from the cursor ray so the ball does not teleport onto steep walls.
 */
function resolveCursorWarpTarget() {
  if (!hasCursorPointerPosition) {
    return null;
  }

  const canvasRect = dom.canvas.getBoundingClientRect();
  if (canvasRect.width <= 1 || canvasRect.height <= 1) {
    return null;
  }

  const pointerX = lastCursorPointerClientX - canvasRect.left;
  const pointerY = lastCursorPointerClientY - canvasRect.top;
  if (pointerX < 0 || pointerX > canvasRect.width || pointerY < 0 || pointerY > canvasRect.height) {
    return null;
  }

  cursorRayNdc.set(
    (pointerX / canvasRect.width) * 2 - 1,
    -((pointerY / canvasRect.height) * 2 - 1),
  );
  cursorRaycaster.setFromCamera(cursorRayNdc, viewerScene.camera);

  const rayHit = raycastCourseSurface(
    viewerScene.courseCollision,
    cursorRaycaster.ray,
    viewerScene.camera.far,
  );
  if (!rayHit) {
    return null;
  }

  // Re-sample downward from the hit so side faces resolve to a grounded landing point when possible.
  const groundedSurface = sampleCourseSurface(viewerScene.courseCollision, rayHit.point, 2, 40) ?? rayHit;
  if (!groundedSurface?.point || !groundedSurface?.normal) {
    return null;
  }

  if (groundedSurface.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return null;
  }

  return {
    point: groundedSurface.point.clone(),
    normal: groundedSurface.normal.clone(),
  };
}

function initializeLaunchDebugUi() {
  hud.updateLaunchPanelVisible(DEBUG_UI_ENABLED);

  if (!DEBUG_UI_ENABLED || !hasLaunchDebugInputs() || !dom.launchDebugButton || !dom.launchDebugMessage) {
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

/**
 * Mirrors launch data into the LaunchDebug widget so the debug shot can replay the current preview setup.
 */
function syncLaunchDebugInputs(launchData) {
  if (!DEBUG_UI_ENABLED || !hasLaunchDebugInputs() || !launchData) {
    return;
  }

  for (const { key, inputKey } of LAUNCH_DEBUG_INPUT_FIELDS) {
    const nextFieldValue = Number.isFinite(launchData[key])
      ? launchData[key]
      : BALL_DEFAULT_LAUNCH_DATA[key];
    dom[inputKey].value = String(nextFieldValue);
  }

  updateLaunchDebugUiState('LaunchDebug synced with the current aiming preview.');
}

function initializeClubDebugUi() {
  if (!dom.clubPrevButton || !dom.clubNextButton) {
    return;
  }

  renderClubDebugButtons();

  dom.clubPrevButton.addEventListener('click', () => {
    selectPreviousClub();
  });
  dom.clubNextButton.addEventListener('click', () => {
    selectNextClub();
  });

  hud.updateClubDebug(ACTIVE_CLUB_SET, activeClub);
}

/**
 * Builds the direct-select row in reverse order so woods stay at the right edge.
 */
function renderClubDebugButtons() {
  if (!dom.clubButtonRow) {
    return;
  }

  dom.clubButtonRow.replaceChildren();

  for (const club of [...ACTIVE_CLUB_SET.clubs].reverse()) {
    const clubButton = document.createElement('button');
    clubButton.type = 'button';
    clubButton.className = 'action-button secondary club-direct-button';
    clubButton.textContent = club.id;
    clubButton.dataset.clubId = club.id;
    clubButton.setAttribute('aria-label', `Select ${club.id}`);
    clubButton.setAttribute('aria-pressed', String(club.id === activeClub.id));
    clubButton.addEventListener('click', () => {
      selectClubById(club.id);
    });
    dom.clubButtonRow.append(clubButton);
  }
}

function selectPreviousClub() {
  moveActiveClub(1);
}

function selectNextClub() {
  moveActiveClub(-1);
}

/**
 * Selects a specific club from the active club set when the direct button row is used.
 */
function selectClubById(clubId) {
  const nextClub = ACTIVE_CLUB_SET.clubs.find((club) => club.id === clubId);
  if (!nextClub) {
    return;
  }

  setActiveClub(nextClub);
}

function moveActiveClub(delta) {
  const clubIndex = ACTIVE_CLUB_SET.clubs.findIndex((club) => club.id === activeClub.id);
  const nextClubIndex = clubIndex >= 0
    ? Math.min(Math.max(clubIndex + delta, 0), ACTIVE_CLUB_SET.clubs.length - 1)
    : 0;
  setActiveClub(ACTIVE_CLUB_SET.clubs[nextClubIndex]);
}

/**
 * Centralizes active-club updates so all selectors keep the widget and preview state in sync.
 */
function setActiveClub(nextClub) {
  if (!nextClub) {
    return;
  }

  if (aimingPreview.hasTargetPoint) {
    setAimingTargetDistanceMeters(aimingPreview.carryDistanceMeters);
  }

  activeClub = nextClub;
  if (!usesLaunchAimingPreview()) {
    syncPuttAimDistanceToAimingTarget();
  } else {
    syncLaunchPreviewHeadSpeedToAimingTarget();
  }
  hud.updateClubDebug(ACTIVE_CLUB_SET, activeClub);
  syncSwingPreviewTarget();
  invalidateAimingPreview();
}

function invalidateAimingPreview() {
  aimingPreview.dirty = true;
  if (!usesLaunchAimingPreview()) {
    syncSwingPreviewTarget();
  }
}

/**
 * Adjusts the neutral aiming preview club-head speed and forces the landing marker to refresh.
 */
function adjustAimingPreviewHeadSpeed(deltaMetersPerSecond) {
  const nextHeadSpeedMetersPerSecond = THREE.MathUtils.clamp(
    aimingPreviewHeadSpeedMetersPerSecond + deltaMetersPerSecond,
    AIMING_PREVIEW_HEAD_SPEED_MIN_METERS_PER_SECOND,
    AIMING_PREVIEW_HEAD_SPEED_MAX_METERS_PER_SECOND,
  );
  if (Math.abs(nextHeadSpeedMetersPerSecond - aimingPreviewHeadSpeedMetersPerSecond) <= 1e-8) {
    return;
  }

  aimingPreviewHeadSpeedMetersPerSecond = nextHeadSpeedMetersPerSecond;
  syncSwingPreviewTarget();
  invalidateAimingPreview();
  hud.setStatus(`Aim preview head speed: ${formatMetersPerSecond(aimingPreviewHeadSpeedMetersPerSecond)}`);
}

/**
 * Adjusts the fake putt target distance, then derives the preview swing target from that landing spot.
 */
function adjustPuttAimDistance(deltaMeters) {
  const nextPuttAimDistanceMeters = THREE.MathUtils.clamp(
    puttAimDistanceMeters + deltaMeters,
    AIMING_TARGET_DISTANCE_MIN_METERS,
    AIMING_TARGET_DISTANCE_MAX_METERS,
  );
  if (Math.abs(nextPuttAimDistanceMeters - puttAimDistanceMeters) <= 1e-8) {
    return;
  }

  setAimingTargetDistanceMeters(nextPuttAimDistanceMeters);
  syncSwingPreviewTarget();
  invalidateAimingPreview();
  hud.setStatus(
    `Putt aim: ${formatDistanceYards(puttAimDistanceMeters)} (${formatMetersPerSecond(getCurrentAimingPreviewHeadSpeed())})`,
  );
}

function syncSwingPreviewTarget() {
  hud.updateSwingPreviewTarget(getCurrentAimingPreviewHeadSpeed());
}

/**
 * Mirrors the impact-captured head speed into the swing preview widget for both practice and real swings.
 */
function updateSwingPreviewCaptureFromImpact(impact) {
  const capturedHeadSpeedMetersPerSecond = Number.isFinite(impact?.launchPreview?.clubHeadSpeedMetersPerSecond)
    ? impact.launchPreview.clubHeadSpeedMetersPerSecond
    : impact?.impactSpeedMetersPerSecond;
  hud.updateSwingPreviewCapture(
    capturedHeadSpeedMetersPerSecond,
    getCurrentAimingPreviewHeadSpeed(),
  );
}

/**
 * Returns the preview head-speed target, deriving it from the fake putt landing distance when a putter is active.
 */
function getCurrentAimingPreviewHeadSpeed(ballPosition = ballPhysics.getPosition()) {
  if (usesLaunchAimingPreview()) {
    return aimingPreviewHeadSpeedMetersPerSecond;
  }

  return getPuttPreviewHeadSpeed(ballPosition);
}

/**
 * Resolves the post-reset target distance from the current hole distance without overwriting shorter launch targets.
 */
function syncPuttAimDistanceToHole(ballPosition = ballPhysics.getPosition()) {
  if (!ballPosition) {
    return;
  }

  puttHoleOffset.subVectors(COURSE_HOLE_POSITION, ballPosition);
  puttHoleOffset.y = 0;
  const holeDistanceMeters = puttHoleOffset.length();
  const previousAimDistanceMeters = aimingTargetDistanceMeters;
  let nextAimDistanceMeters = holeDistanceMeters;

  if (usesLaunchAimingPreview()) {
    nextAimDistanceMeters = previousAimDistanceMeters > holeDistanceMeters
      ? holeDistanceMeters * AIMING_TARGET_RESET_HOLE_DISTANCE_SCALE
      : previousAimDistanceMeters;
  }

  setAimingTargetDistanceMeters(nextAimDistanceMeters);
}

/**
 * Stores the shared gameplay aiming distance so putter and launch clubs can preserve the same target point.
 */
function setAimingTargetDistanceMeters(distanceMeters) {
  const clampedDistanceMeters = THREE.MathUtils.clamp(
    distanceMeters,
    AIMING_TARGET_DISTANCE_MIN_METERS,
    AIMING_TARGET_DISTANCE_MAX_METERS,
  );
  aimingTargetDistanceMeters = clampedDistanceMeters;
  puttAimDistanceMeters = clampedDistanceMeters;
  return clampedDistanceMeters;
}

/**
 * Copies the shared target distance into putter mode so switching clubs keeps the same target point.
 */
function syncPuttAimDistanceToAimingTarget() {
  puttAimDistanceMeters = THREE.MathUtils.clamp(
    aimingTargetDistanceMeters,
    AIMING_TARGET_DISTANCE_MIN_METERS,
    AIMING_TARGET_DISTANCE_MAX_METERS,
  );
}

/**
 * Solves the neutral launch preview head speed that lands closest to the shared gameplay target distance.
 */
function syncLaunchPreviewHeadSpeedToAimingTarget(ballPosition = ballPhysics.getPosition()) {
  const solvedHeadSpeedMetersPerSecond = solveLaunchPreviewHeadSpeedForDistance(
    aimingTargetDistanceMeters,
    ballPosition,
  );
  if (Number.isFinite(solvedHeadSpeedMetersPerSecond)) {
    aimingPreviewHeadSpeedMetersPerSecond = solvedHeadSpeedMetersPerSecond;
  }
}

/**
 * Uses a binary search over the neutral launch preview so club switches preserve a consistent target distance.
 */
function solveLaunchPreviewHeadSpeedForDistance(targetDistanceMeters, ballPosition = ballPhysics.getPosition()) {
  if (!ballPosition || !viewerScene.courseCollision?.root) {
    return aimingPreviewHeadSpeedMetersPerSecond;
  }

  const desiredDistanceMeters = Math.max(targetDistanceMeters, AIMING_TARGET_DISTANCE_MIN_METERS);
  const referenceForward = viewerScene.getCharacterForward(characterForwardForPreview);
  let lowHeadSpeedMetersPerSecond = AIMING_PREVIEW_HEAD_SPEED_MIN_METERS_PER_SECOND;
  let highHeadSpeedMetersPerSecond = AIMING_PREVIEW_HEAD_SPEED_MAX_METERS_PER_SECOND;
  let bestHeadSpeedMetersPerSecond = aimingPreviewHeadSpeedMetersPerSecond;
  let bestDistanceErrorMeters = Infinity;

  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidateHeadSpeedMetersPerSecond = (lowHeadSpeedMetersPerSecond + highHeadSpeedMetersPerSecond) * 0.5;
    const launchPreview = getNeutralClubLaunchPreview(candidateHeadSpeedMetersPerSecond, activeClub);
    if (!launchPreview?.isReady) {
      lowHeadSpeedMetersPerSecond = candidateHeadSpeedMetersPerSecond;
      continue;
    }

    const firstContactPreview = predictFirstContactPoint(
      viewerScene,
      ballPosition,
      {
        ballSpeed: launchPreview.ballSpeed,
        verticalLaunchAngle: launchPreview.verticalLaunchAngle,
        horizontalLaunchAngle: 0,
        spinSpeed: launchPreview.spinSpeed,
        spinAxis: launchPreview.spinAxis,
      },
      referenceForward,
    );
    const candidateDistanceMeters = firstContactPreview?.carryDistanceMeters ?? 0;
    const distanceErrorMeters = Math.abs(candidateDistanceMeters - desiredDistanceMeters);
    if (distanceErrorMeters < bestDistanceErrorMeters) {
      bestDistanceErrorMeters = distanceErrorMeters;
      bestHeadSpeedMetersPerSecond = candidateHeadSpeedMetersPerSecond;
    }

    if (candidateDistanceMeters < desiredDistanceMeters) {
      lowHeadSpeedMetersPerSecond = candidateHeadSpeedMetersPerSecond;
    } else {
      highHeadSpeedMetersPerSecond = candidateHeadSpeedMetersPerSecond;
    }
  }

  return THREE.MathUtils.clamp(
    bestHeadSpeedMetersPerSecond,
    AIMING_PREVIEW_HEAD_SPEED_MIN_METERS_PER_SECOND,
    AIMING_PREVIEW_HEAD_SPEED_MAX_METERS_PER_SECOND,
  );
}

/**
 * Resolves the current fake putt target point by moving along the aim direction and snapping that target to the green.
 */
function resolvePuttAimTargetPoint(ballPosition = ballPhysics.getPosition(), target = aimingPreviewTargetProbePoint) {
  if (!ballPosition) {
    return target.set(0, 0, 0);
  }

  aimingPreviewTargetForward.copy(viewerScene.getCharacterForward(characterForwardForPreview));
  if (aimingPreviewTargetForward.lengthSq() <= 1e-8) {
    aimingPreviewTargetForward.set(0, 0, -1);
  } else {
    aimingPreviewTargetForward.normalize();
  }

  let resolvedAimDistanceMeters = puttAimDistanceMeters;
  puttHoleOffset.subVectors(COURSE_HOLE_POSITION, ballPosition);
  puttHoleOffset.y = 0;
  const holeDistanceAlongAimMeters = puttHoleOffset.dot(aimingPreviewTargetForward);
  if (holeDistanceAlongAimMeters > 0) {
    aimingPreviewTargetLateralOffset.copy(puttHoleOffset).addScaledVector(
      aimingPreviewTargetForward,
      -holeDistanceAlongAimMeters,
    );

    // Only clamp when the aim line is effectively passing through the cup.
    if (aimingPreviewTargetLateralOffset.length() <= PUTT_AIM_HOLE_ALIGNMENT_TOLERANCE_METERS) {
      resolvedAimDistanceMeters = Math.min(
        resolvedAimDistanceMeters,
        Math.max(holeDistanceAlongAimMeters - PUTT_AIM_HOLE_CLAMP_MARGIN_METERS, 0),
      );
    }
  }

  target.copy(ballPosition)
    .addScaledVector(aimingPreviewTargetForward, resolvedAimDistanceMeters);

  if (!viewerScene.courseCollision?.root) {
    return target;
  }

  const surfaceSample = sampleCourseSurface(
    viewerScene.courseCollision,
    target,
    3,
    18,
  );

  return target.copy(surfaceSample?.point ?? target);
}

/**
 * Converts the fake putt landing distance into a preview head speed using the current aimed target height.
 */
function getPuttPreviewHeadSpeed(ballPosition = ballPhysics.getPosition()) {
  const aimedDistanceMeters = THREE.MathUtils.clamp(
    puttAimDistanceMeters,
    AIMING_TARGET_DISTANCE_MIN_METERS,
    AIMING_TARGET_DISTANCE_MAX_METERS,
  );
  const aimTargetPoint = resolvePuttAimTargetPoint(ballPosition, aimingPreviewTargetProbePoint);
  const heightDeltaMeters = Number.isFinite(ballPosition?.y)
    ? aimTargetPoint.y - ballPosition.y
    : 0;
  const effectiveRollFriction = BALL_ROLLING_RESISTANCE * PUTT_PREVIEW_EFFECTIVE_ROLL_FRICTION_MULTIPLIER;
  const stopDistanceBallSpeed = Math.sqrt(
    Math.max(0, 2 * effectiveRollFriction * PUTT_PREVIEW_GRAVITY_ACCELERATION * aimedDistanceMeters),
  );
  const uphillSpeedAdjustment = Math.max(heightDeltaMeters, 0) * PUTT_PREVIEW_UPHILL_SPEED_PER_METER;
  const downhillSpeedAdjustment = Math.max(-heightDeltaMeters, 0) * PUTT_PREVIEW_DOWNHILL_SPEED_PER_METER;
  const targetBallSpeedMetersPerSecond = Math.max(
    PUTT_PREVIEW_MIN_BALL_SPEED_METERS_PER_SECOND,
    stopDistanceBallSpeed + uphillSpeedAdjustment - downhillSpeedAdjustment + PUTT_PREVIEW_SPEED_BIAS_METERS_PER_SECOND,
  );
  const smashFactor = Number.isFinite(activeClub?.smashFactor)
    ? Math.max(activeClub.smashFactor, 1e-6)
    : 1;

  return THREE.MathUtils.clamp(
    targetBallSpeedMetersPerSecond / smashFactor,
    AIMING_PREVIEW_HEAD_SPEED_MIN_METERS_PER_SECOND,
    AIMING_PREVIEW_HEAD_SPEED_MAX_METERS_PER_SECOND,
  );
}

function updateAimingPreviewIfNeeded() {
  if (!aimingPreview.dirty) {
    return;
  }
  aimingPreview.isVisible = false;
  aimingPreview.hasTargetPoint = false;
  aimingPreview.puttGrid = null;

  if (playerState !== 'control' || ballPhysics.getStateSnapshot().phase !== 'ready') {
    aimingPreview.mode = usesLaunchAimingPreview() ? 'landing' : 'putt-grid';
    aimingPreview.dirty = false;
    return;
  }

  if (!viewerScene.courseCollision?.root) {
    return;
  }

  if (!usesLaunchAimingPreview()) {
    const puttAimForward = viewerScene.getCharacterForward(characterForwardForPreview);
    const puttPreviewHeadSpeedMetersPerSecond = getCurrentAimingPreviewHeadSpeed(ballPhysics.getPosition());
    const launchPreview = getNeutralClubLaunchPreview(
      puttPreviewHeadSpeedMetersPerSecond,
      activeClub,
    );
    if (!launchPreview?.isReady) {
      return;
    }

    const aimingPreviewLaunchData = {
      ballSpeed: launchPreview.ballSpeed,
      verticalLaunchAngle: launchPreview.verticalLaunchAngle,
      horizontalLaunchAngle: 0,
      spinSpeed: launchPreview.spinSpeed,
      spinAxis: launchPreview.spinAxis,
    };
    syncLaunchDebugInputs(aimingPreviewLaunchData);
    resolvePuttAimTargetPoint(ballPhysics.getPosition(), aimingPreviewLandingPoint);
    const puttGridPreview = buildPuttGridPreview(
      viewerScene,
      ballPhysics.getPosition(),
      puttAimDistanceMeters,
      puttAimForward,
    );
    aimingPreview.mode = 'putt-grid';
    aimingPreview.puttGrid = puttGridPreview;
    aimingPreview.isVisible = Boolean(puttGridPreview?.cells?.length || puttAimDistanceMeters > 0);
    aimingPreview.hasTargetPoint = true;
    aimingPreview.carryDistanceMeters = Math.hypot(
      aimingPreviewLandingPoint.x - ballPhysics.getPosition().x,
      aimingPreviewLandingPoint.z - ballPhysics.getPosition().z,
    );
    aimingPreview.dirty = false;
    return;
  }

  const launchPreview = getNeutralClubLaunchPreview(
    getCurrentAimingPreviewHeadSpeed(ballPhysics.getPosition()),
    activeClub,
  );
  if (!launchPreview?.isReady) {
    return;
  }

  const aimingPreviewLaunchData = {
    ballSpeed: launchPreview.ballSpeed,
    verticalLaunchAngle: launchPreview.verticalLaunchAngle,
    horizontalLaunchAngle: 0,
    spinSpeed: launchPreview.spinSpeed,
    spinAxis: launchPreview.spinAxis,
  };
  syncLaunchDebugInputs(aimingPreviewLaunchData);

  const firstContactPreview = predictFirstContactPoint(
    viewerScene,
    ballPhysics.getPosition(),
    aimingPreviewLaunchData,
    viewerScene.getCharacterForward(characterForwardForPreview),
  );
  aimingPreview.mode = 'landing';
  if (!firstContactPreview) {
    aimingPreview.dirty = false;
    return;
  }

  aimingPreviewLandingPoint.copy(firstContactPreview.point);
  aimingPreview.carryDistanceMeters = setAimingTargetDistanceMeters(firstContactPreview.carryDistanceMeters);
  aimingPreview.isVisible = true;
  aimingPreview.hasTargetPoint = true;
  aimingPreview.dirty = false;
}

function updateAimingMarker(ballTelemetry) {
  const aimingMarker = viewerScene.getAimingMarker();
  if (!aimingMarker) {
    return;
  }

  if (ballTelemetry.phase === 'moving' || !aimingPreview.isVisible) {
    aimingMarker.setVisible(false);
    aimingMarker.setPuttGrid(null);
    aimingMarker.setPuttAimTarget(null);
    return;
  }

  if (aimingPreview.mode === 'putt-grid') {
    aimingMarker.setPuttGrid(aimingPreview.puttGrid);
    aimingMarker.setPuttAimTarget(null);
    if (!aimingPreview.hasTargetPoint) {
      aimingMarker.setVisible(false);
      return;
    }
    aimingMarkerCameraSpace.copy(aimingPreviewLandingPoint).applyMatrix4(viewerScene.camera.matrixWorldInverse);
    if (aimingMarkerCameraSpace.z >= 0) {
      aimingMarker.setVisible(false);
      return;
    }

    const distanceToCamera = viewerScene.camera.position.distanceTo(aimingPreviewLandingPoint);
    const worldHeight = 2
      * Math.tan(THREE.MathUtils.degToRad(viewerScene.camera.fov * 0.5))
      * Math.max(distanceToCamera, 0.01)
      * (AIMING_MARKER_PIXEL_HEIGHT / window.innerHeight);

    aimingMarker.setDistanceLabel(formatDistanceYards(aimingPreview.carryDistanceMeters));
    aimingMarker.setWorldPosition(aimingPreviewLandingPoint);
    aimingMarker.setWorldHeight(worldHeight);
    aimingMarker.setVisible(true);
    return;
  } else {
    aimingMarker.setPuttGrid(null);
    aimingMarker.setPuttAimTarget(null);
  }

  aimingMarkerCameraSpace.copy(aimingPreviewLandingPoint).applyMatrix4(viewerScene.camera.matrixWorldInverse);
  if (aimingMarkerCameraSpace.z >= 0) {
    aimingMarker.setVisible(false);
    return;
  }

  const distanceToCamera = viewerScene.camera.position.distanceTo(aimingPreviewLandingPoint);
  const worldHeight = 2
    * Math.tan(THREE.MathUtils.degToRad(viewerScene.camera.fov * 0.5))
    * Math.max(distanceToCamera, 0.01)
    * (AIMING_MARKER_PIXEL_HEIGHT / window.innerHeight);

  aimingMarker.setDistanceLabel(formatDistanceYards(aimingPreview.carryDistanceMeters));
  aimingMarker.setWorldPosition(aimingPreviewLandingPoint);
  aimingMarker.setWorldHeight(worldHeight);
  aimingMarker.setVisible(true);
}

function launchDebugBallFromInput() {
  if (!DEBUG_UI_ENABLED || !canLaunchDebugShot()) {
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
  if (!DEBUG_UI_ENABLED || !hasLaunchDebugInputs() || !dom.launchDebugButton || !dom.launchDebugMessage) {
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
  if (!DEBUG_UI_ENABLED || !hasLaunchDebugInputs()) {
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