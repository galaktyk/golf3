import * as THREE from 'three';
import {
  BALL_AIR_DRAG,
  BALL_BOUNCE_RESTITUTION,
  BALL_COLLISION_SKIN,
  BALL_CONTACT_GENTLE_BRAKE_SCALE,
  BALL_CONTACT_FULL_BRAKE_AIRTIME_SECONDS,
  BALL_CONTACT_GENTLE_ENTRY_AIRTIME_SECONDS,
  BALL_CONTACT_GENTLE_ENTRY_NORMAL_SPEED,
  BALL_CONTACT_GENTLE_MIN_DURATION_SECONDS,
  BALL_CONTACT_GENTLE_ROLLING_SLIP_SPEED,
  BALL_CONTACT_SPEED_FRICTION,
  BALL_CONTACT_MAX_ROLLING_SPEED,
  BALL_CONTACT_MIN_DURATION_SECONDS,
  BALL_CONTACT_ROLLING_SLIP_SPEED,
  BALL_FIXED_STEP_SECONDS,
  BALL_GROUND_CAPTURE_NORMAL_SPEED,
  BALL_GROUND_CAPTURE_SPEED,
  BALL_GROUND_SNAP_DISTANCE,
  BALL_GROUNDED_NORMAL_MIN_Y,
  BALL_GRAVITY_ACCELERATION,
  BALL_IMPACT_FRICTION,
  BALL_IMPACT_MAX_FRICTION,
  BALL_IMPACT_REFERENCE_NORMAL_SPEED,
  BALL_MAX_COLLISION_ITERATIONS,
  BALL_MAX_FIXED_STEPS_PER_FRAME,
  BALL_HARD_LANDING_NORMAL_SPEED,
  BALL_RADIUS,
  BALL_ROLLING_RESISTANCE,
  BALL_SLIDING_FRICTION,
  BALL_SPIN_AIR_DAMPING,
  BALL_SPIN_GROUND_DAMPING,
  BALL_STATIC_FRICTION,
  BALL_START_POSITION,
  BALL_STOP_SPEED,
  BALL_DEFAULT_LAUNCH_DATA,
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
const LAUNCH_DIRECTION = new THREE.Vector3();
const LAUNCH_VELOCITY = new THREE.Vector3();
const LAUNCH_RIGHT = new THREE.Vector3();
const DELTA_ROTATION = new THREE.Quaternion();
const ZERO_VECTOR = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CONTACT_OFFSET = new THREE.Vector3();
const CONTACT_POINT_VELOCITY = new THREE.Vector3();
const CONTACT_TANGENT_VELOCITY = new THREE.Vector3();
const CONTACT_IMPULSE_DELTA = new THREE.Vector3();
const CONTACT_SPIN_VELOCITY = new THREE.Vector3();
const TARGET_ANGULAR_VELOCITY = new THREE.Vector3();
const ANGULAR_STEP_AXIS = new THREE.Vector3();
const ANGULAR_NORMAL_COMPONENT = new THREE.Vector3();
const TANGENT_VELOCITY = new THREE.Vector3();

function createGroundTransitionDebug() {
  return {
    captureAttempted: false,
    snappedToGround: false,
    preImpactSpeedMetersPerSecond: 0,
    postImpactSpeedMetersPerSecond: 0,
    postSnapSpeedMetersPerSecond: 0,
    preImpactNormalSpeedMetersPerSecond: 0,
    preImpactTangentSpeedMetersPerSecond: 0,
    postImpactNormalSpeedMetersPerSecond: 0,
    postImpactTangentSpeedMetersPerSecond: 0,
    snapLossMetersPerSecond: 0,
    preImpactSpinRpm: 0,
    postImpactSpinRpm: 0,
    postSnapSpinRpm: 0,
    impactNormal: null,
    supportNormal: null,
    movementState: null,
  };
}

export function createBallPhysics(viewerScene) {
  const position = BALL_START_POSITION.clone();
  const velocity = new THREE.Vector3();
  const angularVelocity = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const previousPosition = position.clone();
  const previousOrientation = orientation.clone();
  const renderPosition = position.clone();
  const renderOrientation = orientation.clone();
  const shotStartPosition = position.clone();
  const supportNormal = new THREE.Vector3(0, 1, 0);
  let accumulatorSeconds = 0;
  let phase = 'ready';
  let movementState = 'waiting';
  let hasCourseContact = false;
  let debugAutoLaunchConsumed = false;
  let shotSettled = false;
  let contactAgeSeconds = 0;
  let contactBrakeScale = 1;
  let airborneTimeSeconds = 0;
  let lastGroundTransitionDebug = createGroundTransitionDebug();

  const snapToGround = (maxSnapDistance, groundedMovementState = movementState) => {
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
      angularVelocity.set(0, 0, 0);
    }

    SUPPORT_PROJECTED_GRAVITY.copy(GRAVITY);
    SUPPORT_PROJECTED_GRAVITY.addScaledVector(supportNormal, -SUPPORT_PROJECTED_GRAVITY.dot(supportNormal));
    movementState = shouldHoldAgainstSlope(velocity, SUPPORT_PROJECTED_GRAVITY) ? 'rest' : groundedMovementState;
    if (phase === 'moving' && movementState === 'rest') {
      shotSettled = true;
    }
    if (movementState !== 'contact') {
      contactBrakeScale = 1;
    }
    return true;
  };

  const ensureCourseContact = () => {
    if (!viewerScene.courseCollision || hasCourseContact) {
      return;
    }

    if (!snapToGround(BALL_GROUND_SNAP_DISTANCE * 2, 'ground')) {
      movementState = velocity.lengthSq() > 0 ? 'air' : 'waiting';
    }

    hasCourseContact = true;

    if (DEBUG_AUTO_LAUNCH && !debugAutoLaunchConsumed) {
      debugAutoLaunchConsumed = true;
      launch();
    }
  };

  const stepAir = (deltaSeconds) => {
    airborneTimeSeconds += deltaSeconds;
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
        movementState = 'air';
        applyAirSpinDamping(angularVelocity, deltaSeconds);
        integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds);
        return;
      }

      const preImpactSpeedMetersPerSecond = velocity.length();
      const preImpactNormalSpeedMetersPerSecond = Math.max(-velocity.dot(sweep.hitNormal), 0);
      const preImpactTangentSpeedMetersPerSecond = Math.sqrt(Math.max(
        preImpactSpeedMetersPerSecond * preImpactSpeedMetersPerSecond
          - preImpactNormalSpeedMetersPerSecond * preImpactNormalSpeedMetersPerSecond,
        0,
      ));
      const preImpactSpinRpm = getSpinRpm(angularVelocity);
      resolveImpactVelocity(velocity, angularVelocity, sweep.hitNormal);
      const postImpactSpeedMetersPerSecond = velocity.length();
      const postImpactNormalSpeedMetersPerSecond = Math.max(velocity.dot(sweep.hitNormal), 0);
      const postImpactTangentSpeedMetersPerSecond = Math.sqrt(Math.max(
        postImpactSpeedMetersPerSecond * postImpactSpeedMetersPerSecond
          - postImpactNormalSpeedMetersPerSecond * postImpactNormalSpeedMetersPerSecond,
        0,
      ));
      remainingFraction *= Math.max(1 - sweep.travelFraction, 0);

      if (shouldEnterGroundMode(velocity, sweep.hitNormal)) {
        lastGroundTransitionDebug = {
          captureAttempted: true,
          snappedToGround: false,
          preImpactSpeedMetersPerSecond,
          postImpactSpeedMetersPerSecond,
          postSnapSpeedMetersPerSecond: 0,
          preImpactNormalSpeedMetersPerSecond,
          preImpactTangentSpeedMetersPerSecond,
          postImpactNormalSpeedMetersPerSecond,
          postImpactTangentSpeedMetersPerSecond,
          snapLossMetersPerSecond: 0,
          preImpactSpinRpm,
          postImpactSpinRpm: getSpinRpm(angularVelocity),
          postSnapSpinRpm: 0,
          impactNormal: sweep.hitNormal.clone(),
          supportNormal: null,
          movementState: null,
        };
        supportNormal.copy(sweep.hitNormal);

        const enterContactState = preImpactNormalSpeedMetersPerSecond > BALL_HARD_LANDING_NORMAL_SPEED
          || postImpactSpeedMetersPerSecond > BALL_CONTACT_MAX_ROLLING_SPEED;
        const landingState = enterContactState ? 'contact' : 'ground';
        if (snapToGround(BALL_GROUND_SNAP_DISTANCE, landingState)) {
          if (enterContactState) {
            contactAgeSeconds = 0;
            contactBrakeScale = getGroundContactBrakeScale(
              preImpactNormalSpeedMetersPerSecond,
              airborneTimeSeconds,
            );
          } else {
            contactBrakeScale = 1;
          }
          airborneTimeSeconds = 0;
          lastGroundTransitionDebug.snappedToGround = true;
          lastGroundTransitionDebug.postSnapSpeedMetersPerSecond = velocity.length();
          lastGroundTransitionDebug.snapLossMetersPerSecond = Math.max(
            postImpactSpeedMetersPerSecond - lastGroundTransitionDebug.postSnapSpeedMetersPerSecond,
            0,
          );
          lastGroundTransitionDebug.postSnapSpinRpm = getSpinRpm(angularVelocity);
          lastGroundTransitionDebug.supportNormal = supportNormal.clone();
          lastGroundTransitionDebug.movementState = movementState;
          integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds);
          return;
        }
      }

      const separationPush = sweep.hitNormal.y >= BALL_GROUNDED_NORMAL_MIN_Y
        ? BALL_COLLISION_SKIN * 2
        : BALL_COLLISION_SKIN * 0.1;
      position.addScaledVector(sweep.hitNormal, separationPush);
      movementState = 'air';
    }
    applyAirSpinDamping(angularVelocity, deltaSeconds);
    integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds);
  };

  const stepGround = (deltaSeconds) => {
    PROJECTED_GRAVITY.copy(GRAVITY);
    PROJECTED_GRAVITY.addScaledVector(supportNormal, -PROJECTED_GRAVITY.dot(supportNormal));

    velocity.addScaledVector(PROJECTED_GRAVITY, deltaSeconds);
    applyRollingResistance(velocity, deltaSeconds);
    syncRollingAngularVelocity(angularVelocity, velocity, supportNormal);
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

    if (!snapToGround(BALL_GROUND_SNAP_DISTANCE, 'ground')) {
      movementState = 'air';
      return;
    }

    if (shouldHoldAgainstSlope(velocity, PROJECTED_GRAVITY)) {
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
      movementState = 'rest';
      if (phase === 'moving') {
        shotSettled = true;
      }
    }

    applyGroundSpinDamping(angularVelocity, deltaSeconds);
    syncRollingAngularVelocity(angularVelocity, velocity, supportNormal);
    integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds);
  };

  const stepContact = (deltaSeconds) => {
    contactAgeSeconds += deltaSeconds;
    PROJECTED_GRAVITY.copy(GRAVITY);
    PROJECTED_GRAVITY.addScaledVector(supportNormal, -PROJECTED_GRAVITY.dot(supportNormal));

    velocity.addScaledVector(PROJECTED_GRAVITY, deltaSeconds);
    applyGroundContactForces(velocity, angularVelocity, supportNormal, deltaSeconds, contactBrakeScale);
    DISPLACEMENT.copy(velocity).multiplyScalar(deltaSeconds);

    const contactSweepRadius = Math.max(BALL_RADIUS - BALL_COLLISION_SKIN, BALL_RADIUS * 0.5);
    const sweep = sweepSphereBVH(viewerScene.courseCollision, position, DISPLACEMENT, contactSweepRadius, {
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

    if (!snapToGround(BALL_GROUND_SNAP_DISTANCE, 'contact')) {
      movementState = 'air';
      contactAgeSeconds = 0;
      return;
    }

    if (shouldHoldAgainstSlope(velocity, PROJECTED_GRAVITY)) {
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
      movementState = 'rest';
      if (phase === 'moving') {
        shotSettled = true;
      }
      return;
    }

    if (shouldTransitionToRolling(velocity, angularVelocity, supportNormal, contactAgeSeconds, contactBrakeScale)) {
      movementState = 'ground';
      contactAgeSeconds = 0;
      contactBrakeScale = 1;
      syncRollingAngularVelocity(angularVelocity, velocity, supportNormal);
    }

    applyGroundSpinDamping(angularVelocity, deltaSeconds);
    if (movementState === 'ground') {
      syncRollingAngularVelocity(angularVelocity, velocity, supportNormal);
    }
    integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds);
  };

  const stepRest = () => {
    const support = findGroundSupport(viewerScene.courseCollision, position, BALL_RADIUS, BALL_GROUND_SNAP_DISTANCE);
    if (!support || support.normal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
      movementState = 'air';
      return;
    }

    supportNormal.copy(support.normal);
    SUPPORT_PROJECTED_GRAVITY.copy(GRAVITY);
    SUPPORT_PROJECTED_GRAVITY.addScaledVector(supportNormal, -SUPPORT_PROJECTED_GRAVITY.dot(supportNormal));

    if (!shouldHoldAgainstSlope(velocity, SUPPORT_PROJECTED_GRAVITY)) {
      movementState = 'ground';
      contactAgeSeconds = 0;
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
    angularVelocity.set(0, 0, 0);
    movementState = 'rest';
    if (phase === 'moving') {
      shotSettled = true;
    }
  };

  const step = (deltaSeconds) => {
    if (!viewerScene.courseCollision) {
      if (velocity.lengthSq() === 0) {
        movementState = 'waiting';
        return;
      }

      velocity.addScaledVector(GRAVITY, deltaSeconds);
      position.addScaledVector(velocity, deltaSeconds);
      movementState = 'air';
      return;
    }

    if (movementState === 'ground') {
      stepGround(deltaSeconds);
      return;
    }

    if (movementState === 'contact') {
      stepContact(deltaSeconds);
      return;
    }

    if (movementState === 'rest') {
      stepRest();
      return;
    }

    stepAir(deltaSeconds);
  };

  const launch = (launchData = BALL_DEFAULT_LAUNCH_DATA, referenceForward = null) => {


    ensureCourseContact();
    shotStartPosition.copy(position);
    velocity.copy(buildVelocityFromLaunchData(launchData, viewerScene, referenceForward));
    angularVelocity.copy(buildAngularVelocityFromLaunchData(launchData, viewerScene, referenceForward));
    phase = 'moving';
    movementState = 'air';
    contactAgeSeconds = 0;
    contactBrakeScale = 1;
    airborneTimeSeconds = 0;
    shotSettled = false;
  };

  const reset = () => {
    position.copy(BALL_START_POSITION);
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);
    orientation.identity();
    shotStartPosition.copy(position);
    supportNormal.set(0, 1, 0);
    accumulatorSeconds = 0;
    hasCourseContact = false;
    phase = 'ready';
    movementState = 'waiting';
    contactAgeSeconds = 0;
    contactBrakeScale = 1;
    airborneTimeSeconds = 0;
    shotSettled = false;
    lastGroundTransitionDebug = createGroundTransitionDebug();
    ensureCourseContact();
    previousPosition.copy(position);
    previousOrientation.copy(orientation);
    renderPosition.copy(position);
    renderOrientation.copy(orientation);
  };

  const prepareForNextShot = () => {
    if (velocity.lengthSq() < BALL_STOP_SPEED * BALL_STOP_SPEED) {
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
    }

    phase = 'ready';
    contactAgeSeconds = 0;
    contactBrakeScale = 1;
    airborneTimeSeconds = 0;
    shotSettled = false;
  };

  ensureCourseContact();

  return {
    consumeShotSettled() {
      if (!shotSettled) {
        return false;
      }

      shotSettled = false;
      return true;
    },

    getDebugTelemetry() {
      return {
        mode: phase === 'moving' ? `moving/${movementState}` : 'ready',
        movementState: phase === 'moving' ? movementState : null,
        phase,
        position,
        shotTravelDistanceMeters: Math.hypot(
          position.x - shotStartPosition.x,
          position.z - shotStartPosition.z,
        ),
        speedMetersPerSecond: velocity.length(),
        spinRpm: getSpinRpm(angularVelocity),
        angularVelocity,
        velocity,
        groundTransitionDebug: lastGroundTransitionDebug,
      };
    },

    getStateSnapshot() {
      return {
        movementState: phase === 'moving' ? movementState : null,
        phase,
      };
    },

    getPosition() {
      return renderPosition;
    },

    getOrientation() {
      return renderOrientation;
    },

    launch(launchData = BALL_DEFAULT_LAUNCH_DATA, referenceForward = null) {
      launch(launchData, referenceForward);
    },

    prepareForNextShot() {
      prepareForNextShot();
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
}

function applyGroundContactForces(velocity, angularVelocity, surfaceNormal, deltaSeconds, contactBrakeScale = 1) {
  CONTACT_OFFSET.copy(surfaceNormal).multiplyScalar(-BALL_RADIUS);
  CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(CONTACT_OFFSET);
  CONTACT_POINT_VELOCITY.copy(velocity).add(CONTACT_SPIN_VELOCITY);
  CONTACT_TANGENT_VELOCITY.copy(CONTACT_POINT_VELOCITY);
  CONTACT_TANGENT_VELOCITY.addScaledVector(surfaceNormal, -CONTACT_TANGENT_VELOCITY.dot(surfaceNormal));

  const slipSpeed = CONTACT_TANGENT_VELOCITY.length();
  if (slipSpeed > 1e-6) {
    const slidingDeltaSpeed = Math.min(
      slipSpeed,
      BALL_SLIDING_FRICTION * contactBrakeScale * BALL_GRAVITY_ACCELERATION * deltaSeconds,
    );
    CONTACT_IMPULSE_DELTA.copy(CONTACT_TANGENT_VELOCITY).multiplyScalar(-slidingDeltaSpeed / slipSpeed);
    velocity.add(CONTACT_IMPULSE_DELTA);
    applySurfaceImpulseToAngularVelocity(angularVelocity, surfaceNormal, CONTACT_IMPULSE_DELTA);
  }

  // Landing contact should keep bleeding speed until the ball is slow enough to become a true roll.
  const speed = velocity.length();
  if (speed > BALL_CONTACT_MAX_ROLLING_SPEED) {
    const contactBrakeSpeed = Math.min(
      speed - BALL_CONTACT_MAX_ROLLING_SPEED,
      BALL_CONTACT_SPEED_FRICTION * contactBrakeScale * BALL_GRAVITY_ACCELERATION * deltaSeconds,
    );
    if (contactBrakeSpeed > 0) {
      velocity.addScaledVector(velocity, -contactBrakeSpeed / speed);
    }
  }

  applyRollingResistance(velocity, deltaSeconds);
}

function applyRollingResistance(velocity, deltaSeconds) {
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

function shouldTransitionToRolling(velocity, angularVelocity, surfaceNormal, contactAgeSeconds, contactBrakeScale = 1) {
  const minContactDurationSeconds = THREE.MathUtils.lerp(
    BALL_CONTACT_GENTLE_MIN_DURATION_SECONDS,
    BALL_CONTACT_MIN_DURATION_SECONDS,
    contactBrakeScale,
  );
  if (contactAgeSeconds < minContactDurationSeconds) {
    return false;
  }

  if (velocity.length() > BALL_CONTACT_MAX_ROLLING_SPEED) {
    return false;
  }

  const rollingSlipSpeed = THREE.MathUtils.lerp(
    BALL_CONTACT_GENTLE_ROLLING_SLIP_SPEED,
    BALL_CONTACT_ROLLING_SLIP_SPEED,
    contactBrakeScale,
  );
  return getContactSlipSpeed(velocity, angularVelocity, surfaceNormal) <= rollingSlipSpeed;
}

/**
 * Scale landing-contact braking by both landing steepness and airtime.
 * Long airborne shots should not keep the same gentle contact profile as putts.
 */
function getGroundContactBrakeScale(impactNormalSpeed, airborneTimeSeconds) {
  const normalSpeedFactor = THREE.MathUtils.smoothstep(
    impactNormalSpeed,
    BALL_CONTACT_GENTLE_ENTRY_NORMAL_SPEED,
    BALL_HARD_LANDING_NORMAL_SPEED,
  );
  const airtimeFactor = THREE.MathUtils.smoothstep(
    airborneTimeSeconds,
    BALL_CONTACT_GENTLE_ENTRY_AIRTIME_SECONDS,
    BALL_CONTACT_FULL_BRAKE_AIRTIME_SECONDS,
  );
  return THREE.MathUtils.lerp(
    BALL_CONTACT_GENTLE_BRAKE_SCALE,
    1,
    Math.max(normalSpeedFactor, airtimeFactor),
  );
}

function getContactSlipSpeed(velocity, angularVelocity, surfaceNormal) {
  CONTACT_OFFSET.copy(surfaceNormal).multiplyScalar(-BALL_RADIUS);
  CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(CONTACT_OFFSET);
  CONTACT_POINT_VELOCITY.copy(velocity).add(CONTACT_SPIN_VELOCITY);
  CONTACT_TANGENT_VELOCITY.copy(CONTACT_POINT_VELOCITY);
  CONTACT_TANGENT_VELOCITY.addScaledVector(surfaceNormal, -CONTACT_TANGENT_VELOCITY.dot(surfaceNormal));
  return CONTACT_TANGENT_VELOCITY.length();
}

function shouldHoldAgainstSlope(velocity, projectedGravity) {
  if (velocity.lengthSq() > BALL_STOP_SPEED * BALL_STOP_SPEED) {
    return false;
  }

  return projectedGravity.lengthSq() <= (BALL_STATIC_FRICTION * BALL_GRAVITY_ACCELERATION) ** 2;
}

function shouldEnterGroundMode(velocity, hitNormal) {
  if (hitNormal.y < BALL_GROUNDED_NORMAL_MIN_Y) {
    return false;
  }

  const reboundNormalSpeed = Math.max(velocity.dot(hitNormal), 0);
  if (reboundNormalSpeed <= BALL_GROUND_CAPTURE_NORMAL_SPEED) {
    return true;
  }

  return velocity.lengthSq() <= BALL_GROUND_CAPTURE_SPEED * BALL_GROUND_CAPTURE_SPEED;
}

function buildVelocityFromLaunchData(launchData, viewerScene, referenceForward = null) {
  if (referenceForward && referenceForward.lengthSq() > 1e-8) {
    HORIZONTAL_FORWARD.copy(referenceForward);
  } else {
    viewerScene.camera.getWorldDirection(CAMERA_FORWARD);
    HORIZONTAL_FORWARD.copy(CAMERA_FORWARD);
  }

  HORIZONTAL_FORWARD.y = 0;

  if (HORIZONTAL_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FORWARD.normalize();
  }

  // Use ball speed directly in m/s
  const speedMpS = launchData.ballSpeed;
  const vertAngleRad = THREE.MathUtils.degToRad(launchData.verticalLaunchAngle);
  const horizAngleRad = THREE.MathUtils.degToRad(launchData.horizontalLaunchAngle);

  // Rotate horizontal forward vector by horizontal launch angle
  const launchDir = LAUNCH_DIRECTION.copy(HORIZONTAL_FORWARD).applyAxisAngle(THREE.Object3D.DEFAULT_UP, horizAngleRad);
  
  // Apply vertical launch angle
  const forwardSpeed = speedMpS * Math.cos(vertAngleRad);
  const upwardSpeed = speedMpS * Math.sin(vertAngleRad);

  return LAUNCH_VELOCITY.copy(launchDir)
    .multiplyScalar(forwardSpeed)
    .addScaledVector(THREE.Object3D.DEFAULT_UP, upwardSpeed);
}

function buildAngularVelocityFromLaunchData(launchData, viewerScene, referenceForward = null) {
  const spinSpeedRpm = Number.isFinite(launchData?.spinSpeed)
    ? launchData.spinSpeed
    : 0;
  if (Math.abs(spinSpeedRpm) <= 1e-6) {
    return TARGET_ANGULAR_VELOCITY.set(0, 0, 0);
  }

  const launchVelocity = buildVelocityFromLaunchData(launchData, viewerScene, referenceForward);
  const launchSpeed = launchVelocity.length();
  if (launchSpeed <= 1e-6) {
    return TARGET_ANGULAR_VELOCITY.set(0, 0, 0);
  }

  LAUNCH_DIRECTION.copy(launchVelocity).multiplyScalar(1 / launchSpeed);
  LAUNCH_RIGHT.crossVectors(LAUNCH_DIRECTION, WORLD_UP);
  if (LAUNCH_RIGHT.lengthSq() <= 1e-8) {
    LAUNCH_RIGHT.set(1, 0, 0);
  } else {
    LAUNCH_RIGHT.normalize();
  }

  if (typeof launchData?.spinAxis === 'object' && launchData.spinAxis) {
    const { x, y, z } = launchData.spinAxis;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      TARGET_ANGULAR_VELOCITY.set(x, y, z);
    } else {
      TARGET_ANGULAR_VELOCITY.copy(LAUNCH_RIGHT);
    }
  } else {
    const spinAxisDegrees = Number.isFinite(launchData?.spinAxis)
      ? launchData.spinAxis
      : 0;
    TARGET_ANGULAR_VELOCITY.copy(LAUNCH_RIGHT).applyAxisAngle(
      LAUNCH_DIRECTION,
      THREE.MathUtils.degToRad(spinAxisDegrees),
    );
  }

  if (TARGET_ANGULAR_VELOCITY.lengthSq() <= 1e-8) {
    TARGET_ANGULAR_VELOCITY.copy(LAUNCH_RIGHT);
  } else {
    TARGET_ANGULAR_VELOCITY.normalize();
  }

  return TARGET_ANGULAR_VELOCITY.multiplyScalar(THREE.MathUtils.degToRad(spinSpeedRpm * 6));
}

function resolveImpactVelocity(velocity, angularVelocity, hitNormal) {
  const normalSpeed = velocity.dot(hitNormal);
  if (normalSpeed >= 0) {
    return;
  }

  const incomingSpeed = velocity.length();
  const incomingNormalSpeed = Math.max(-normalSpeed, 0);
  WORKING_NORMAL_COMPONENT.copy(hitNormal).multiplyScalar(normalSpeed);
  TANGENT_VELOCITY.copy(velocity).sub(WORKING_NORMAL_COMPONENT);

  CONTACT_OFFSET.copy(hitNormal).multiplyScalar(-BALL_RADIUS);
  CONTACT_SPIN_VELOCITY.copy(angularVelocity).cross(CONTACT_OFFSET);
  CONTACT_POINT_VELOCITY.copy(TANGENT_VELOCITY).add(CONTACT_SPIN_VELOCITY);
  CONTACT_TANGENT_VELOCITY.copy(CONTACT_POINT_VELOCITY);
  CONTACT_TANGENT_VELOCITY.addScaledVector(hitNormal, -CONTACT_TANGENT_VELOCITY.dot(hitNormal));
  const incomingTangentSpeed = CONTACT_TANGENT_VELOCITY.length();

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
  const tangentDeltaSpeed = Math.min(incomingTangentSpeed, friction * incomingNormalSpeed);
  if (incomingTangentSpeed > 1e-6 && tangentDeltaSpeed > 0) {
    CONTACT_IMPULSE_DELTA.copy(CONTACT_TANGENT_VELOCITY).multiplyScalar(-tangentDeltaSpeed / incomingTangentSpeed);
    TANGENT_VELOCITY.add(CONTACT_IMPULSE_DELTA);
    applySurfaceImpulseToAngularVelocity(angularVelocity, hitNormal, CONTACT_IMPULSE_DELTA);
  }

  const restitution = THREE.MathUtils.lerp(
    0,
    BALL_BOUNCE_RESTITUTION,
    THREE.MathUtils.clamp(
      (incomingNormalSpeed - BALL_GROUND_CAPTURE_NORMAL_SPEED)
        / Math.max(BALL_IMPACT_REFERENCE_NORMAL_SPEED - BALL_GROUND_CAPTURE_NORMAL_SPEED, 1e-6),
      0,
      1,
    ),
  );

  velocity.copy(TANGENT_VELOCITY).addScaledVector(hitNormal, incomingNormalSpeed * restitution);
}

function applySurfaceImpulseToAngularVelocity(angularVelocity, surfaceNormal, linearVelocityDelta) {
  if (linearVelocityDelta.lengthSq() <= 1e-12) {
    return;
  }

  TARGET_ANGULAR_VELOCITY.copy(surfaceNormal).cross(linearVelocityDelta).multiplyScalar(-5 / (2 * BALL_RADIUS));
  angularVelocity.add(TARGET_ANGULAR_VELOCITY);
}

function applyAirSpinDamping(angularVelocity, deltaSeconds) {
  angularVelocity.multiplyScalar(Math.exp(-BALL_SPIN_AIR_DAMPING * deltaSeconds));
}

function applyGroundSpinDamping(angularVelocity, deltaSeconds) {
  angularVelocity.multiplyScalar(Math.exp(-BALL_SPIN_GROUND_DAMPING * deltaSeconds));
}

function syncRollingAngularVelocity(angularVelocity, velocity, surfaceNormal) {
  TARGET_ANGULAR_VELOCITY.copy(surfaceNormal).cross(velocity).multiplyScalar(1 / BALL_RADIUS);
  ANGULAR_NORMAL_COMPONENT.copy(surfaceNormal).multiplyScalar(angularVelocity.dot(surfaceNormal));
  angularVelocity.copy(TARGET_ANGULAR_VELOCITY).add(ANGULAR_NORMAL_COMPONENT);
}

function integrateOrientationFromAngularVelocity(orientation, angularVelocity, deltaSeconds) {
  const angularSpeed = angularVelocity.length();
  if (angularSpeed <= 1e-6) {
    return;
  }

  ANGULAR_STEP_AXIS.copy(angularVelocity).multiplyScalar(1 / angularSpeed);
  DELTA_ROTATION.setFromAxisAngle(ANGULAR_STEP_AXIS, angularSpeed * deltaSeconds);
  orientation.premultiply(DELTA_ROTATION).normalize();
}

function getSpinRpm(angularVelocity) {
  return angularVelocity.length() * 30 / Math.PI;
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