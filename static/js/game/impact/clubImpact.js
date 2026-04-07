import * as THREE from 'three';
import {
  BALL_IMPACT_DEBUG_SPIN_AXIS,
  BALL_IMPACT_DEBUG_SPIN_SPEED,
  BALL_IMPACT_VERTICAL_LAUNCH_ANGLE,
  BALL_RADIUS,
  CLUB_HEAD_COLLIDER_RADIUS,
  CLUB_HEAD_IMPACT_MIN_SPEED,
  CLUB_HEAD_LAUNCH_DIRECTION_LOCAL,
  CLUB_HEAD_TO_BALL_SPEED_FACTOR,
  CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
} from '/static/js/game/constants.js';
import { estimateVelocityAtSample, interpolateClubHeadSample } from '/static/js/game/impact/contactHistory.js';

const SEGMENT_SWEEP = new THREE.Vector3();
const SEGMENT_TO_BALL = new THREE.Vector3();
const SEGMENT_START_TO_BALL = new THREE.Vector3();
const CONTACT_TO_BALL = new THREE.Vector3();
const HORIZONTAL_ARRIVAL_DIRECTION = new THREE.Vector3();
const HORIZONTAL_FACING_FORWARD = new THREE.Vector3();
const CLUB_HEAD_LAUNCH_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_PITCH_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_SIDE_AXIS = new THREE.Vector3();
const SIGNED_ANGLE_CROSS = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function resolveClubBallImpact(characterTelemetry, ballPosition) {
  const history = characterTelemetry.clubHeadSampleHistory;
  if (!history || history.length === 0) {
    return null;
  }

  const impactSample = findImpactSample(history, ballPosition, CLUB_HEAD_COLLIDER_RADIUS + BALL_RADIUS);
  if (!impactSample) {
    return null;
  }

  const impactVelocity = estimateVelocityAtSample(history, impactSample);
  const impactSpeedMetersPerSecond = impactVelocity.length();
  if (impactSpeedMetersPerSecond < CLUB_HEAD_IMPACT_MIN_SPEED) {
    return null;
  }

  CONTACT_TO_BALL.subVectors(ballPosition, impactSample.position);
  if (impactVelocity.dot(CONTACT_TO_BALL) <= 0) {
    return null;
  }

  const launchData = buildImpactLaunchData({
    ...impactSample,
    velocity: impactVelocity,
    speedMetersPerSecond: impactSpeedMetersPerSecond,
  });

  return {
    launchData,
    referenceForward: impactSample.characterFacingForward.clone(),
  };
}

function findImpactSample(history, ballPosition, contactDistance) {
  for (let index = 1; index < history.length; index += 1) {
    const startSample = history[index - 1];
    const endSample = history[index];
    const contactAlpha = getSegmentSphereContactAlpha(
      startSample.position,
      endSample.position,
      ballPosition,
      contactDistance,
    );

    if (contactAlpha == null) {
      continue;
    }

    SEGMENT_SWEEP.subVectors(endSample.position, startSample.position);
    if (SEGMENT_SWEEP.lengthSq() > 1e-10) {
      SEGMENT_START_TO_BALL.subVectors(ballPosition, startSample.position);
      if (SEGMENT_SWEEP.dot(SEGMENT_START_TO_BALL) <= 0) {
        continue;
      }
    }

    return interpolateClubHeadSample(startSample, endSample, contactAlpha);
  }

  return null;
}

function getSegmentSphereContactAlpha(startPosition, endPosition, sphereCenter, sphereRadius) {
  SEGMENT_SWEEP.subVectors(endPosition, startPosition);
  SEGMENT_TO_BALL.subVectors(startPosition, sphereCenter);

  const segmentLengthSquared = SEGMENT_SWEEP.lengthSq();
  const c = SEGMENT_TO_BALL.lengthSq() - (sphereRadius * sphereRadius);
  if (segmentLengthSquared <= 1e-10) {
    return c <= 0 ? 0 : null;
  }

  if (c <= 0) {
    return 0;
  }

  const b = SEGMENT_TO_BALL.dot(SEGMENT_SWEEP);
  if (b > 0) {
    return null;
  }

  const discriminant = (b * b) - (segmentLengthSquared * c);
  if (discriminant < 0) {
    return null;
  }

  const contactAlpha = (-b - Math.sqrt(discriminant)) / segmentLengthSquared;
  if (contactAlpha < 0 || contactAlpha > 1) {
    return null;
  }

  return contactAlpha;
}

function buildImpactLaunchData(impactSample) {
  HORIZONTAL_ARRIVAL_DIRECTION.copy(impactSample.velocity);
  HORIZONTAL_ARRIVAL_DIRECTION.y = 0;
  if (HORIZONTAL_ARRIVAL_DIRECTION.lengthSq() <= 1e-8) {
    HORIZONTAL_ARRIVAL_DIRECTION.copy(impactSample.characterFacingForward);
  } else {
    HORIZONTAL_ARRIVAL_DIRECTION.normalize();
  }

  HORIZONTAL_FACING_FORWARD.copy(impactSample.characterFacingForward);
  HORIZONTAL_FACING_FORWARD.y = 0;
  if (HORIZONTAL_FACING_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FACING_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FACING_FORWARD.normalize();
  }

  return {
    ballSpeed: impactSample.speedMetersPerSecond * CLUB_HEAD_TO_BALL_SPEED_FACTOR,
    verticalLaunchAngle: getVerticalLaunchAngleDegrees(impactSample),
    horizontalLaunchAngle: getSignedHorizontalAngleDegrees(
      HORIZONTAL_FACING_FORWARD,
      HORIZONTAL_ARRIVAL_DIRECTION,
    ),
    spinSpeed: BALL_IMPACT_DEBUG_SPIN_SPEED,
    spinAxis: BALL_IMPACT_DEBUG_SPIN_AXIS,
  };
}

function getSignedHorizontalAngleDegrees(fromDirection, toDirection) {
  const dot = THREE.MathUtils.clamp(fromDirection.dot(toDirection), -1, 1);
  SIGNED_ANGLE_CROSS.crossVectors(fromDirection, toDirection);
  const radians = Math.atan2(SIGNED_ANGLE_CROSS.y, dot);
  return THREE.MathUtils.radToDeg(radians);
}

function getVerticalLaunchAngleDegrees(impactSample) {
  if (!impactSample.quaternion) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION_LOCAL)
    .applyQuaternion(impactSample.quaternion);
  if (CLUB_HEAD_LAUNCH_DIRECTION.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.normalize();
  if (CLUB_HEAD_LAUNCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION) < 0) {
    CLUB_HEAD_LAUNCH_DIRECTION.multiplyScalar(-1);
  }

  CLUB_HEAD_SIDE_AXIS.crossVectors(HORIZONTAL_ARRIVAL_DIRECTION, WORLD_UP);
  if (CLUB_HEAD_SIDE_AXIS.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_SIDE_AXIS.normalize();
  CLUB_HEAD_PITCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION);
  CLUB_HEAD_PITCH_DIRECTION.addScaledVector(
    CLUB_HEAD_SIDE_AXIS,
    -CLUB_HEAD_PITCH_DIRECTION.dot(CLUB_HEAD_SIDE_AXIS),
  );
  if (CLUB_HEAD_PITCH_DIRECTION.lengthSq() <= 1e-8) {
    return BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  }

  CLUB_HEAD_PITCH_DIRECTION.normalize();
  if (CLUB_HEAD_PITCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION) < 0) {
    CLUB_HEAD_PITCH_DIRECTION.multiplyScalar(-1);
  }

  const radians = Math.atan2(
    CLUB_HEAD_PITCH_DIRECTION.y,
    Math.max(CLUB_HEAD_PITCH_DIRECTION.dot(HORIZONTAL_ARRIVAL_DIRECTION), 1e-6),
  );
  return THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(radians),
    CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
    CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  );
}
