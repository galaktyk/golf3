import * as THREE from 'three';
import {
  BALL_AIR_DRAG,
  BALL_COLLISION_SKIN,
  BALL_FIXED_STEP_SECONDS,
  BALL_GRAVITY_ACCELERATION,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_MAX_COLLISION_ITERATIONS,
  BALL_RADIUS,
} from '/static/js/game/constants.js';
import { sweepSphereBVH } from '/static/js/game/collision.js';

const PREVIEW_MAX_SIMULATION_SECONDS = 12;
const PREVIEW_MAX_STEPS = Math.ceil(PREVIEW_MAX_SIMULATION_SECONDS / BALL_FIXED_STEP_SECONDS);
const PREVIEW_GRAVITY = new THREE.Vector3(0, -BALL_GRAVITY_ACCELERATION, 0);
const PREVIEW_HORIZONTAL_FORWARD = new THREE.Vector3();
const PREVIEW_LAUNCH_DIRECTION = new THREE.Vector3();
const PREVIEW_VELOCITY = new THREE.Vector3();
const PREVIEW_POSITION = new THREE.Vector3();
const PREVIEW_DISPLACEMENT = new THREE.Vector3();
const PREVIEW_CAMERA_FORWARD = new THREE.Vector3();
const PREVIEW_FALLBACK_POINT = new THREE.Vector3();
const PREVIEW_START_POSITION = new THREE.Vector3();
const PREVIEW_CLEARANCE_HEIGHT_METERS = BALL_RADIUS * 0.12;
const PREVIEW_MIN_LANDING_TRAVEL_METERS = Math.max(BALL_RADIUS * 2, 0.08);

export function predictFirstLandingPoint(viewerScene, startPosition, launchData, referenceForward = null) {
  if (!viewerScene?.courseCollision?.root || !startPosition || !launchData) {
    return null;
  }

  if (!Number.isFinite(launchData.ballSpeed) || launchData.ballSpeed <= 0) {
    return null;
  }

  PREVIEW_START_POSITION.copy(startPosition);
  PREVIEW_POSITION.copy(startPosition);
  PREVIEW_VELOCITY.copy(buildPreviewLaunchVelocity(launchData, viewerScene, referenceForward));
  let hasClearedLaunch = false;

  for (let stepIndex = 0; stepIndex < PREVIEW_MAX_STEPS; stepIndex += 1) {
    PREVIEW_VELOCITY.addScaledVector(PREVIEW_GRAVITY, BALL_FIXED_STEP_SECONDS);
    PREVIEW_VELOCITY.multiplyScalar(Math.exp(-BALL_AIR_DRAG * BALL_FIXED_STEP_SECONDS));
    PREVIEW_DISPLACEMENT.copy(PREVIEW_VELOCITY).multiplyScalar(BALL_FIXED_STEP_SECONDS);

    const sweep = sweepSphereBVH(viewerScene.courseCollision, PREVIEW_POSITION, PREVIEW_DISPLACEMENT, BALL_RADIUS, {
      maxIterations: BALL_MAX_COLLISION_ITERATIONS,
      skin: BALL_COLLISION_SKIN,
    });
    PREVIEW_POSITION.copy(sweep.position);

    const horizontalTravelMeters = Math.hypot(
      PREVIEW_POSITION.x - PREVIEW_START_POSITION.x,
      PREVIEW_POSITION.z - PREVIEW_START_POSITION.z,
    );
    if (
      !hasClearedLaunch
      && (
        PREVIEW_POSITION.y > PREVIEW_START_POSITION.y + PREVIEW_CLEARANCE_HEIGHT_METERS
        || horizontalTravelMeters >= PREVIEW_MIN_LANDING_TRAVEL_METERS
      )
    ) {
      hasClearedLaunch = true;
    }

    if (!sweep.collided) {
      continue;
    }

    const isGroundLikeContact = sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y;
    if (!hasClearedLaunch && isGroundLikeContact) {
      continue;
    }

    const landingPoint = PREVIEW_FALLBACK_POINT
      .copy(PREVIEW_POSITION)
      .addScaledVector(sweep.hitNormal, -(BALL_RADIUS + BALL_COLLISION_SKIN))
      .clone();

    return {
      point: landingPoint,
      carryDistanceMeters: Math.hypot(landingPoint.x - startPosition.x, landingPoint.z - startPosition.z),
    };
  }

  return null;
}

function buildPreviewLaunchVelocity(launchData, viewerScene, referenceForward = null) {
  if (referenceForward && referenceForward.lengthSq() > 1e-8) {
    PREVIEW_HORIZONTAL_FORWARD.copy(referenceForward);
  } else {
    viewerScene.camera.getWorldDirection(PREVIEW_CAMERA_FORWARD);
    PREVIEW_HORIZONTAL_FORWARD.copy(PREVIEW_CAMERA_FORWARD);
  }

  PREVIEW_HORIZONTAL_FORWARD.y = 0;
  if (PREVIEW_HORIZONTAL_FORWARD.lengthSq() <= 1e-8) {
    PREVIEW_HORIZONTAL_FORWARD.set(0, 0, -1);
  } else {
    PREVIEW_HORIZONTAL_FORWARD.normalize();
  }

  const verticalAngleRadians = THREE.MathUtils.degToRad(launchData.verticalLaunchAngle);
  const horizontalAngleRadians = THREE.MathUtils.degToRad(launchData.horizontalLaunchAngle);
  const forwardSpeed = launchData.ballSpeed * Math.cos(verticalAngleRadians);
  const upwardSpeed = launchData.ballSpeed * Math.sin(verticalAngleRadians);

  PREVIEW_LAUNCH_DIRECTION.copy(PREVIEW_HORIZONTAL_FORWARD).applyAxisAngle(THREE.Object3D.DEFAULT_UP, horizontalAngleRadians);
  return PREVIEW_LAUNCH_DIRECTION.multiplyScalar(forwardSpeed)
    .addScaledVector(THREE.Object3D.DEFAULT_UP, upwardSpeed);
}