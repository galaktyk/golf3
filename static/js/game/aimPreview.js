import * as THREE from 'three';
import {
  BALL_BOUNCE_RESTITUTION,
  BALL_COLLISION_SKIN,
  BALL_CONTACT_MAX_ROLLING_SPEED,
  BALL_CONTACT_MIN_DURATION_SECONDS,
  BALL_CONTACT_ROLLING_SLIP_SPEED,
  BALL_FIXED_STEP_SECONDS,
  BALL_GROUND_SNAP_DISTANCE,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_GRAVITY_ACCELERATION,
  BALL_IMPACT_FRICTION,
  BALL_IMPACT_MAX_FRICTION,
  BALL_IMPACT_REFERENCE_NORMAL_SPEED,
  BALL_LANDING_BRAKE_FRICTION,
  BALL_LANDING_CAPTURE_NORMAL_SPEED,
  BALL_LANDING_CAPTURE_SPEED,
  BALL_LANDING_CONTACT_ENTRY_NORMAL_SPEED,
  BALL_LANDING_SLIDING_FRICTION,
  BALL_MAX_COLLISION_ITERATIONS,
  BALL_RADIUS,
  BALL_ROLLING_RESISTANCE,
  BALL_SPIN_GROUND_DAMPING,
  BALL_STATIC_FRICTION,
  BALL_STOP_SPEED,
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
const PREVIEW_REST_MAX_SIMULATION_SECONDS = 45;
const PREVIEW_REST_MAX_STEPS = Math.ceil(PREVIEW_REST_MAX_SIMULATION_SECONDS / BALL_FIXED_STEP_SECONDS);
const PUTT_PREVIEW_GRID_ROWS = 10;
const PUTT_PREVIEW_GRID_COLUMNS = 9;
const PUTT_PREVIEW_GRID_SIZE_YARDS = 10;
const PUTT_PREVIEW_YARDS_TO_METERS = 0.9144;
const PUTT_PREVIEW_GRID_DEPTH_METERS = PUTT_PREVIEW_GRID_SIZE_YARDS * PUTT_PREVIEW_YARDS_TO_METERS;
const PUTT_PREVIEW_GRID_WIDTH_METERS = PUTT_PREVIEW_GRID_SIZE_YARDS * PUTT_PREVIEW_YARDS_TO_METERS;
const PUTT_PREVIEW_CELL_DEPTH_METERS = PUTT_PREVIEW_GRID_DEPTH_METERS / PUTT_PREVIEW_GRID_ROWS;
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
const GRAVITY = new THREE.Vector3(0, -BALL_GRAVITY_ACCELERATION, 0);
const PREVIEW_ROLL_POSITION = new THREE.Vector3();
const PREVIEW_ROLL_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_ANGULAR_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_DISPLACEMENT = new THREE.Vector3();
const PREVIEW_ROLL_SUPPORT_NORMAL = new THREE.Vector3(0, 1, 0);
const PREVIEW_ROLL_PROJECTED_GRAVITY = new THREE.Vector3();
const PREVIEW_ROLL_SUPPORT_PROJECTED_GRAVITY = new THREE.Vector3();
const PREVIEW_ROLL_NORMAL_COMPONENT = new THREE.Vector3();
const PREVIEW_ROLL_CONTACT_OFFSET = new THREE.Vector3();
const PREVIEW_ROLL_CONTACT_SPIN_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_CONTACT_POINT_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_CONTACT_IMPULSE_DELTA = new THREE.Vector3();
const PREVIEW_ROLL_TARGET_ANGULAR_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_TANGENT_VELOCITY = new THREE.Vector3();
const PREVIEW_ROLL_POINT = new THREE.Vector3();

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
 * Samples a 10x10 yard slope grid in front of the ball for putt aiming.
 */
export function buildPuttGridPreview(viewerScene, ballPosition, referenceForward = null) {
  if (!viewerScene?.courseCollision?.root || !ballPosition) {
    return null;
  }

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
  for (let rowIndex = 0; rowIndex <= PUTT_PREVIEW_GRID_ROWS; rowIndex += 1) {
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
  for (let rowIndex = 0; rowIndex < PUTT_PREVIEW_GRID_ROWS; rowIndex += 1) {
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
    rows: PUTT_PREVIEW_GRID_ROWS,
    cells,
  };
}

/**
 * Predicts the final resting point for slow putt previews using the same grounded movement rules as live play.
 */
export function predictFinalRestPoint(viewerScene, startPosition, launchData, referenceForward = null) {
  if (!viewerScene?.courseCollision?.root || !startPosition || !launchData) {
    return null;
  }

  if (!Number.isFinite(launchData.ballSpeed) || launchData.ballSpeed <= 0) {
    return null;
  }

  PREVIEW_ROLL_POSITION.copy(startPosition);
  buildLaunchVelocity(launchData, viewerScene, referenceForward, PREVIEW_ROLL_VELOCITY);
  buildLaunchAngularVelocity(launchData, viewerScene, referenceForward, PREVIEW_ROLL_ANGULAR_VELOCITY);
  PREVIEW_ROLL_SUPPORT_NORMAL.set(0, 1, 0);
  let movementState = 'air';
  let contactAgeSeconds = 0;

  for (let stepIndex = 0; stepIndex < PREVIEW_REST_MAX_STEPS; stepIndex += 1) {
    if (movementState === 'ground') {
      movementState = stepPreviewGround(viewerScene, PREVIEW_ROLL_POSITION, PREVIEW_ROLL_VELOCITY, PREVIEW_ROLL_ANGULAR_VELOCITY, PREVIEW_ROLL_SUPPORT_NORMAL);
      continue;
    }

    if (movementState === 'contact') {
      const contactStep = stepPreviewContact(
        viewerScene,
        PREVIEW_ROLL_POSITION,
        PREVIEW_ROLL_VELOCITY,
        PREVIEW_ROLL_ANGULAR_VELOCITY,
        PREVIEW_ROLL_SUPPORT_NORMAL,
        contactAgeSeconds,
      );
      movementState = contactStep.movementState;
      contactAgeSeconds = contactStep.contactAgeSeconds;
      continue;
    }

    if (movementState === 'rest') {
      const support = findGroundSupport(
        viewerScene.courseCollision,
        PREVIEW_ROLL_POSITION,
        BALL_RADIUS,
        BALL_GROUND_SNAP_DISTANCE,
      );
      const finalNormal = support?.normal?.y >= BALL_GROUNDED_NORMAL_MIN_Y
        ? support.normal
        : PREVIEW_ROLL_SUPPORT_NORMAL;
      PREVIEW_ROLL_POINT.copy(PREVIEW_ROLL_POSITION)
        .addScaledVector(finalNormal, -(BALL_RADIUS + BALL_COLLISION_SKIN));
      return {
        point: PREVIEW_ROLL_POINT.clone(),
        carryDistanceMeters: Math.hypot(
          PREVIEW_ROLL_POINT.x - startPosition.x,
          PREVIEW_ROLL_POINT.z - startPosition.z,
        ),
      };
    }

    const airStep = stepPreviewAir(viewerScene, PREVIEW_ROLL_POSITION, PREVIEW_ROLL_VELOCITY, PREVIEW_ROLL_ANGULAR_VELOCITY, PREVIEW_ROLL_SUPPORT_NORMAL);
    movementState = airStep.movementState;
    contactAgeSeconds = airStep.contactAgeSeconds;
  }

  const fallbackSupport = findGroundSupport(
    viewerScene.courseCollision,
    PREVIEW_ROLL_POSITION,
    BALL_RADIUS,
    PREVIEW_FALLBACK_GROUND_SNAP_DISTANCE,
  );
  if (!fallbackSupport || fallbackSupport.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return null;
  }

  PREVIEW_ROLL_POINT.copy(fallbackSupport.point);
  return {
    point: PREVIEW_ROLL_POINT.clone(),
    carryDistanceMeters: Math.hypot(
      PREVIEW_ROLL_POINT.x - startPosition.x,
      PREVIEW_ROLL_POINT.z - startPosition.z,
    ),
  };
}

function stepPreviewAir(viewerScene, position, velocity, angularVelocity, supportNormal) {
  integrateAirborneState(velocity, angularVelocity, BALL_FIXED_STEP_SECONDS);
  let remainingFraction = 1;

  for (let impactIndex = 0; impactIndex < 3 && remainingFraction > 1e-4; impactIndex += 1) {
    PREVIEW_ROLL_DISPLACEMENT.copy(velocity).multiplyScalar(BALL_FIXED_STEP_SECONDS * remainingFraction);
    const sweep = sweepSphereBVH(viewerScene.courseCollision, position, PREVIEW_ROLL_DISPLACEMENT, BALL_RADIUS, {
      maxIterations: BALL_MAX_COLLISION_ITERATIONS,
      skin: BALL_COLLISION_SKIN,
    });
    position.copy(sweep.position);

    if (!sweep.collided) {
      return { contactAgeSeconds: 0, movementState: 'air' };
    }

    const preImpactNormalSpeedMetersPerSecond = Math.max(-velocity.dot(sweep.hitNormal), 0);
    const postImpactSpeedMetersPerSecond = resolvePreviewImpactVelocity(velocity, angularVelocity, sweep.hitNormal);
    remainingFraction *= Math.max(1 - sweep.travelFraction, 0);

    if (shouldPreviewEnterGroundMode(velocity, sweep.hitNormal)) {
      supportNormal.copy(sweep.hitNormal);
      const enterContactState = preImpactNormalSpeedMetersPerSecond > BALL_LANDING_CONTACT_ENTRY_NORMAL_SPEED
        || postImpactSpeedMetersPerSecond > BALL_CONTACT_MAX_ROLLING_SPEED;
      const landingState = enterContactState ? 'contact' : 'ground';
      if (previewSnapToGround(viewerScene, position, velocity, angularVelocity, supportNormal, landingState)) {
        const resolvedGroundState = previewResolveRestState(velocity, supportNormal, landingState);
        return {
          contactAgeSeconds: 0,
          movementState: resolvedGroundState,
        };
      }
    }

    position.addScaledVector(
      sweep.hitNormal,
      sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y ? BALL_COLLISION_SKIN * 2 : BALL_COLLISION_SKIN * 0.1,
    );
  }

  return { contactAgeSeconds: 0, movementState: 'air' };
}

function stepPreviewGround(viewerScene, position, velocity, angularVelocity, supportNormal) {
  PREVIEW_ROLL_PROJECTED_GRAVITY.copy(GRAVITY);
  PREVIEW_ROLL_PROJECTED_GRAVITY.addScaledVector(
    supportNormal,
    -PREVIEW_ROLL_PROJECTED_GRAVITY.dot(supportNormal),
  );

  velocity.addScaledVector(PREVIEW_ROLL_PROJECTED_GRAVITY, BALL_FIXED_STEP_SECONDS);
  applyPreviewRollingResistance(velocity, BALL_FIXED_STEP_SECONDS);
  syncPreviewRollingAngularVelocity(angularVelocity, velocity, supportNormal);
  PREVIEW_ROLL_DISPLACEMENT.copy(velocity).multiplyScalar(BALL_FIXED_STEP_SECONDS);

  const groundSweepRadius = Math.max(BALL_RADIUS - BALL_COLLISION_SKIN, BALL_RADIUS * 0.5);
  const sweep = sweepSphereBVH(viewerScene.courseCollision, position, PREVIEW_ROLL_DISPLACEMENT, groundSweepRadius, {
    maxIterations: BALL_MAX_COLLISION_ITERATIONS,
    skin: BALL_COLLISION_SKIN,
  });
  position.copy(sweep.position);

  if (sweep.collided) {
    removePreviewIntoNormalComponent(velocity, sweep.hitNormal);
    if (sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y) {
      supportNormal.copy(sweep.hitNormal);
    }
  }

  if (!previewSnapToGround(viewerScene, position, velocity, angularVelocity, supportNormal, 'ground')) {
    return 'air';
  }

  if (shouldPreviewHoldAgainstSlope(velocity, PREVIEW_ROLL_PROJECTED_GRAVITY)) {
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);
    return 'rest';
  }

  applyPreviewGroundSpinDamping(angularVelocity, BALL_FIXED_STEP_SECONDS);
  syncPreviewRollingAngularVelocity(angularVelocity, velocity, supportNormal);
  return 'ground';
}

function stepPreviewContact(viewerScene, position, velocity, angularVelocity, supportNormal, contactAgeSeconds) {
  let nextContactAgeSeconds = contactAgeSeconds + BALL_FIXED_STEP_SECONDS;
  PREVIEW_ROLL_PROJECTED_GRAVITY.copy(GRAVITY);
  PREVIEW_ROLL_PROJECTED_GRAVITY.addScaledVector(
    supportNormal,
    -PREVIEW_ROLL_PROJECTED_GRAVITY.dot(supportNormal),
  );

  velocity.addScaledVector(PREVIEW_ROLL_PROJECTED_GRAVITY, BALL_FIXED_STEP_SECONDS);
  applyPreviewGroundContactForces(velocity, angularVelocity, supportNormal, BALL_FIXED_STEP_SECONDS);
  PREVIEW_ROLL_DISPLACEMENT.copy(velocity).multiplyScalar(BALL_FIXED_STEP_SECONDS);

  const contactSweepRadius = Math.max(BALL_RADIUS - BALL_COLLISION_SKIN, BALL_RADIUS * 0.5);
  const sweep = sweepSphereBVH(viewerScene.courseCollision, position, PREVIEW_ROLL_DISPLACEMENT, contactSweepRadius, {
    maxIterations: BALL_MAX_COLLISION_ITERATIONS,
    skin: BALL_COLLISION_SKIN,
  });
  position.copy(sweep.position);

  if (sweep.collided) {
    removePreviewIntoNormalComponent(velocity, sweep.hitNormal);
    if (sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y) {
      supportNormal.copy(sweep.hitNormal);
    }
  }

  if (!previewSnapToGround(viewerScene, position, velocity, angularVelocity, supportNormal, 'contact')) {
    return { contactAgeSeconds: 0, movementState: 'air' };
  }

  if (shouldPreviewHoldAgainstSlope(velocity, PREVIEW_ROLL_PROJECTED_GRAVITY)) {
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);
    return { contactAgeSeconds: nextContactAgeSeconds, movementState: 'rest' };
  }

  if (shouldPreviewTransitionToRolling(velocity, angularVelocity, supportNormal, nextContactAgeSeconds)) {
    syncPreviewRollingAngularVelocity(angularVelocity, velocity, supportNormal);
    return { contactAgeSeconds: 0, movementState: 'ground' };
  }

  applyPreviewGroundSpinDamping(angularVelocity, BALL_FIXED_STEP_SECONDS);
  return { contactAgeSeconds: nextContactAgeSeconds, movementState: 'contact' };
}

function previewSnapToGround(viewerScene, position, velocity, angularVelocity, supportNormal, groundedMovementState) {
  const support = findGroundSupport(
    viewerScene.courseCollision,
    position,
    BALL_RADIUS,
    BALL_GROUND_SNAP_DISTANCE,
  );
  if (!support || support.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return false;
  }

  supportNormal.copy(support.normal);
  position.copy(support.point).addScaledVector(support.normal, BALL_RADIUS + BALL_COLLISION_SKIN);
  projectPreviewOntoPlane(velocity, support.normal);

  if (velocity.lengthSq() < BALL_STOP_SPEED * BALL_STOP_SPEED) {
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);
  }

  return previewResolveRestState(velocity, supportNormal, groundedMovementState) !== 'air';
}

function previewResolveRestState(velocity, supportNormal, groundedMovementState) {
  PREVIEW_ROLL_SUPPORT_PROJECTED_GRAVITY.copy(GRAVITY);
  PREVIEW_ROLL_SUPPORT_PROJECTED_GRAVITY.addScaledVector(
    supportNormal,
    -PREVIEW_ROLL_SUPPORT_PROJECTED_GRAVITY.dot(supportNormal),
  );
  return shouldPreviewHoldAgainstSlope(velocity, PREVIEW_ROLL_SUPPORT_PROJECTED_GRAVITY)
    ? 'rest'
    : groundedMovementState;
}

function applyPreviewGroundContactForces(velocity, angularVelocity, surfaceNormal, deltaSeconds) {
  PREVIEW_ROLL_CONTACT_OFFSET.copy(surfaceNormal).multiplyScalar(-BALL_RADIUS);
  PREVIEW_ROLL_CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(PREVIEW_ROLL_CONTACT_OFFSET);
  PREVIEW_ROLL_CONTACT_POINT_VELOCITY.copy(velocity).add(PREVIEW_ROLL_CONTACT_SPIN_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.copy(PREVIEW_ROLL_CONTACT_POINT_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.addScaledVector(
    surfaceNormal,
    -PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.dot(surfaceNormal),
  );

  const slipSpeed = PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.length();
  if (slipSpeed > 1e-6) {
    const slidingDeltaSpeed = Math.min(
      slipSpeed,
      BALL_LANDING_SLIDING_FRICTION * BALL_GRAVITY_ACCELERATION * deltaSeconds,
    );
    PREVIEW_ROLL_CONTACT_IMPULSE_DELTA.copy(PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY)
      .multiplyScalar(-slidingDeltaSpeed / slipSpeed);
    velocity.add(PREVIEW_ROLL_CONTACT_IMPULSE_DELTA);
    applyPreviewSurfaceImpulseToAngularVelocity(angularVelocity, surfaceNormal, PREVIEW_ROLL_CONTACT_IMPULSE_DELTA);
  }

  const speed = velocity.length();
  if (speed > BALL_CONTACT_MAX_ROLLING_SPEED) {
    const contactBrakeSpeed = Math.min(
      speed - BALL_CONTACT_MAX_ROLLING_SPEED,
      BALL_LANDING_BRAKE_FRICTION * BALL_GRAVITY_ACCELERATION * deltaSeconds,
    );
    if (contactBrakeSpeed > 0) {
      velocity.addScaledVector(velocity, -contactBrakeSpeed / speed);
    }
  }

  applyPreviewRollingResistance(velocity, deltaSeconds);
}

function applyPreviewRollingResistance(velocity, deltaSeconds) {
  const speed = velocity.length();
  if (speed <= 1e-6) {
    velocity.set(0, 0, 0);
    return;
  }

  const rollingDeltaSpeed = Math.min(
    speed,
    BALL_ROLLING_RESISTANCE * BALL_GRAVITY_ACCELERATION * deltaSeconds,
  );
  velocity.addScaledVector(velocity, -rollingDeltaSpeed / speed);
}

function shouldPreviewTransitionToRolling(velocity, angularVelocity, surfaceNormal, contactAgeSeconds) {
  if (contactAgeSeconds < BALL_CONTACT_MIN_DURATION_SECONDS) {
    return false;
  }

  if (velocity.length() > BALL_CONTACT_MAX_ROLLING_SPEED) {
    return false;
  }

  return getPreviewContactSlipSpeed(velocity, angularVelocity, surfaceNormal) <= BALL_CONTACT_ROLLING_SLIP_SPEED;
}

function getPreviewContactSlipSpeed(velocity, angularVelocity, surfaceNormal) {
  PREVIEW_ROLL_CONTACT_OFFSET.copy(surfaceNormal).multiplyScalar(-BALL_RADIUS);
  PREVIEW_ROLL_CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(PREVIEW_ROLL_CONTACT_OFFSET);
  PREVIEW_ROLL_CONTACT_POINT_VELOCITY.copy(velocity).add(PREVIEW_ROLL_CONTACT_SPIN_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.copy(PREVIEW_ROLL_CONTACT_POINT_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.addScaledVector(
    surfaceNormal,
    -PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.dot(surfaceNormal),
  );
  return PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.length();
}

function shouldPreviewHoldAgainstSlope(velocity, projectedGravity) {
  if (velocity.lengthSq() > BALL_STOP_SPEED * BALL_STOP_SPEED) {
    return false;
  }

  return projectedGravity.lengthSq() <= (BALL_STATIC_FRICTION * BALL_GRAVITY_ACCELERATION) ** 2;
}

function shouldPreviewEnterGroundMode(velocity, hitNormal) {
  if (hitNormal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return false;
  }

  const reboundNormalSpeed = Math.max(velocity.dot(hitNormal), 0);
  if (reboundNormalSpeed <= BALL_LANDING_CAPTURE_NORMAL_SPEED) {
    return true;
  }

  return velocity.lengthSq() <= BALL_LANDING_CAPTURE_SPEED * BALL_LANDING_CAPTURE_SPEED;
}

function resolvePreviewImpactVelocity(velocity, angularVelocity, hitNormal) {
  const normalSpeed = velocity.dot(hitNormal);
  if (normalSpeed >= 0) {
    return velocity.length();
  }

  const incomingSpeed = velocity.length();
  const incomingNormalSpeed = Math.max(-normalSpeed, 0);
  PREVIEW_ROLL_NORMAL_COMPONENT.copy(hitNormal).multiplyScalar(normalSpeed);
  PREVIEW_ROLL_TANGENT_VELOCITY.copy(velocity).sub(PREVIEW_ROLL_NORMAL_COMPONENT);

  PREVIEW_ROLL_CONTACT_OFFSET.copy(hitNormal).multiplyScalar(-BALL_RADIUS);
  PREVIEW_ROLL_CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(PREVIEW_ROLL_CONTACT_OFFSET);
  PREVIEW_ROLL_CONTACT_POINT_VELOCITY.copy(PREVIEW_ROLL_TANGENT_VELOCITY).add(PREVIEW_ROLL_CONTACT_SPIN_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.copy(PREVIEW_ROLL_CONTACT_POINT_VELOCITY);
  PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.addScaledVector(
    hitNormal,
    -PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.dot(hitNormal),
  );
  const incomingTangentSpeed = PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY.length();

  const impactSeverity = incomingSpeed > 1e-6
    ? THREE.MathUtils.clamp(
      incomingNormalSpeed / Math.max(incomingNormalSpeed + incomingTangentSpeed, 1e-6),
      0,
      1,
    )
    : 0;
  const impactStrength = THREE.MathUtils.clamp(
    incomingNormalSpeed / BALL_IMPACT_REFERENCE_NORMAL_SPEED,
    0,
    1,
  );
  const baseFriction = hitNormal.y >= 0.5 ? BALL_IMPACT_FRICTION : BALL_IMPACT_FRICTION * 0.2;
  const maxFriction = hitNormal.y >= 0.5 ? BALL_IMPACT_MAX_FRICTION : BALL_IMPACT_MAX_FRICTION * 0.25;
  const friction = THREE.MathUtils.lerp(baseFriction, maxFriction, impactSeverity * impactStrength);
  const maxLinearDeltaRatio = 2 / 7;
  const tangentDeltaSpeed = Math.min(incomingTangentSpeed * maxLinearDeltaRatio, friction * incomingNormalSpeed);

  if (incomingTangentSpeed > 1e-6 && tangentDeltaSpeed > 0) {
    PREVIEW_ROLL_CONTACT_IMPULSE_DELTA.copy(PREVIEW_ROLL_CONTACT_TANGENT_VELOCITY)
      .multiplyScalar(-tangentDeltaSpeed / incomingTangentSpeed);
    PREVIEW_ROLL_TANGENT_VELOCITY.add(PREVIEW_ROLL_CONTACT_IMPULSE_DELTA);
    applyPreviewSurfaceImpulseToAngularVelocity(angularVelocity, hitNormal, PREVIEW_ROLL_CONTACT_IMPULSE_DELTA);
  }

  const restitution = THREE.MathUtils.lerp(
    0,
    BALL_BOUNCE_RESTITUTION,
    THREE.MathUtils.clamp(
      (incomingNormalSpeed - BALL_LANDING_CAPTURE_NORMAL_SPEED)
        / Math.max(BALL_IMPACT_REFERENCE_NORMAL_SPEED - BALL_LANDING_CAPTURE_NORMAL_SPEED, 1e-6),
      0,
      1,
    ),
  );

  velocity.copy(PREVIEW_ROLL_TANGENT_VELOCITY).addScaledVector(hitNormal, incomingNormalSpeed * restitution);
  return velocity.length();
}

function applyPreviewSurfaceImpulseToAngularVelocity(angularVelocity, surfaceNormal, linearVelocityDelta) {
  if (linearVelocityDelta.lengthSq() <= 1e-12) {
    return;
  }

  PREVIEW_ROLL_TARGET_ANGULAR_VELOCITY.copy(surfaceNormal)
    .cross(linearVelocityDelta)
    .multiplyScalar(-5 / (2 * BALL_RADIUS));
  angularVelocity.add(PREVIEW_ROLL_TARGET_ANGULAR_VELOCITY);
}

function applyPreviewGroundSpinDamping(angularVelocity, deltaSeconds) {
  angularVelocity.multiplyScalar(Math.exp(-BALL_SPIN_GROUND_DAMPING * deltaSeconds));
}

function syncPreviewRollingAngularVelocity(angularVelocity, velocity, surfaceNormal) {
  PREVIEW_ROLL_TARGET_ANGULAR_VELOCITY.copy(surfaceNormal).cross(velocity).multiplyScalar(1 / BALL_RADIUS);
  PREVIEW_ROLL_NORMAL_COMPONENT.copy(surfaceNormal).multiplyScalar(angularVelocity.dot(surfaceNormal));
  angularVelocity.copy(PREVIEW_ROLL_TARGET_ANGULAR_VELOCITY).add(PREVIEW_ROLL_NORMAL_COMPONENT);
}

function removePreviewIntoNormalComponent(vector, normal) {
  const normalSpeed = vector.dot(normal);
  if (normalSpeed >= 0) {
    return;
  }

  vector.addScaledVector(normal, -normalSpeed);
}

function projectPreviewOntoPlane(vector, normal) {
  vector.addScaledVector(normal, -vector.dot(normal));
  if (vector.lengthSq() < BALL_STOP_SPEED * BALL_STOP_SPEED) {
    vector.set(0, 0, 0);
  }
}