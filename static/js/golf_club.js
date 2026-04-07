import * as THREE from 'three';
import { CONTROL_ACTIONS, encodeControlMessage, encodeQuaternionToPacket } from '/static/js/protocol.js';

const connectButton = document.querySelector('#connect-button');
const calibrateButton = document.querySelector('#calibrate-button');
const clubPrevButton = document.querySelector('#club-prev-button');
const clubNextButton = document.querySelector('#club-next-button');
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

const rawQuaternion = new THREE.Quaternion();
const calibratedQuaternion = new THREE.Quaternion();
const neutralInverse = new THREE.Quaternion();

const joystickState = {
  pointerId: null,
  originX: 0,
  originY: 0,
  direction: null,
};

const JOYSTICK_RADIUS = 56;
const JOYSTICK_DEADZONE = 18;

let motionEnabled = false;
let hasOrientation = false;
let orientationSocket = null;
let controlSocket = null;

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
    debugLabel.textContent = `ori ${formatQuaternion(rawQuaternion)}`;
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
  orientationSocket.send(encodeQuaternionToPacket(calibratedQuaternion));
}, 1000 / 60);

async function enableMotion() {
  if (!orientationEventName) {
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
    joystickZone.classList.add('is-active');
    joystickZone.setPointerCapture(event.pointerId);
    joystickVisual.style.setProperty('--joystick-x', `${joystickState.originX}px`);
    joystickVisual.style.setProperty('--joystick-y', `${joystickState.originY}px`);
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    applyAimFromDelta(0);
  });

  joystickZone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== joystickState.pointerId) {
      return;
    }

    event.preventDefault();
    const rect = joystickZone.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const deltaX = currentX - joystickState.originX;
    const limitedX = clamp(deltaX, -JOYSTICK_RADIUS, JOYSTICK_RADIUS);

    joystickKnob.style.transform = `translate(calc(-50% + ${limitedX}px), -50%)`;
    applyAimFromDelta(limitedX);
  });

  const endInteraction = (event) => {
    if (event.pointerId !== joystickState.pointerId) {
      return;
    }

    event.preventDefault();
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

function sendControlState(action, active) {
  if (!controlSocket || controlSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  controlSocket.send(encodeControlMessage(action, active));
}

function setControlButtonsEnabled(enabled) {
  for (const button of [clubPrevButton, clubNextButton]) {
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

  statusLabel.textContent = motionEnabled ? 'Live' : 'Enable motion';
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
  return `${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}, ${w.toFixed(2)}`;
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

function getUnsupportedMessage() {
  if (!window.isSecureContext) {
    return 'Use HTTPS';
  }

  return 'No motion';
}

function isAimEnabled() {
  return controlSocket?.readyState === WebSocket.OPEN;
}

function applyAimFromDelta(deltaX) {
  let direction = null;

  if (deltaX <= -JOYSTICK_DEADZONE) {
    direction = CONTROL_ACTIONS.rotateLeft;
  } else if (deltaX >= JOYSTICK_DEADZONE) {
    direction = CONTROL_ACTIONS.rotateRight;
  }

  if (direction === joystickState.direction) {
    return;
  }

  if (joystickState.direction) {
    sendControlState(joystickState.direction, false);
  }

  joystickState.direction = direction;

  if (direction) {
    sendControlState(direction, true);
  }
}

function stopAimControls() {
  if (joystickState.direction) {
    sendControlState(joystickState.direction, false);
    joystickState.direction = null;
  }
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