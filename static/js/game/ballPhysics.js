import * as THREE from 'three';
import {
  BALL_AIR_DRAG,
  BALL_BOUNCE_RESTITUTION,
  BALL_COLLISION_SKIN,
  BALL_FIXED_STEP_SECONDS,
  BALL_GROUND_CAPTURE_SPEED,
  BALL_GROUND_CAPTURE_NORMAL_SPEED,
  BALL_GROUND_SNAP_DISTANCE,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_GRAVITY_ACCELERATION,
  BALL_IMPACT_FRICTION,
  BALL_MAX_COLLISION_ITERATIONS,
  BALL_MAX_FIXED_STEPS_PER_FRAME,
  BALL_RADIUS,
  BALL_ROLLING_FRICTION,
  BALL_START_POSITION,
  BALL_STOP_SPEED,
  BALL_TEST_LAUNCH_FORWARD_SPEED,
  BALL_TEST_LAUNCH_UPWARD_SPEED,
  BALL_TEST_LAUNCH_VELOCITY,
} from '/static/js/game/constants.js';
import { findGroundSupport, resolveSphereOverlapBVH, sweepSphereBVH } from '/static/js/game/collision.js';

const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_AUTO_LAUNCH = DEBUG_PARAMS.get('debugBallLaunch') === '1';
const GRAVITY = new THREE.Vector3(0, -BALL_GRAVITY_ACCELERATION, 0);
const PROJECTED_GRAVITY = new THREE.Vector3();
const DISPLACEMENT = new THREE.Vector3();
const WORKING_NORMAL_COMPONENT = new THREE.Vector3();
const SUPPORT_PROJECTED_GRAVITY = new THREE.Vector3();
const CAMERA_FORWARD = new THREE.Vector3();
const HORIZONTAL_FORWARD = new THREE.Vector3();
const LAUNCH_VELOCITY = new THREE.Vector3();
const STEP_TRANSLATION = new THREE.Vector3();
const ROLL_AXIS = new THREE.Vector3();
const DELTA_ROTATION = new THREE.Quaternion();
const ZERO_VECTOR = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PREV_AIR_POSITION = new THREE.Vector3();

export function createBallPhysics(viewerScene) {
  const position = BALL_START_POSITION.clone();
  const velocity = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const previousPosition = position.clone();
  const previousOrientation = orientation.clone();
  const renderPosition = position.clone();
  const renderOrientation = orientation.clone();
  const supportNormal = new THREE.Vector3(0, 1, 0);
  let accumulatorSeconds = 0;
  let mode = 'waiting';
  let hasCourseContact = false;
  let debugAutoLaunchConsumed = false;

  const snapToGround = (maxSnapDistance) => {
    const support = findGroundSupport(viewerScene.courseCollision, position, BALL_RADIUS, maxSnapDistance);
    if (!support || support.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
      return false;
    }

    supportNormal.copy(support.normal);
    position.copy(support.point).addScaledVector(support.normal, BALL_RADIUS + BALL_COLLISION_SKIN);
    const overlapResolution = resolveSphereOverlapBVH(viewerScene.courseCollision, position, BALL_RADIUS, {
      maxIterations: BALL_MAX_COLLISION_ITERATIONS,
      skin: BALL_COLLISION_SKIN,
    });
    position.copy(overlapResolution.position);
    if (overlapResolution.collided && overlapResolution.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y) {
      supportNormal.copy(overlapResolution.hitNormal);
    }
    projectOntoPlane(velocity, support.normal);

    if (velocity.lengthSq() < BALL_STOP_SPEED * BALL_STOP_SPEED) {
      velocity.set(0, 0, 0);
    }

    SUPPORT_PROJECTED_GRAVITY.copy(GRAVITY);
    SUPPORT_PROJECTED_GRAVITY.addScaledVector(supportNormal, -SUPPORT_PROJECTED_GRAVITY.dot(supportNormal));
    mode = shouldHoldAgainstSlope(velocity, SUPPORT_PROJECTED_GRAVITY) ? 'rest' : 'ground';
    return true;
  };

  const ensureCourseContact = () => {
    if (!viewerScene.courseCollision || hasCourseContact) {
      return;
    }

    if (!snapToGround(BALL_GROUND_SNAP_DISTANCE * 2)) {
      mode = velocity.lengthSq() > 0 ? 'air' : 'waiting';
    }

    hasCourseContact = true;

    if (DEBUG_AUTO_LAUNCH && !debugAutoLaunchConsumed) {
      debugAutoLaunchConsumed = true;
      launch(BALL_TEST_LAUNCH_VELOCITY);
    }
  };

  const stepAir = (deltaSeconds) => {
    PREV_AIR_POSITION.copy(position);
    velocity.addScaledVector(GRAVITY, deltaSeconds);
    velocity.multiplyScalar(Math.exp(-BALL_AIR_DRAG * deltaSeconds));
    let remainingFraction = 1;

    for (let impactIndex = 0; impactIndex < 3 && remainingFraction > 1e-4; impactIndex += 1) {
      DISPLACEMENT.copy(velocity).multiplyScalar(deltaSeconds * remainingFraction);

      const sweep = sweepSphereBVH(viewerScene.courseCollision, position, DISPLACEMENT, BALL_RADIUS, {
        maxIterations: BALL_MAX_COLLISION_ITERATIONS,
        skin: BALL_COLLISION_SKIN,
      });

      position.copy(sweep.position);

      if (!sweep.collided) {
        mode = 'air';
        applyRollingRotation(PREV_AIR_POSITION, position, WORLD_UP);
        return;
      }

      resolveImpactVelocity(velocity, sweep.hitNormal);
      remainingFraction *= Math.max(1 - sweep.travelFraction, 0);

      if (shouldEnterGroundMode(velocity, sweep.hitNormal)) {
        supportNormal.copy(sweep.hitNormal);
        projectOntoPlane(velocity, supportNormal);
        snapToGround(BALL_GROUND_SNAP_DISTANCE);
        applyRollingRotation(PREV_AIR_POSITION, position, WORLD_UP);
        return;
      }

      position.addScaledVector(sweep.hitNormal, BALL_COLLISION_SKIN * 2);
      mode = 'air';
    }
    applyRollingRotation(PREV_AIR_POSITION, position, WORLD_UP);
  };

  const stepGround = (deltaSeconds) => {
    const groundPrevPosition = position.clone();
    PROJECTED_GRAVITY.copy(GRAVITY);
    PROJECTED_GRAVITY.addScaledVector(supportNormal, -PROJECTED_GRAVITY.dot(supportNormal));

    velocity.addScaledVector(PROJECTED_GRAVITY, deltaSeconds);

    applyRollingFriction(velocity, deltaSeconds);
    DISPLACEMENT.copy(velocity).multiplyScalar(deltaSeconds);

    const groundSweepRadius = Math.max(BALL_RADIUS - BALL_COLLISION_SKIN, BALL_RADIUS * 0.5);
    const sweep = sweepSphereBVH(viewerScene.courseCollision, position, DISPLACEMENT, groundSweepRadius, {
      maxIterations: BALL_MAX_COLLISION_ITERATIONS,
      skin: BALL_COLLISION_SKIN,
    });

    position.copy(sweep.position);

    if (sweep.collided) {
      removeIntoNormalComponent(velocity, sweep.hitNormal);
      if (sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y) {
        supportNormal.copy(sweep.hitNormal);
      }
    }

    if (!snapToGround(BALL_GROUND_SNAP_DISTANCE)) {
      mode = 'air';
      return;
    }

    if (shouldHoldAgainstSlope(velocity, PROJECTED_GRAVITY)) {
      velocity.set(0, 0, 0);
      mode = 'rest';
    }

    applyRollingRotation(groundPrevPosition, position, supportNormal);
  };

  const stepRest = () => {
    const support = findGroundSupport(viewerScene.courseCollision, position, BALL_RADIUS, BALL_GROUND_SNAP_DISTANCE);
    if (!support || support.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
      mode = 'air';
      return;
    }

    supportNormal.copy(support.normal);
    SUPPORT_PROJECTED_GRAVITY.copy(GRAVITY);
    SUPPORT_PROJECTED_GRAVITY.addScaledVector(supportNormal, -SUPPORT_PROJECTED_GRAVITY.dot(supportNormal));

    if (!shouldHoldAgainstSlope(velocity, SUPPORT_PROJECTED_GRAVITY)) {
      mode = 'ground';
      return;
    }

    if (Math.abs(support.separation) > BALL_COLLISION_SKIN * 2) {
      position.copy(support.point).addScaledVector(support.normal, BALL_RADIUS + BALL_COLLISION_SKIN);
      const overlapResolution = resolveSphereOverlapBVH(viewerScene.courseCollision, position, BALL_RADIUS, {
        maxIterations: BALL_MAX_COLLISION_ITERATIONS,
        skin: BALL_COLLISION_SKIN,
      });
      position.copy(overlapResolution.position);
    }

    velocity.set(0, 0, 0);
    mode = 'rest';
  };

  const step = (deltaSeconds) => {
    if (!viewerScene.courseCollision) {
      if (velocity.lengthSq() === 0) {
        mode = 'waiting';
        return;
      }

      velocity.addScaledVector(GRAVITY, deltaSeconds);
      position.addScaledVector(velocity, deltaSeconds);
      mode = 'air';
      return;
    }

    if (mode === 'ground') {
      stepGround(deltaSeconds);
      return;
    }

    if (mode === 'rest') {
      stepRest();
      return;
    }

    stepAir(deltaSeconds);
  };

  const launch = (launchVelocity = BALL_TEST_LAUNCH_VELOCITY) => {
    ensureCourseContact();
    if (launchVelocity === BALL_TEST_LAUNCH_VELOCITY) {
      velocity.copy(buildDefaultLaunchVelocity(viewerScene));
    } else {
      velocity.copy(launchVelocity);
    }
    mode = 'air';
  };

  const reset = () => {
    position.copy(BALL_START_POSITION);
    velocity.set(0, 0, 0);
    orientation.identity();
    supportNormal.set(0, 1, 0);
    accumulatorSeconds = 0;
    hasCourseContact = false;
    mode = 'waiting';
    ensureCourseContact();
    previousPosition.copy(position);
    previousOrientation.copy(orientation);
    renderPosition.copy(position);
    renderOrientation.copy(orientation);
  };

  ensureCourseContact();

  return {
    getDebugTelemetry() {
      return {
        mode,
        position,
        speedMetersPerSecond: velocity.length(),
        velocity,
      };
    },

    getPosition() {
      return renderPosition;
    },

    getOrientation() {
      return renderOrientation;
    },

    launch(launchVelocity = BALL_TEST_LAUNCH_VELOCITY) {
      launch(launchVelocity);
    },

    reset() {
      reset();
    },

    update(deltaSeconds) {
      ensureCourseContact();
      accumulatorSeconds = Math.min(
        accumulatorSeconds + deltaSeconds,
        BALL_FIXED_STEP_SECONDS * BALL_MAX_FIXED_STEPS_PER_FRAME,
      );

      while (accumulatorSeconds >= BALL_FIXED_STEP_SECONDS) {
        previousPosition.copy(position);
        previousOrientation.copy(orientation);
        step(BALL_FIXED_STEP_SECONDS);
        accumulatorSeconds -= BALL_FIXED_STEP_SECONDS;
      }

      const alpha = accumulatorSeconds / BALL_FIXED_STEP_SECONDS;
      renderPosition.lerpVectors(previousPosition, position, alpha);
      renderOrientation.slerpQuaternions(previousOrientation, orientation, alpha);
    },
  };

  function applyRollingRotation(previousPosition, nextPosition, surfaceNormal) {
    STEP_TRANSLATION.subVectors(nextPosition, previousPosition);
    const travelDistance = STEP_TRANSLATION.length();
    if (travelDistance <= 1e-6) {
      return;
    }

    ROLL_AXIS.crossVectors(surfaceNormal, STEP_TRANSLATION);
    if (ROLL_AXIS.lengthSq() <= 1e-10) {
      return;
    }

    ROLL_AXIS.normalize();
    DELTA_ROTATION.setFromAxisAngle(ROLL_AXIS, travelDistance / BALL_RADIUS);
    orientation.premultiply(DELTA_ROTATION).normalize();
  }
}

function applyRollingFriction(velocity, deltaSeconds) {
  const speed = velocity.length();
  if (speed <= 1e-6) {
    return;
  }

  const deceleration = BALL_ROLLING_FRICTION * BALL_GRAVITY_ACCELERATION * deltaSeconds;
  if (speed <= deceleration) {
    velocity.set(0, 0, 0);
    return;
  }

  velocity.addScaledVector(velocity, -deceleration / speed);
}

function shouldHoldAgainstSlope(velocity, projectedGravity) {
  if (velocity.lengthSq() > BALL_STOP_SPEED * BALL_STOP_SPEED) {
    return false;
  }

  return projectedGravity.lengthSq() <= (BALL_ROLLING_FRICTION * BALL_GRAVITY_ACCELERATION) ** 2;
}

function shouldEnterGroundMode(velocity, hitNormal) {
  if (hitNormal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return false;
  }

  const reboundNormalSpeed = Math.max(velocity.dot(hitNormal), 0);
  return reboundNormalSpeed <= BALL_GROUND_CAPTURE_NORMAL_SPEED
    && velocity.lengthSq() <= BALL_GROUND_CAPTURE_SPEED * BALL_GROUND_CAPTURE_SPEED;
}

function buildDefaultLaunchVelocity(viewerScene) {
  viewerScene.camera.getWorldDirection(CAMERA_FORWARD);
  HORIZONTAL_FORWARD.copy(CAMERA_FORWARD);
  HORIZONTAL_FORWARD.y = 0;

  if (HORIZONTAL_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FORWARD.normalize();
  }

  return LAUNCH_VELOCITY.copy(HORIZONTAL_FORWARD)
    .multiplyScalar(BALL_TEST_LAUNCH_FORWARD_SPEED)
    .addScaledVector(THREE.Object3D.DEFAULT_UP, BALL_TEST_LAUNCH_UPWARD_SPEED);
}

function resolveImpactVelocity(velocity, hitNormal) {
  const normalSpeed = velocity.dot(hitNormal);
  if (normalSpeed >= 0) {
    return;
  }

  WORKING_NORMAL_COMPONENT.copy(hitNormal).multiplyScalar(normalSpeed);
  velocity.sub(WORKING_NORMAL_COMPONENT);
  velocity.multiplyScalar(1 - BALL_IMPACT_FRICTION);
  velocity.addScaledVector(hitNormal, -normalSpeed * BALL_BOUNCE_RESTITUTION);
}

function removeIntoNormalComponent(vector, normal) {
  const normalSpeed = vector.dot(normal);
  if (normalSpeed >= 0) {
    return;
  }

  vector.addScaledVector(normal, -normalSpeed);
}

function projectOntoPlane(vector, normal) {
  vector.addScaledVector(normal, -vector.dot(normal));
  if (vector.distanceToSquared(ZERO_VECTOR) < BALL_STOP_SPEED * BALL_STOP_SPEED) {
    vector.set(0, 0, 0);
  }
}