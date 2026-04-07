import * as THREE from 'three';
import { CONTROL_ACTIONS, encodeControlMessage, encodeQuaternionToPacket } from '/static/js/protocol.js';

const connectButton = document.querySelector('#connect-button');
const calibrateButton = document.querySelector('#calibrate-button');
const clubPrevButton = document.querySelector('#club-prev-button');
const clubNextButton = document.querySelector('#club-next-button');
const rotateLeftButton = document.querySelector('#rotate-left-button');
const rotateRightButton = document.querySelector('#rotate-right-button');
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
    statusLabel.textContent = 'Move the phone first so a pose can be captured.';
    return;
  }

  neutralInverse.copy(rawQuaternion).invert();
  statusLabel.textContent = 'Neutral orientation captured.';
});

clubPrevButton.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.clubPrevious);
});

clubNextButton.addEventListener('click', () => {
  sendControlTap(CONTROL_ACTIONS.clubNext);
});

bindHoldControl(rotateLeftButton, CONTROL_ACTIONS.rotateLeft);
bindHoldControl(rotateRightButton, CONTROL_ACTIONS.rotateRight);

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
    debugLabel.textContent = formatQuaternion(rawQuaternion);
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
    statusLabel.textContent = `Motion permission failed: ${error.message}`;
    return false;
  }

  if (!motionEnabled) {
    statusLabel.textContent = 'Motion access was denied.';
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
    statusLabel.textContent = 'Could not connect to the server.';
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
    updateConnectionStatus();
  });

  controlSocket.addEventListener('error', () => {
    setControlButtonsEnabled(false);
    statusLabel.textContent = 'Could not connect control channel.';
  });
}

function bindHoldControl(button, action) {
  if (!button) {
    return;
  }

  const start = (event) => {
    event.preventDefault();
    sendControlState(action, true);
  };
  const stop = (event) => {
    if (event) {
      event.preventDefault();
    }
    sendControlState(action, false);
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('lostpointercapture', stop);
}

window.addEventListener('blur', () => {
  sendControlState(CONTROL_ACTIONS.rotateLeft, false);
  sendControlState(CONTROL_ACTIONS.rotateRight, false);
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
  for (const button of [clubPrevButton, clubNextButton, rotateLeftButton, rotateRightButton]) {
    if (button) {
      button.disabled = !enabled;
    }
  }
}

function updateConnectionStatus() {
  const orientationReady = orientationSocket?.readyState === WebSocket.OPEN;
  const controlReady = controlSocket?.readyState === WebSocket.OPEN;

  if (!orientationReady && !controlReady) {
    statusLabel.textContent = 'Disconnected from server.';
    return;
  }

  if (!orientationReady) {
    statusLabel.textContent = 'Control connected. Orientation channel disconnected.';
    return;
  }

  if (!controlReady) {
    statusLabel.textContent = motionEnabled
      ? 'Orientation connected. Control channel disconnected.'
      : 'Orientation connected. Enable motion to start streaming.';
    return;
  }

  statusLabel.textContent = motionEnabled
    ? 'Connected. Streaming orientation and remote controls.'
    : 'Connected. Enable motion to start streaming.';
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
    return 'Motion sensors are unavailable here. This phone browser likely requires HTTPS or localhost for device orientation.';
  }

  return 'Device orientation is not available in this phone browser.';
}