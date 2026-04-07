import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BALL_START_POSITION,
  CAMERA_FOLLOW_STIFFNESS,
  CAMERA_LOOK_AHEAD_DISTANCE,
  CAMERA_START_DISTANCE,
  CAMERA_TILT_OFFSET_DEGREES,
  CHARACTER_SETUP_OFFSET,
  CHARACTER_VISUAL_YAW_OFFSET_DEGREES,
  FREE_CAMERA_LOOK_SENSITIVITY,
  FREE_CAMERA_MOVE_SPEED,
  FREE_CAMERA_PITCH_LIMIT_DEGREES,
  WORLD_FORWARD,
  MAP_TEE_ORIGIN,
  MAX_RENDER_PIXEL_RATIO,
} from '/static/js/game/constants.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CAMERA_TILT_OFFSET_RADIANS = THREE.MathUtils.degToRad(CAMERA_TILT_OFFSET_DEGREES);
const FREE_CAMERA_PITCH_LIMIT_RADIANS = THREE.MathUtils.degToRad(FREE_CAMERA_PITCH_LIMIT_DEGREES);

export function createViewerScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050d18');

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 2000);
  camera.position.set(2.6, 1.8, 4.4);
  scene.add(camera);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableRotate = false;
  controls.enableZoom = false;
  controls.enabled = false;
  controls.target.set(0, 0, 0);
  controls.minDistance = 0.01;
  controls.maxDistance = 500;
  controls.update();

  const ambientLight = new THREE.HemisphereLight('#d8f8ff', '#18304c', 1.5);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight('#ffffff', 2.4);
  keyLight.position.set(4, 5, 3);
  scene.add(keyLight);




  const mapRoot = new THREE.Group();
  const ballRoot = new THREE.Group();
  const clubRoot = new THREE.Group();
  const characterRoot = new THREE.Group();
  const characterVisualRoot = new THREE.Group();
  const overlayRoot = new THREE.Group();
  const rotatedCharacterSetupOffset = new THREE.Vector3();
  const characterForward = new THREE.Vector3();
  const desiredFacingDirection = new THREE.Vector3();
  const currentFacingDirection = new THREE.Vector3();
  const freeCameraForward = new THREE.Vector3();
  const freeCameraRight = new THREE.Vector3();
  const freeCameraTranslation = new THREE.Vector3();
  const cameraOrientationForward = new THREE.Vector3();
  const characterOrientationForward = new THREE.Vector3();

  scene.add(mapRoot);
  scene.add(ballRoot);
  scene.add(clubRoot);
  scene.add(characterRoot);
  characterRoot.add(characterVisualRoot);
  camera.add(overlayRoot);

  characterVisualRoot.rotation.y = THREE.MathUtils.degToRad(CHARACTER_VISUAL_YAW_OFFSET_DEGREES);

  let mapBounds = null;
  let courseCollision = null;
  let clubHeadCollider = null;
  let holeMarker = null;
  let ballCameraFollowEnabled = true;
  let freeCameraEnabled = false;
  let freeCameraYaw = 0;
  let freeCameraPitch = 0;
  const ballCameraOffset = new THREE.Vector3().subVectors(camera.position, BALL_START_POSITION);
  const desiredCameraPosition = new THREE.Vector3();
  const desiredCameraTarget = new THREE.Vector3();
  const tiltedCameraTarget = new THREE.Vector3();
  const cameraTiltAxis = new THREE.Vector3();
  const cameraTiltDirection = new THREE.Vector3();

  const applyTiltedCameraTarget = (cameraPosition, focusPoint, target) => {
    cameraTiltDirection.subVectors(focusPoint, cameraPosition);
    const focusDistance = cameraTiltDirection.length();
    if (focusDistance <= 1e-6) {
      target.copy(focusPoint);
      return target;
    }

    cameraTiltDirection.multiplyScalar(1 / focusDistance);
    cameraTiltAxis.crossVectors(cameraTiltDirection, WORLD_UP);
    if (cameraTiltAxis.lengthSq() <= 1e-8) {
      target.copy(focusPoint);
      return target;
    }

    cameraTiltAxis.normalize();
    cameraTiltDirection.applyAxisAngle(cameraTiltAxis, CAMERA_TILT_OFFSET_RADIANS);
    target.copy(cameraPosition).addScaledVector(cameraTiltDirection, focusDistance);
    return target;
  };

  const syncFreeCameraAnglesFromCamera = () => {
    camera.getWorldDirection(freeCameraForward);
    freeCameraForward.normalize();
    freeCameraPitch = Math.asin(THREE.MathUtils.clamp(freeCameraForward.y, -1, 1));
    freeCameraYaw = Math.atan2(freeCameraForward.x, -freeCameraForward.z);
  };

  const applyFreeCameraRotation = () => {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = freeCameraYaw;
    camera.rotation.x = freeCameraPitch;
    camera.rotation.z = 0;
    camera.updateMatrixWorld(true);
  };

  const restoreBallCameraFollowPose = () => {
    const followTarget = ballRoot.position.lengthSq() > 0 ? ballRoot.position : BALL_START_POSITION;
    controls.target.copy(followTarget);
    camera.position.copy(followTarget).add(ballCameraOffset);
    controls.update();
    applyTiltedCameraTarget(camera.position, controls.target, tiltedCameraTarget);
    camera.lookAt(tiltedCameraTarget);
  };

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

  const getOrientationDebugSnapshot = () => {
    camera.getWorldDirection(cameraOrientationForward);
    cameraOrientationForward.normalize();
    getCharacterForward(characterOrientationForward);

    return {
      camera: {
        yawDegrees: Number(THREE.MathUtils.radToDeg(Math.atan2(cameraOrientationForward.x, -cameraOrientationForward.z)).toFixed(2)),
        pitchDegrees: Number(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(cameraOrientationForward.y, -1, 1))).toFixed(2)),
        direction: {
          x: Number(cameraOrientationForward.x.toFixed(4)),
          y: Number(cameraOrientationForward.y.toFixed(4)),
          z: Number(cameraOrientationForward.z.toFixed(4)),
        },
      },
      character: {
        yawDegrees: Number(THREE.MathUtils.radToDeg(Math.atan2(characterOrientationForward.x, -characterOrientationForward.z)).toFixed(2)),
        forward: {
          x: Number(characterOrientationForward.x.toFixed(4)),
          y: Number(characterOrientationForward.y.toFixed(4)),
          z: Number(characterOrientationForward.z.toFixed(4)),
        },
      },
    };
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
    characterVisualRoot,
    overlayRoot,

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

    setHoleMarker(nextHoleMarker) {
      holeMarker = nextHoleMarker;
    },

    getHoleMarker() {
      return holeMarker;
    },

    applyCameraTilt() {
      if (freeCameraEnabled) {
        return;
      }

      applyTiltedCameraTarget(camera.position, controls.target, tiltedCameraTarget);
      camera.lookAt(tiltedCameraTarget);
    },

    updateControls() {
      if (freeCameraEnabled) {
        return;
      }

      controls.update();
    },

    getCharacterForward(target) {
      return getCharacterForward(target);
    },

    getOrientationDebugSnapshot() {
      return getOrientationDebugSnapshot();
    },

    isFreeCameraEnabled() {
      return freeCameraEnabled;
    },

    setFreeCameraEnabled(enabled) {
      if (freeCameraEnabled === enabled) {
        return freeCameraEnabled;
      }

      freeCameraEnabled = enabled;
      controls.enabled = !enabled;
      if (enabled) {
        syncFreeCameraAnglesFromCamera();
        ballCameraFollowEnabled = false;
      } else {
        this.setBallCameraFollowEnabled(true);
      }

      return freeCameraEnabled;
    },

    rotateFreeCamera(deltaX, deltaY) {
      if (!freeCameraEnabled) {
        return;
      }

      freeCameraYaw -= deltaX * FREE_CAMERA_LOOK_SENSITIVITY;
      freeCameraPitch = THREE.MathUtils.clamp(
        freeCameraPitch - deltaY * FREE_CAMERA_LOOK_SENSITIVITY,
        -FREE_CAMERA_PITCH_LIMIT_RADIANS,
        FREE_CAMERA_PITCH_LIMIT_RADIANS,
      );
      applyFreeCameraRotation();
    },

    updateFreeCamera(deltaSeconds, movementInput) {
      if (!freeCameraEnabled) {
        return;
      }

      camera.getWorldDirection(freeCameraForward);
      freeCameraForward.normalize();
      freeCameraRight.crossVectors(freeCameraForward, WORLD_UP);
      if (freeCameraRight.lengthSq() <= 1e-8) {
        freeCameraRight.set(1, 0, 0);
      } else {
        freeCameraRight.normalize();
      }

      freeCameraTranslation.set(0, 0, 0);
      freeCameraTranslation.addScaledVector(freeCameraForward, movementInput.forward);
      freeCameraTranslation.addScaledVector(freeCameraRight, movementInput.right);
      if (freeCameraTranslation.lengthSq() <= 1e-8) {
        return;
      }

      freeCameraTranslation.normalize().multiplyScalar(FREE_CAMERA_MOVE_SPEED * deltaSeconds);
      camera.position.add(freeCameraTranslation);
      camera.updateMatrixWorld(true);
    },

    setBallCameraFollowEnabled(enabled) {
      ballCameraFollowEnabled = enabled;
      if (enabled) {
        restoreBallCameraFollowPose();
      }
    },

    placeMapOriginAtTee() {
      mapRoot.position.set(-MAP_TEE_ORIGIN.x, -MAP_TEE_ORIGIN.y, -MAP_TEE_ORIGIN.z);
    },

    positionBallAtStart() {
      ballRoot.position.copy(BALL_START_POSITION);
      if (ballCameraFollowEnabled) {
        restoreBallCameraFollowPose();
      }
    },

    positionCharacterForBall(ballPosition) {
      setCharacterAddressPosition(ballPosition);
    },

    faceViewToward(ballPosition, targetPosition) {
      desiredFacingDirection.subVectors(targetPosition, ballPosition);
      desiredFacingDirection.y = 0;
      if (desiredFacingDirection.lengthSq() <= 1e-8) {
        return;
      }

      desiredFacingDirection.normalize();
      currentFacingDirection.subVectors(ballPosition, camera.position);
      currentFacingDirection.y = 0;
      if (currentFacingDirection.lengthSq() <= 1e-8) {
        getCharacterForward(currentFacingDirection);
      } else {
        currentFacingDirection.normalize();
      }

      const rotationDelta = Math.atan2(
        (currentFacingDirection.z * desiredFacingDirection.x) - (currentFacingDirection.x * desiredFacingDirection.z),
        THREE.MathUtils.clamp(currentFacingDirection.dot(desiredFacingDirection), -1, 1),
      );
      if (Math.abs(rotationDelta) <= 1e-5) {
        return;
      }

      this.rotateCharacterAroundBall(ballPosition, rotationDelta);
    },

    rotateCharacterAroundBall(ballPosition, angleRadians) {
      characterRoot.rotateY(angleRadians);
      setCharacterAddressPosition(ballPosition);
      ballCameraOffset.applyAxisAngle(WORLD_UP, angleRadians);
      controls.target.copy(ballPosition);
      camera.position.copy(ballPosition).add(ballCameraOffset);
      controls.update();
      this.applyCameraTilt();
      characterRoot.updateMatrixWorld(true);
    },



    setInitialCameraPose() {
      const forward = WORLD_FORWARD.clone().normalize();
      const startPosition = BALL_START_POSITION.clone().addScaledVector(forward, -CAMERA_START_DISTANCE);
      startPosition.y = clubRoot.position.y;
      const lookFocusPoint = BALL_START_POSITION.clone().addScaledVector(forward, CAMERA_LOOK_AHEAD_DISTANCE);

      camera.position.copy(startPosition);
      camera.near = 0.01;
      camera.far = mapBounds && !mapBounds.isEmpty()
        ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 4, 2000)
        : 2000;
      controls.target.copy(lookFocusPoint);
      controls.maxDistance = mapBounds && !mapBounds.isEmpty()
        ? Math.max(mapBounds.getSize(new THREE.Vector3()).length() * 2, 20)
        : 500;
      ballCameraOffset.copy(camera.position).sub(lookFocusPoint);
      controls.update();
      this.applyCameraTilt();
      camera.updateProjectionMatrix();
    },

    resetBallCameraFollow() {
      restoreBallCameraFollowPose();
    },

    updateBallFollowCamera(deltaSeconds) {
      if (!ballCameraFollowEnabled || freeCameraEnabled) {
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
      if (freeCameraEnabled) {
        applyFreeCameraRotation();
      }
      updateRendererSize(renderer);
    },
  };
}

function updateRendererSize(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}