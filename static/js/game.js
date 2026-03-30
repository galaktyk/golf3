import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { decodeQuaternionPacket } from '/static/js/protocol.js';

const canvas = document.querySelector('#scene');
const statusLabel = document.querySelector('#viewer-status');
const socketStateLabel = document.querySelector('#viewer-socket-state');
const packetRateLabel = document.querySelector('#viewer-packet-rate');
const quaternionLabel = document.querySelector('#viewer-quaternion');
const cameraPositionLabel = document.querySelector('#viewer-camera-position');

const TEE_ORIGIN = new THREE.Vector3(-0.1228, -0.9267, -0.8853);
const CLUB_FORWARD = new THREE.Vector3(0, 0, -1);
const CLUB_OFFSET = new THREE.Vector3(-0.3, 0.8, 0);
const CAMERA_START_DISTANCE = 6;
const CAMERA_LOOK_AHEAD_DISTANCE = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050d18');

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 2000);
camera.position.set(2.6, 1.8, 4.4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 0.01;
controls.maxDistance = 500;
controls.update();

const ambientLight = new THREE.HemisphereLight('#d8f8ff', '#18304c', 1.5);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight('#ffffff', 2.4);
keyLight.position.set(4, 5, 3);
scene.add(keyLight);

const originCube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({
    color: '#d9d9d9',
    roughness: 0.7,
    metalness: 0.05,
    transparent: true,
    opacity: 0.45,
  }),
);
scene.add(originCube);

const originCubeEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(originCube.geometry),
  new THREE.LineBasicMaterial({ color: '#101820' }),
);
scene.add(originCubeEdges);

const mapRoot = new THREE.Group();
scene.add(mapRoot);

const clubRoot = new THREE.Group();
scene.add(clubRoot);

const loader = new GLTFLoader();
let mapBounds = null;

loader.load(
  '/assets/models/maps/blue_lagoon_1.glb',
  (gltf) => {
    disableFrustumCulling(gltf.scene);
    configureMapMaterials(gltf.scene);
    mapRoot.add(gltf.scene);
    placeMapOriginAtTee(mapRoot);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    positionClubAtTee();
    positionLightsForMap(mapBounds);
    setInitialCameraPose();
  },
  undefined,
  (error) => {
    statusLabel.textContent = 'Failed to load course model.';
    console.error(error);
  },
);

loader.load(
  '/assets/models/golf_club.glb',
  (gltf) => {
    disableFrustumCulling(gltf.scene);
    clubRoot.add(gltf.scene);
    positionClubAtTee();
    setInitialCameraPose();
  },
  undefined,
  (error) => {
    statusLabel.textContent = 'Failed to load golf club model.';
    console.error(error);
  },
);

const incomingQuaternion = new THREE.Quaternion();
let packetsSinceLastSample = 0;
let lastPacketSampleTime = performance.now();

const socket = new WebSocket(`${getWebSocketBaseUrl()}/ws?role=viewer`);
socket.binaryType = 'arraybuffer';

updateSocketState('Connecting');
updatePacketRate(0);
updateQuaternionLabel(incomingQuaternion);
updateCameraPositionLabel(camera.position);

socket.addEventListener('open', () => {
  statusLabel.textContent = 'Viewer connected. Waiting for phone data.';
  updateSocketState('Connected');
});

socket.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    const payload = JSON.parse(event.data);
    if (payload.type === 'status') {
      statusLabel.textContent = payload.playerConnected
        ? 'Phone connected. Streaming live orientation.'
        : 'Viewer connected. Waiting for phone data.';
    }
    return;
  }

  decodeQuaternionPacket(event.data, incomingQuaternion);
  clubRoot.quaternion.copy(incomingQuaternion);
  packetsSinceLastSample += 1;
  updateQuaternionLabel(incomingQuaternion);
});

socket.addEventListener('close', () => {
  statusLabel.textContent = 'Viewer disconnected from server.';
  updateSocketState('Disconnected');
  updatePacketRate(0);
});

socket.addEventListener('error', () => {
  updateSocketState('Error');
});

function animate() {
  updatePacketRateIfNeeded();
  controls.update();
  updateCameraPositionLabel(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function getWebSocketBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function placeMapOriginAtTee(object) {
  object.position.set(-TEE_ORIGIN.x, -TEE_ORIGIN.y, -TEE_ORIGIN.z);
}

function setInitialCameraPose() {
  const clubPosition = clubRoot.position.clone();
  const forward = CLUB_FORWARD.clone().normalize();
  const startPosition = clubPosition.clone().addScaledVector(forward, -CAMERA_START_DISTANCE);
  const lookTarget = clubPosition.clone().addScaledVector(forward, CAMERA_LOOK_AHEAD_DISTANCE);

  camera.position.copy(startPosition);
  camera.near = 0.01;
  camera.far = mapBounds && !mapBounds.isEmpty()
    ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 4, 2000)
    : 2000;
  controls.target.copy(lookTarget);
  controls.maxDistance = mapBounds && !mapBounds.isEmpty()
    ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 2, 20)
    : 500;
  controls.update();
  camera.updateProjectionMatrix();
}

function positionClubAtTee() {
  clubRoot.position.copy(CLUB_OFFSET);
}

function disableFrustumCulling(root) {
  root.traverse((node) => {
    node.frustumCulled = false;
  });
}

function configureMapMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];

    materials.forEach((material) => {
      if (!material) {
        return;
      }

      const hasAlphaTexture = Boolean(material.map || material.alphaMap);

      if (hasAlphaTexture) {
        material.alphaTest = Math.max(material.alphaTest ?? 0, 0.01);
        material.transparent = false;
        material.depthWrite = true;
      }

      if (material.transparent || material.opacity < 1) {
        material.depthWrite = false;

        if (material.side === THREE.DoubleSide) {
          material.forceSinglePass = true;
        }
      }

      material.needsUpdate = true;
    });
  });
}

function positionLightsForMap(bounds) {
  if (!bounds || bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  keyLight.position.set(maxDimension * 0.35, maxDimension * 0.6, maxDimension * 0.3);
}

function updatePacketRateIfNeeded() {
  const now = performance.now();
  const elapsedMs = now - lastPacketSampleTime;
  if (elapsedMs < 250) {
    return;
  }

  const packetsPerSecond = packetsSinceLastSample / (elapsedMs / 1000);
  updatePacketRate(packetsPerSecond);
  packetsSinceLastSample = 0;
  lastPacketSampleTime = now;
}

function updateSocketState(state) {
  socketStateLabel.textContent = state;
}

function updatePacketRate(value) {
  packetRateLabel.textContent = `${value.toFixed(1)} pkt/s`;
}

function updateQuaternionLabel(quaternion) {
  quaternionLabel.textContent = formatQuaternion(quaternion);
}

function updateCameraPositionLabel(position) {
  cameraPositionLabel.textContent = formatVector3(position);
}

function formatQuaternion(quaternion) {
  const { x, y, z, w } = quaternion;
  return `(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}, ${w.toFixed(3)})`;
}

function formatVector3(vector) {
  return `(${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)})`;
}