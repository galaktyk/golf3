import * as THREE from 'three';
import { encodeQuaternionToPacket } from '/static/js/protocol.js';

const permissionButton = document.querySelector('#permission-button');
const connectButton = document.querySelector('#connect-button');
const calibrateButton = document.querySelector('#calibrate-button');
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
let socket = null;

neutralInverse.identity();

permissionButton.addEventListener('click', async () => {
  const granted = await enableMotion();
  if (granted) {
    statusLabel.textContent = 'Motion access granted.';
    calibrateButton.disabled = false;
  }
});

connectButton.addEventListener('click', () => {
  connectSocket();
});

calibrateButton.addEventListener('click', () => {
  if (!hasOrientation) {
    statusLabel.textContent = 'Move the phone first so a pose can be captured.';
    return;
  }

  neutralInverse.copy(rawQuaternion).invert();
  statusLabel.textContent = 'Neutral orientation captured.';
});

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

  if (!socket || socket.readyState !== WebSocket.OPEN || !hasOrientation) {
    return;
  }

  calibratedQuaternion.copy(neutralInverse).multiply(rawQuaternion).normalize();
  socket.send(encodeQuaternionToPacket(calibratedQuaternion));
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
  }

  return motionEnabled;
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(`${getWebSocketBaseUrl()}/ws?role=player`);

  socket.addEventListener('open', () => {
    statusLabel.textContent = motionEnabled
      ? 'Connected. Streaming live orientation.'
      : 'Connected. Enable motion to start streaming.';
  });

  socket.addEventListener('close', () => {
    statusLabel.textContent = 'Disconnected from server.';
  });

  socket.addEventListener('error', () => {
    statusLabel.textContent = 'Could not connect to the server.';
  });
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
  return `q = (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}, ${w.toFixed(3)})`;
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