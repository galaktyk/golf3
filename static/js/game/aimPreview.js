import * as THREE from 'three';
import {
  BALL_COLLISION_SKIN,
  BALL_FIXED_STEP_SECONDS,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_MAX_COLLISION_ITERATIONS,
  BALL_RADIUS,
} from '/static/js/game/constants.js';
import {
  buildLaunchAngularVelocity,
  buildLaunchVelocity,
  integrateAirborneState,
} from '/static/js/game/ballFlightModel.js';
import { findGroundSupport, sweepSphereBVH } from '/static/js/game/collision.js';

const PREVIEW_MAX_SIMULATION_SECONDS = 22;
const PREVIEW_MAX_STEPS = Math.ceil(PREVIEW_MAX_SIMULATION_SECONDS / BALL_FIXED_STEP_SECONDS);
const PREVIEW_VELOCITY = new THREE.Vector3();
const PREVIEW_ANGULAR_VELOCITY = new THREE.Vector3();
const PREVIEW_POSITION = new THREE.Vector3();
const PREVIEW_DISPLACEMENT = new THREE.Vector3();
const PREVIEW_FALLBACK_POINT = new THREE.Vector3();
const PREVIEW_SUPPORT_FALLBACK = new THREE.Vector3();
const PREVIEW_START_POSITION = new THREE.Vector3();
const PREVIEW_CLEARANCE_HEIGHT_METERS = BALL_RADIUS * 0.35;
const PREVIEW_MIN_LANDING_TRAVEL_METERS = Math.max(BALL_RADIUS * 6, 0.24);
const PREVIEW_FALLBACK_GROUND_SNAP_DISTANCE = 12;

export function predictFirstContactPoint(viewerScene, startPosition, launchData, referenceForward = null) {
  if (!viewerScene?.courseCollision?.root || !startPosition || !launchData) {
    return null;
  }

  if (!Number.isFinite(launchData.ballSpeed) || launchData.ballSpeed <= 0) {
    return null;
  }

  PREVIEW_START_POSITION.copy(startPosition);
  PREVIEW_POSITION.copy(startPosition);
  buildLaunchVelocity(launchData, viewerScene, referenceForward, PREVIEW_VELOCITY);
  buildLaunchAngularVelocity(launchData, viewerScene, referenceForward, PREVIEW_ANGULAR_VELOCITY);
  let hasClearedLaunch = false;

  for (let stepIndex = 0; stepIndex < PREVIEW_MAX_STEPS; stepIndex += 1) {
    integrateAirborneState(PREVIEW_VELOCITY, PREVIEW_ANGULAR_VELOCITY, BALL_FIXED_STEP_SECONDS);
    PREVIEW_DISPLACEMENT.copy(PREVIEW_VELOCITY).multiplyScalar(BALL_FIXED_STEP_SECONDS);

    const sweep = sweepSphereBVH(viewerScene.courseCollision, PREVIEW_POSITION, PREVIEW_DISPLACEMENT, BALL_RADIUS, {
      maxIterations: BALL_MAX_COLLISION_ITERATIONS,
      skin: BALL_COLLISION_SKIN,
    });
    PREVIEW_POSITION.copy(sweep.position);

    const isGroundLikeContact = sweep.collided && sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y;
    if (sweep.collided && !hasClearedLaunch && isGroundLikeContact) {
      PREVIEW_POSITION.addScaledVector(PREVIEW_DISPLACEMENT, 1 - sweep.travelFraction);
    }

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

  const fallbackSupport = findGroundSupport(
    viewerScene.courseCollision,
    PREVIEW_POSITION,
    BALL_RADIUS,
    PREVIEW_FALLBACK_GROUND_SNAP_DISTANCE,
  );
  if (!fallbackSupport || fallbackSupport.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return null;
  }

  PREVIEW_SUPPORT_FALLBACK.copy(fallbackSupport.point)
    .addScaledVector(fallbackSupport.normal, -(BALL_RADIUS + BALL_COLLISION_SKIN));
  return {
    point: PREVIEW_SUPPORT_FALLBACK.clone(),
    carryDistanceMeters: Math.hypot(
      PREVIEW_SUPPORT_FALLBACK.x - startPosition.x,
      PREVIEW_SUPPORT_FALLBACK.z - startPosition.z,
    ),
  };
}