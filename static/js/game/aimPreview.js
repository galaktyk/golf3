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
import { findGroundSupport, sampleCourseSurface, sweepSphereBVH } from '/static/js/game/collision.js';

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
const PUTT_PREVIEW_GRID_BASE_ROWS = 10;
const PUTT_PREVIEW_GRID_MIN_ROWS = 8;
const PUTT_PREVIEW_GRID_MAX_ROWS = 20;
const PUTT_PREVIEW_GRID_EXTRA_AIM_ROWS = 2;
const PUTT_PREVIEW_GRID_COLUMNS = 9;
const PUTT_PREVIEW_GRID_SIZE_YARDS = 10;
const PUTT_PREVIEW_YARDS_TO_METERS = 0.9144;
const PUTT_PREVIEW_GRID_DEPTH_METERS = PUTT_PREVIEW_GRID_SIZE_YARDS * PUTT_PREVIEW_YARDS_TO_METERS;
const PUTT_PREVIEW_GRID_WIDTH_METERS = PUTT_PREVIEW_GRID_SIZE_YARDS * PUTT_PREVIEW_YARDS_TO_METERS;
const PUTT_PREVIEW_CELL_DEPTH_METERS = PUTT_PREVIEW_GRID_DEPTH_METERS / PUTT_PREVIEW_GRID_BASE_ROWS;
const PUTT_PREVIEW_CELL_WIDTH_METERS = PUTT_PREVIEW_GRID_WIDTH_METERS / PUTT_PREVIEW_GRID_COLUMNS;
const PUTT_PREVIEW_SURFACE_SAMPLE_UP_DISTANCE = 3;
const PUTT_PREVIEW_SURFACE_SAMPLE_DOWN_DISTANCE = 18;
const PUTT_PREVIEW_FORWARD = new THREE.Vector3();
const PUTT_PREVIEW_RIGHT = new THREE.Vector3();
const PUTT_PREVIEW_SAMPLE_POINT = new THREE.Vector3();
const PUTT_PREVIEW_VERTEX_SAMPLE_POINT = new THREE.Vector3();
const PUTT_PREVIEW_FALLBACK_NORMAL = new THREE.Vector3(0, 1, 0);
const PUTT_PREVIEW_SUPPORT_SAMPLE = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function resolvePuttPreviewRows(aimDistanceMeters) {
  if (!Number.isFinite(aimDistanceMeters) || aimDistanceMeters <= 0) {
    return PUTT_PREVIEW_GRID_MIN_ROWS;
  }

  const aimedRows = Math.ceil(aimDistanceMeters / PUTT_PREVIEW_CELL_DEPTH_METERS) + PUTT_PREVIEW_GRID_EXTRA_AIM_ROWS;
  return THREE.MathUtils.clamp(aimedRows, PUTT_PREVIEW_GRID_MIN_ROWS, PUTT_PREVIEW_GRID_MAX_ROWS);
}

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

/**
 * Samples a variable-depth slope grid in front of the ball for putt aiming.
 */
export function buildPuttGridPreview(viewerScene, ballPosition, aimDistanceMeters = 0, referenceForward = null) {
  if (!viewerScene?.courseCollision?.root || !ballPosition) {
    return null;
  }

  const rowCount = resolvePuttPreviewRows(aimDistanceMeters);

  const groundSample = sampleCourseSurface(
    viewerScene.courseCollision,
    PUTT_PREVIEW_SUPPORT_SAMPLE.copy(ballPosition),
    PUTT_PREVIEW_SURFACE_SAMPLE_UP_DISTANCE,
    PUTT_PREVIEW_SURFACE_SAMPLE_DOWN_DISTANCE,
  );
  const supportNormal = groundSample?.normal ?? PUTT_PREVIEW_FALLBACK_NORMAL;

  if (referenceForward && referenceForward.lengthSq() > 1e-8) {
    PUTT_PREVIEW_FORWARD.copy(referenceForward);
  } else {
    PUTT_PREVIEW_FORWARD.set(0, 0, -1);
  }

  // Keep the grid aligned with gameplay aim while staying tangent to the sampled surface near the ball.
  PUTT_PREVIEW_FORWARD.addScaledVector(supportNormal, -PUTT_PREVIEW_FORWARD.dot(supportNormal));
  if (PUTT_PREVIEW_FORWARD.lengthSq() <= 1e-8) {
    PUTT_PREVIEW_FORWARD.set(0, 0, -1).addScaledVector(
      supportNormal,
      -new THREE.Vector3(0, 0, -1).dot(supportNormal),
    );
  }
  if (PUTT_PREVIEW_FORWARD.lengthSq() <= 1e-8) {
    return null;
  }

  PUTT_PREVIEW_FORWARD.normalize();
  PUTT_PREVIEW_RIGHT.crossVectors(PUTT_PREVIEW_FORWARD, WORLD_UP);
  if (PUTT_PREVIEW_RIGHT.lengthSq() <= 1e-8) {
    PUTT_PREVIEW_RIGHT.set(1, 0, 0);
  } else {
    PUTT_PREVIEW_RIGHT.normalize();
  }

  const vertices = [];
  for (let rowIndex = 0; rowIndex <= rowCount; rowIndex += 1) {
    const forwardOffset = rowIndex * PUTT_PREVIEW_CELL_DEPTH_METERS;
    for (let columnIndex = 0; columnIndex <= PUTT_PREVIEW_GRID_COLUMNS; columnIndex += 1) {
      const lateralOffset = (
        columnIndex - (PUTT_PREVIEW_GRID_COLUMNS * 0.5)
      ) * PUTT_PREVIEW_CELL_WIDTH_METERS;

      PUTT_PREVIEW_VERTEX_SAMPLE_POINT.copy(ballPosition)
        .addScaledVector(PUTT_PREVIEW_FORWARD, forwardOffset)
        .addScaledVector(PUTT_PREVIEW_RIGHT, lateralOffset);

      const surfaceSample = sampleCourseSurface(
        viewerScene.courseCollision,
        PUTT_PREVIEW_VERTEX_SAMPLE_POINT,
        PUTT_PREVIEW_SURFACE_SAMPLE_UP_DISTANCE,
        PUTT_PREVIEW_SURFACE_SAMPLE_DOWN_DISTANCE,
      );
      if (!surfaceSample) {
        return null;
      }

      vertices.push({
        columnIndex,
        rowIndex,
        normal: surfaceSample.normal.clone(),
        point: surfaceSample.point.clone(),
      });
    }
  }

  const cells = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const forwardOffset = (rowIndex + 0.5) * PUTT_PREVIEW_CELL_DEPTH_METERS;
    for (let columnIndex = 0; columnIndex < PUTT_PREVIEW_GRID_COLUMNS; columnIndex += 1) {
      const lateralOffset = (
        columnIndex - (PUTT_PREVIEW_GRID_COLUMNS * 0.5) + 0.5
      ) * PUTT_PREVIEW_CELL_WIDTH_METERS;

      PUTT_PREVIEW_SAMPLE_POINT.copy(ballPosition)
        .addScaledVector(PUTT_PREVIEW_FORWARD, forwardOffset)
        .addScaledVector(PUTT_PREVIEW_RIGHT, lateralOffset);

      const surfaceSample = sampleCourseSurface(
        viewerScene.courseCollision,
        PUTT_PREVIEW_SAMPLE_POINT,
        PUTT_PREVIEW_SURFACE_SAMPLE_UP_DISTANCE,
        PUTT_PREVIEW_SURFACE_SAMPLE_DOWN_DISTANCE,
      );
      if (!surfaceSample) {
        continue;
      }

      cells.push({
        columnIndex,
        rowIndex,
        normal: surfaceSample.normal.clone(),
        point: surfaceSample.point.clone(),
      });
    }
  }

  if (cells.length === 0) {
    return null;
  }

  return {
    cellDepthMeters: PUTT_PREVIEW_CELL_DEPTH_METERS,
    cellWidthMeters: PUTT_PREVIEW_CELL_WIDTH_METERS,
    columns: PUTT_PREVIEW_GRID_COLUMNS,
    vertices,
    forward: PUTT_PREVIEW_FORWARD.clone(),
    rows: rowCount,
    cells,
  };
}