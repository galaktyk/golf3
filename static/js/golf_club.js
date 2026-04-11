import * as THREE from 'three';
import { CONTROL_ACTIONS, encodeControlMessage, encodeSwingStatePacket } from '/static/js/protocol.js';

const connectButton = document.querySelector('#connect-button');
const calibrateButton = document.querySelector('#calibrate-button');
const clubPrevButton = document.querySelector('#club-prev-button');
const clubNextButton = document.querySelector('#club-next-button');
const practiceSwingButton = document.querySelector('#practice-swing-button');
const actualSwingButton = document.querySelector('#actual-swing-button');
const joystickZone = document.querySelector('#aim-joystick');
const joystickVisual = joystickZone?.querySelector('.aim-joystick-visual');
const joystickKnob = joystickZone?.querySelector('.aim-joystick-knob');
const statusLabel = document.querySelector('#controller-status');
const debugLabel = document.querySelector('#controller-debug');

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const orientationEventName = getOrientationEventName();
const motionEventName = getMotionEventName();
const CLUB_SHAFT_AXIS_LOCAL = new THREE.Vector3(0, -1, 0);
const ANGULAR_VELOCITY_LOCAL = new THREE.Vector3();
const SHAFT_TWIST_COMPONENT = new THREE.Vector3();

const SWING_SPEED_FOLLOW_RATE = 18;
const SWING_SPEED_DECAY_RATE = 6;
const MOTION_FRESHNESS_LIMIT_MS = 250;
const DEBUG_QUATERNION_DECIMALS = 1;
const DEBUG_ANGULAR_SPEED_DECIMALS = 1;

const rawQuaternion = new THREE.Quaternion();
const calibratedQuaternion = new THREE.Quaternion();
const neutralInverse = new THREE.Quaternion();

const joystickState = {
  pointerId: null,
  originX: 0,
  originY: 0,
  rotateAction: null,
  rotateStrength: 0,
  aimAction: null,
  aimStrength: 0,
  pointerDownTimeMs: 0,
  maxDistanceFromOrigin: 0,
  lastTapTimeMs: 0,
  lastTapX: 0,
  lastTapY: 0,
};

const JOYSTICK_RADIUS = 90;
const JOYSTICK_DEADZONE = 0.0001;
const JOYSTICK_TAP_MAX_DURATION_MS = 240;
const JOYSTICK_DOUBLE_TAP_WINDOW_MS = 320;
const JOYSTICK_TAP_MAX_MOVEMENT = 16;
const JOYSTICK_DOUBLE_TAP_MAX_DISTANCE = 40;
const JOYSTICK_NETWORK_STEP = 0.02;

let motionEnabled = false;
let hasOrientation = false;
let hasMotion = false;
let orientationSocket = null;
let controlSocket = null;
let filteredPerpendicularAngularSpeedRadiansPerSecond = 0;
let decayingPerpendicularAngularSpeedRadiansPerSecond = 0;
let lastMotionSampleTimeMs = 0;
let lastMotionDebugUpdateTimeMs = 0;
let packetSequence = 0;

neutralInverse.identity();

connectButton.addEventListener('click', async () => {
  await connectWithMotion();
});

calibrateButton.addEventListener('click', () => {
  if (!hasOrientation) {
    statusLabel.textContent = 'Move phone';
    return;
  }

  neutralInverse.copy(rawQuaternion).invert();
  statusLabel.textContent = 'Forward set';
});

clubPrevButton.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.clubPrevious);
});

clubNextButton.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.clubNext);
});

practiceSwingButton?.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.practiceSwingEnable);
});

actualSwingButton?.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.actualSwingEnable);
});

bindAimJoystick();
setControlButtonsEnabled(false);

if (orientationEventName) {
  window.addEventListener(orientationEventName, (event) => {
    if (!motionEnabled) {
      return;
    }

    const alpha = THREE.MathUtils.degToRad(event.alpha ?? 0);
    const beta = THREE.MathUtils.degToRad(event.beta ?? 0);
    const gamma = THREE.MathUtils.degToRad(event.gamma ?? 0);
    const orient = THREE.MathUtils.degToRad(window.screen.orientation?.angle ?? window.orientation ?? 0);

    rawQuaternion.copy(deviceOrientationToQuaternion(alpha, beta, gamma, orient));
    hasOrientation = true;
    updateDebugLabel();
  });
}

if (motionEventName) {
  window.addEventListener(motionEventName, (event) => {
    if (!motionEnabled) {
      return;
    }

    const sampleTimeMs = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
    const deltaSeconds = lastMotionSampleTimeMs > 0
      ? Math.min(Math.max((sampleTimeMs - lastMotionSampleTimeMs) / 1000, 1 / 240), 0.25)
      : (1 / 60);
    lastMotionSampleTimeMs = sampleTimeMs;

    const instantaneousPerpendicularAngularSpeedRadiansPerSecond = getInstantaneousPerpendicularAngularSpeedRadiansPerSecond(event.rotationRate);
    if (hasFiniteRotationRate(event.rotationRate)) {
      hasMotion = true;
    }

    const followAlpha = 1 - Math.exp(-SWING_SPEED_FOLLOW_RATE * deltaSeconds);
    filteredPerpendicularAngularSpeedRadiansPerSecond = THREE.MathUtils.lerp(
      filteredPerpendicularAngularSpeedRadiansPerSecond,
      instantaneousPerpendicularAngularSpeedRadiansPerSecond,
      followAlpha,
    );

    const decayMultiplier = Math.exp(-SWING_SPEED_DECAY_RATE * deltaSeconds);
    decayingPerpendicularAngularSpeedRadiansPerSecond = Math.max(
      filteredPerpendicularAngularSpeedRadiansPerSecond,
      decayingPerpendicularAngularSpeedRadiansPerSecond * decayMultiplier,
    );

    if (sampleTimeMs - lastMotionDebugUpdateTimeMs >= 32) {
      lastMotionDebugUpdateTimeMs = sampleTimeMs;
      updateDebugLabel();
    }
  });
}

setInterval(() => {
  if (!motionEnabled) {
    return;
  }

  if (!orientationSocket || orientationSocket.readyState !== WebSocket.OPEN || !hasOrientation) {
    return;
  }

  calibratedQuaternion.copy(neutralInverse).multiply(rawQuaternion).normalize();
  orientationSocket.send(encodeSwingStatePacket({
    quaternion: calibratedQuaternion,
    perpendicularAngularSpeedRadiansPerSecond: getOutboundPerpendicularAngularSpeedRadiansPerSecond(),
    motionAgeMilliseconds: getMotionAgeMilliseconds(),
    sequence: packetSequence,
  }));
  packetSequence = (packetSequence + 1) & 0xffff;
}, 1000 / 60);

async function enableMotion() {
  if (!orientationEventName || !motionEventName) {
    statusLabel.textContent = getUnsupportedMessage();
    return false;
  }

  try {
    if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') {
      const permission = await window.DeviceOrientationEvent.requestPermission();
      motionEnabled = permission === 'granted';
    } else {
      motionEnabled = true;
    }

    if (motionEnabled && typeof window.DeviceMotionEvent?.requestPermission === 'function') {
      const motionPermission = await window.DeviceMotionEvent.requestPermission();
      motionEnabled = motionPermission === 'granted';
    }
  } catch (error) {
    motionEnabled = false;
    statusLabel.textContent = 'Motion error';
    debugLabel.textContent = error.message;
    return false;
  }

  if (!motionEnabled) {
    statusLabel.textContent = 'Motion denied';
    calibrateButton.disabled = true;
    return false;
  }

  calibrateButton.disabled = false;
  return motionEnabled;
}

async function connectWithMotion() {
  connectButton.disabled = true;

  try {
    await enableMotion();
    connectSockets();
    updateConnectionStatus();
  } finally {
    connectButton.disabled = false;
  }
}

function connectSockets() {
  connectOrientationSocket();
  connectControlSocket();
}

function connectOrientationSocket() {
  if (orientationSocket && (orientationSocket.readyState === WebSocket.OPEN || orientationSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  orientationSocket = new WebSocket(`${getWebSocketBaseUrl()}/ws?role=player`);

  orientationSocket.addEventListener('open', () => {
    updateConnectionStatus();
  });

  orientationSocket.addEventListener('close', () => {
    updateConnectionStatus();
  });

  orientationSocket.addEventListener('error', () => {
    statusLabel.textContent = 'Server error';
  });
}

function connectControlSocket() {
  if (controlSocket && (controlSocket.readyState === WebSocket.OPEN || controlSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  controlSocket = new WebSocket(`${getWebSocketBaseUrl()}/ws/control?role=player`);

  controlSocket.addEventListener('open', () => {
    setControlButtonsEnabled(true);
    updateConnectionStatus();
  });

  controlSocket.addEventListener('close', () => {
    setControlButtonsEnabled(false);
    releaseAimJoystick();
    updateConnectionStatus();
  });

  controlSocket.addEventListener('error', () => {
    setControlButtonsEnabled(false);
    releaseAimJoystick();
    statusLabel.textContent = 'Control error';
  });
}

function bindAimJoystick() {
  if (!joystickZone || !joystickVisual || !joystickKnob) {
    return;
  }

  joystickZone.addEventListener('pointerdown', (event) => {
    if (joystickState.pointerId !== null) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (!isAimEnabled()) {
      return;
    }

    event.preventDefault();
    const rect = joystickZone.getBoundingClientRect();
    joystickState.pointerId = event.pointerId;
    joystickState.originX = event.clientX - rect.left;
    joystickState.originY = event.clientY - rect.top;
    joystickState.pointerDownTimeMs = performance.now();
    joystickState.maxDistanceFromOrigin = 0;
    joystickZone.classList.add('is-active');
    joystickZone.setPointerCapture(event.pointerId);
    joystickVisual.style.setProperty('--joystick-x', `${joystickState.originX}px`);
    joystickVisual.style.setProperty('--joystick-y', `${joystickState.originY}px`);
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    applyAimFromDelta(0, 0);
  });

  joystickZone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== joystickState.pointerId) {
      return;
    }

    event.preventDefault();
    const rect = joystickZone.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const deltaX = currentX - joystickState.originX;
    const deltaY = currentY - joystickState.originY;
    const limitedDelta = limitJoystickDelta(deltaX, deltaY);

    joystickState.maxDistanceFromOrigin = Math.max(
      joystickState.maxDistanceFromOrigin,
      Math.hypot(limitedDelta.x, limitedDelta.y),
    );
    joystickKnob.style.transform = `translate(calc(-50% + ${limitedDelta.x}px), calc(-50% + ${limitedDelta.y}px))`;
    applyAimFromDelta(limitedDelta.x, limitedDelta.y);
  });

  const endInteraction = (event) => {
    if (event.pointerId !== joystickState.pointerId) {
      return;
    }

    event.preventDefault();
    maybeToggleAimCameraFromTap(event);
    releaseAimJoystick();
  };

  joystickZone.addEventListener('pointerup', endInteraction);
  joystickZone.addEventListener('pointercancel', endInteraction);
  joystickZone.addEventListener('lostpointercapture', endInteraction);
}

window.addEventListener('blur', () => {
  stopAimControls();
  releaseAimJoystick();
});

function sendControlTap(action) {
  sendControlState(action, true);
}

function sendControlState(action, active, value = null) {
  if (!controlSocket || controlSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  controlSocket.send(encodeControlMessage(action, active, value));
}

function setControlButtonsEnabled(enabled) {
  for (const button of [clubPrevButton, clubNextButton, practiceSwingButton, actualSwingButton]) {
    if (button) {
      button.disabled = !enabled;
    }
  }

  if (joystickZone) {
    joystickZone.classList.toggle('is-disabled', !enabled);
  }
}

function updateConnectionStatus() {
  const orientationReady = orientationSocket?.readyState === WebSocket.OPEN;
  const controlReady = controlSocket?.readyState === WebSocket.OPEN;

  if (!orientationReady && !controlReady) {
    statusLabel.textContent = 'Offline';
    return;
  }

  if (!orientationReady) {
    statusLabel.textContent = 'Controls only';
    return;
  }

  if (!controlReady) {
    statusLabel.textContent = motionEnabled ? 'Motion only' : 'Enable motion';
    return;
  }

  if (!hasMotion && motionEventName) {
    statusLabel.textContent = 'Gyro wait';
    return;
  }

  statusLabel.textContent = motionEnabled ? 'Live' : 'Enable motion';
}

function getInstantaneousPerpendicularAngularSpeedRadiansPerSecond(rotationRate) {
  const alpha = Number(rotationRate?.alpha ?? 0);
  const beta = Number(rotationRate?.beta ?? 0);
  const gamma = Number(rotationRate?.gamma ?? 0);

  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return 0;
  }

  ANGULAR_VELOCITY_LOCAL.set(
    THREE.MathUtils.degToRad(beta),
    THREE.MathUtils.degToRad(alpha),
    THREE.MathUtils.degToRad(-gamma),
  );

  SHAFT_TWIST_COMPONENT.copy(CLUB_SHAFT_AXIS_LOCAL)
    .multiplyScalar(ANGULAR_VELOCITY_LOCAL.dot(CLUB_SHAFT_AXIS_LOCAL));
  ANGULAR_VELOCITY_LOCAL.sub(SHAFT_TWIST_COMPONENT);
  return ANGULAR_VELOCITY_LOCAL.length();
}

function hasFiniteRotationRate(rotationRate) {
  return ['alpha', 'beta', 'gamma'].some((axis) => Number.isFinite(Number(rotationRate?.[axis])));
}

function getOutboundPerpendicularAngularSpeedRadiansPerSecond() {
  if (!hasMotion || getMotionAgeMilliseconds() > MOTION_FRESHNESS_LIMIT_MS) {
    return 0;
  }

  return decayingPerpendicularAngularSpeedRadiansPerSecond;
}

function getMotionAgeMilliseconds() {
  if (!lastMotionSampleTimeMs) {
    return 65535;
  }

  return Math.min(Math.max(performance.now() - lastMotionSampleTimeMs, 0), 65535);
}

function updateDebugLabel() {
  const perpendicularAngularSpeedRadiansPerSecond = getOutboundPerpendicularAngularSpeedRadiansPerSecond();
  const motionState = hasMotion ? `${perpendicularAngularSpeedRadiansPerSecond.toFixed(DEBUG_ANGULAR_SPEED_DECIMALS)} rad/s` : 'gyro waiting';
  const ageMs = Math.round(getMotionAgeMilliseconds());
  debugLabel.textContent = `ori ${formatQuaternion(rawQuaternion)} | omega ${motionState} | age ${ageMs} ms`;
}

function deviceOrientationToQuaternion(alpha, beta, gamma, orient) {
  euler.set(beta, alpha, -gamma, 'YXZ');
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  quaternion.multiply(q1);
  quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  return quaternion.normalize();
}

function formatQuaternion(quaternion) {
  const { x, y, z, w } = quaternion;
  return `${x.toFixed(DEBUG_QUATERNION_DECIMALS)}, ${y.toFixed(DEBUG_QUATERNION_DECIMALS)}, ${z.toFixed(DEBUG_QUATERNION_DECIMALS)}, ${w.toFixed(DEBUG_QUATERNION_DECIMALS)}`;
}

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function getOrientationEventName() {
  if ('ondeviceorientationabsolute' in window) {
    return 'deviceorientationabsolute';
  }

  if ('ondeviceorientation' in window || typeof window.DeviceOrientationEvent !== 'undefined') {
    return 'deviceorientation';
  }

  return null;
}

function getMotionEventName() {
  if ('ondevicemotion' in window || typeof window.DeviceMotionEvent !== 'undefined') {
    return 'devicemotion';
  }

  return null;
}

function getUnsupportedMessage() {
  if (!window.isSecureContext) {
    return 'Use HTTPS';
  }

  if (!orientationEventName) {
    return 'No orientation';
  }

  if (!motionEventName) {
    return 'No gyro';
  }

  return 'No motion';
}

function isAimEnabled() {
  return controlSocket?.readyState === WebSocket.OPEN;
}

/**
 * Maps the 2D joystick displacement into separate analog rotate and aim-control magnitudes.
 */
function applyAimFromDelta(deltaX, deltaY) {
  const normalizedX = normalizeJoystickAxis(deltaX);
  const normalizedY = normalizeJoystickAxis(-deltaY);

  if (normalizedX < 0) {
    updateJoystickAction('rotate', CONTROL_ACTIONS.rotateLeft, Math.abs(normalizedX));
  } else if (normalizedX > 0) {
    updateJoystickAction('rotate', CONTROL_ACTIONS.rotateRight, normalizedX);
  } else {
    updateJoystickAction('rotate', null, 0);
  }

  if (normalizedY < 0) {
    updateJoystickAction('aim', CONTROL_ACTIONS.aimDecrease, Math.abs(normalizedY));
  } else if (normalizedY > 0) {
    updateJoystickAction('aim', CONTROL_ACTIONS.aimIncrease, normalizedY);
  } else {
    updateJoystickAction('aim', null, 0);
  }
}

function stopAimControls() {
  updateJoystickAction('rotate', null, 0);
  updateJoystickAction('aim', null, 0);
}

function releaseAimJoystick() {
  if (!joystickZone || !joystickKnob) {
    return;
  }

  stopAimControls();
  joystickState.pointerId = null;
  joystickZone.classList.remove('is-active');
  joystickKnob.style.transform = 'translate(-50%, -50%)';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamps the joystick knob to a circular range so diagonal movement keeps a consistent maximum magnitude.
 */
function limitJoystickDelta(deltaX, deltaY) {
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= JOYSTICK_RADIUS || distance <= 1e-8) {
    return { x: deltaX, y: deltaY };
  }

  const scale = JOYSTICK_RADIUS / distance;
  return {
    x: deltaX * scale,
    y: deltaY * scale,
  };
}

/**
 * Keeps small motions in a deadzone and remaps the remainder into a 0..1 analog range.
 */
function normalizeJoystickAxis(delta) {
  const magnitude = Math.abs(delta);
  if (magnitude <= JOYSTICK_DEADZONE) {
    return 0;
  }

  const normalizedMagnitude = clamp(
    (magnitude - JOYSTICK_DEADZONE) / Math.max(JOYSTICK_RADIUS - JOYSTICK_DEADZONE, 1),
    0,
    1,
  );
  return Math.sign(delta) * normalizedMagnitude;
}

/**
 * Sends only the changed joystick action/value pair so the viewer can mix analog mobile input with keyboard input.
 */
function updateJoystickAction(channel, action, strength) {
  const actionKey = channel === 'rotate' ? 'rotateAction' : 'aimAction';
  const strengthKey = channel === 'rotate' ? 'rotateStrength' : 'aimStrength';
  const nextStrength = roundJoystickStrength(strength);
  const currentAction = joystickState[actionKey];
  const currentStrength = joystickState[strengthKey];

  if (currentAction === action && Math.abs(currentStrength - nextStrength) <= 1e-3) {
    return;
  }

  if (currentAction && (currentAction !== action || nextStrength === 0)) {
    sendControlState(currentAction, false, 0);
  }

  joystickState[actionKey] = action;
  joystickState[strengthKey] = action ? nextStrength : 0;

  if (action && nextStrength > 0) {
    sendControlState(action, true, nextStrength);
  }
}

function roundJoystickStrength(value) {
  const clampedValue = clamp(value, 0, 1);
  return Math.round(clampedValue / JOYSTICK_NETWORK_STEP) * JOYSTICK_NETWORK_STEP;
}

/**
 * Treats a quick, low-movement release as a tap and toggles the aim camera on a nearby second tap.
 */
function maybeToggleAimCameraFromTap(event) {
  const tapDurationMs = performance.now() - joystickState.pointerDownTimeMs;
  const isTap = tapDurationMs <= JOYSTICK_TAP_MAX_DURATION_MS
    && joystickState.maxDistanceFromOrigin <= JOYSTICK_TAP_MAX_MOVEMENT;
  if (!isTap) {
    return;
  }

  const now = performance.now();
  const rect = joystickZone.getBoundingClientRect();
  const tapX = event.clientX - rect.left;
  const tapY = event.clientY - rect.top;
  const tapDistance = Math.hypot(tapX - joystickState.lastTapX, tapY - joystickState.lastTapY);
  const isDoubleTap = now - joystickState.lastTapTimeMs <= JOYSTICK_DOUBLE_TAP_WINDOW_MS
    && tapDistance <= JOYSTICK_DOUBLE_TAP_MAX_DISTANCE;

  joystickState.lastTapTimeMs = isDoubleTap ? 0 : now;
  joystickState.lastTapX = tapX;
  joystickState.lastTapY = tapY;

  if (isDoubleTap) {
    sendControlTap(CONTROL_ACTIONS.aimCameraToggle);
  }
}