import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BALL_START_POSITION,
  CAMERA_FOLLOW_STIFFNESS,
  CAMERA_LOOK_AHEAD_DISTANCE,
  CAMERA_START_DISTANCE,
  CHARACTER_SETUP_OFFSET,
  WORLD_FORWARD,
  MAP_TEE_ORIGIN,
  MAX_RENDER_PIXEL_RATIO,
} from '/static/js/game/constants.js';

export function createViewerScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'high-performance' });
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
    new THREE.MeshBasicMaterial({
      color: '#d9d9d9',
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
  const ballRoot = new THREE.Group();
  const clubRoot = new THREE.Group();
  const characterRoot = new THREE.Group();
  const rotatedCharacterSetupOffset = new THREE.Vector3();
  const characterForward = new THREE.Vector3();

  scene.add(mapRoot);
  scene.add(ballRoot);
  scene.add(clubRoot);
  scene.add(characterRoot);

  let mapBounds = null;
  let courseCollision = null;
  let clubHeadCollider = null;
  let ballCameraFollowEnabled = true;
  const ballCameraOffset = new THREE.Vector3().subVectors(camera.position, BALL_START_POSITION);
  const desiredCameraPosition = new THREE.Vector3();
  const desiredCameraTarget = new THREE.Vector3();

  const setCharacterAddressPosition = (ballPosition) => {
    rotatedCharacterSetupOffset.copy(CHARACTER_SETUP_OFFSET).applyQuaternion(characterRoot.quaternion);
    characterRoot.position.copy(ballPosition).add(rotatedCharacterSetupOffset);
  };

  const getCharacterForward = (target) => {
    target.copy(WORLD_FORWARD).applyQuaternion(characterRoot.quaternion);
    target.y = 0;
    if (target.lengthSq() <= 1e-8) {
      target.copy(WORLD_FORWARD);
      return target;
    }

    return target.normalize();
  };

  setCharacterAddressPosition(BALL_START_POSITION);

  controls.addEventListener('change', () => {
    if (!ballCameraFollowEnabled) {
      return;
    }

    ballCameraOffset.copy(camera.position).sub(controls.target);
  });

  updateRendererSize(renderer);

  return {
    renderer,
    scene,
    camera,
    controls,
    keyLight,
    mapRoot,
    ballRoot,
    clubRoot,
    characterRoot,

    get mapBounds() {
      return mapBounds;
    },

    get courseCollision() {
      return courseCollision;
    },

    setMapBounds(bounds) {
      mapBounds = bounds;
    },

    setCourseCollision(nextCourseCollision) {
      courseCollision = nextCourseCollision;
    },

    setClubHeadCollider(nextClubHeadCollider) {
      clubHeadCollider = nextClubHeadCollider;
    },

    getClubHeadCollider() {
      return clubHeadCollider;
    },

    getCharacterForward(target) {
      return getCharacterForward(target);
    },

    setBallCameraFollowEnabled(enabled) {
      ballCameraFollowEnabled = enabled;
      if (enabled) {
        this.resetBallCameraFollow();
      }
    },

    placeMapOriginAtTee() {
      mapRoot.position.set(-MAP_TEE_ORIGIN.x, -MAP_TEE_ORIGIN.y, -MAP_TEE_ORIGIN.z);
    },

    positionBallAtStart() {
      ballRoot.position.copy(BALL_START_POSITION);
      if (ballCameraFollowEnabled) {
        this.resetBallCameraFollow();
      }
    },

    positionCharacterForBall(ballPosition) {
      setCharacterAddressPosition(ballPosition);
    },



    setInitialCameraPose() {
      const clubPosition = clubRoot.position.clone();
      const forward = WORLD_FORWARD.clone().normalize();
      const startPosition = clubPosition.clone().addScaledVector(forward, -CAMERA_START_DISTANCE);
      const lookTarget = BALL_START_POSITION.clone().addScaledVector(forward, CAMERA_LOOK_AHEAD_DISTANCE);

      camera.position.copy(startPosition);
      camera.near = 0.01;
      camera.far = mapBounds && !mapBounds.isEmpty()
        ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 4, 2000)
        : 2000;
      controls.target.copy(lookTarget);
      controls.maxDistance = mapBounds && !mapBounds.isEmpty()
        ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 2, 20)
        : 500;
      this.resetBallCameraFollow();
      controls.update();
      camera.updateProjectionMatrix();
    },

    resetBallCameraFollow() {
      const followTarget = ballRoot.position.lengthSq() > 0 ? ballRoot.position : BALL_START_POSITION;
      controls.target.copy(followTarget);
      ballCameraOffset.copy(camera.position).sub(followTarget);
    },

    updateBallFollowCamera(deltaSeconds) {
      if (!ballCameraFollowEnabled) {
        return;
      }

      const followAlpha = 1 - Math.exp(-CAMERA_FOLLOW_STIFFNESS * deltaSeconds);
      desiredCameraTarget.copy(ballRoot.position);
      desiredCameraPosition.copy(ballRoot.position).add(ballCameraOffset);
      controls.target.lerp(desiredCameraTarget, followAlpha);
      camera.position.lerp(desiredCameraPosition, followAlpha);
    },

    positionLightsForMap() {
      if (!mapBounds || mapBounds.isEmpty()) {
        return;
      }

      const size = mapBounds.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 1);
      keyLight.position.set(maxDimension * 0.35, maxDimension * 0.6, maxDimension * 0.3);
    },

    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      updateRendererSize(renderer);
    },
  };
}

function updateRendererSize(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}