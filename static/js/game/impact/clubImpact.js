import * as THREE from 'three';
import {
  BALL_IMPACT_DEBUG_SPIN_AXIS,
  BALL_IMPACT_DEBUG_SPIN_SPEED,
  BALL_IMPACT_VERTICAL_LAUNCH_ANGLE,
  BALL_RADIUS,
  CLUB_HEAD_COLLIDER_RADIUS,
  CLUB_HEAD_CONTACT_MAX_VERTICAL_OFFSET,
  CLUB_HEAD_CONTACT_MIN_FORWARD_ALIGNMENT,
  CLUB_HEAD_HORIZONTAL_LAUNCH_LIMIT_DEGREES,
  CLUB_HEAD_IMPACT_MIN_SPEED,
  CLUB_HEAD_LAUNCH_DIRECTION_LOCAL,
  CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
  DEFAULT_CLUB_MIDDLE_SMASH_FACTOR,
} from '/static/js/game/constants.js';
import { interpolateClubHeadSample } from '/static/js/game/impact/contactHistory.js';

const SEGMENT_SWEEP = new THREE.Vector3();
const SEGMENT_TO_BALL = new THREE.Vector3();
const SEGMENT_START_TO_BALL = new THREE.Vector3();
const FORWARD_ALIGNMENT_DIRECTION = new THREE.Vector3();
const HORIZONTAL_FACING_FORWARD = new THREE.Vector3();
const HORIZONTAL_CONTACT_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_LAUNCH_DIRECTION = new THREE.Vector3();
const HORIZONTAL_LAUNCH_DIRECTION = new THREE.Vector3();
const SIGNED_ANGLE_CROSS = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function resolveClubBallImpact(
  characterTelemetry,
  ballPosition,
  estimatedClubHeadSpeedMetersPerSecond,
  activeClub = null,
) {
  const history = characterTelemetry.clubHeadSampleHistory;
  if (!history || history.length === 0) {
    return null;
  }

  if (!Number.isFinite(estimatedClubHeadSpeedMetersPerSecond) || estimatedClubHeadSpeedMetersPerSecond <= 0) {
    return null;
  }

  if (estimatedClubHeadSpeedMetersPerSecond < CLUB_HEAD_IMPACT_MIN_SPEED) {
    return null;
  }

  const impactSample = findImpactSample(history, ballPosition, CLUB_HEAD_COLLIDER_RADIUS + BALL_RADIUS);
  if (!impactSample) {
    return null;
  }

  if (!isAllowedImpactGeometry(impactSample, ballPosition)) {
    return null;
  }

  const launchData = buildImpactLaunchData(
    {
      ...impactSample,
      clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    },
    activeClub,
  );
  const launchPreview = buildLaunchPreview(
    {
      ...impactSample,
      clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    },
    activeClub,
  );

  return {
    launchData,
    launchPreview,
    impactSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    referenceForward: impactSample.characterFacingForward.clone(),
  };
}

export function getClubLaunchPreview(characterTelemetry, estimatedClubHeadSpeedMetersPerSecond, activeClub = null) {
  if (!characterTelemetry?.hasClubHeadSample || !characterTelemetry.clubHeadQuaternion) {
    return null;
  }

  if (!Number.isFinite(estimatedClubHeadSpeedMetersPerSecond) || estimatedClubHeadSpeedMetersPerSecond <= 0) {
    return null;
  }

  return buildLaunchPreview(
    {
      quaternion: characterTelemetry.clubHeadQuaternion,
      characterFacingForward: characterTelemetry.characterFacingForward,
      clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    },
    activeClub,
  );
}

function buildLaunchPreview(impactSample, activeClub) {
  const launchMetrics = getLaunchMetrics(impactSample, activeClub);

  return {
    ...launchMetrics,
    clubHeadSpeedMetersPerSecond: impactSample.clubHeadSpeedMetersPerSecond,
    isReady: impactSample.clubHeadSpeedMetersPerSecond > 0.1,
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
    return null;
  }

  if (c <= 0) {
    return null;
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

function buildImpactLaunchData(impactSample, activeClub) {
  const launchMetrics = getLaunchMetrics(impactSample, activeClub);

  return {
    ballSpeed: launchMetrics.ballSpeed,
    verticalLaunchAngle: launchMetrics.verticalLaunchAngle,
    horizontalLaunchAngle: launchMetrics.horizontalLaunchAngle,
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

function getLaunchMetrics(impactSample, activeClub) {
  const baseLoftDegrees = Number.isFinite(activeClub?.loftDegrees)
    ? activeClub.loftDegrees
    : BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  const launchFactor = Number.isFinite(activeClub?.launchFactor)
    ? activeClub.launchFactor
    : 1;
  const smashFactor = Number.isFinite(activeClub?.smashFactor)
    ? activeClub.smashFactor
    : DEFAULT_CLUB_MIDDLE_SMASH_FACTOR;
  const measuredFacePitchDegrees = getMeasuredFacePitchDegrees(impactSample);
  const dynamicLoftDegrees = getDynamicLoftDegrees(
    measuredFacePitchDegrees,
    baseLoftDegrees,
    activeClub,
  );

  return {
    ballSpeed: impactSample.clubHeadSpeedMetersPerSecond * smashFactor,
    baseLoftDegrees,
    measuredFacePitchDegrees,
    dynamicLoftDegrees,
    horizontalLaunchAngle: getHorizontalLaunchAngleDegrees(impactSample),
    verticalLaunchAngle: THREE.MathUtils.clamp(
      dynamicLoftDegrees * launchFactor,
      CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
      CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
    ),
  };
}

function getDynamicLoftDegrees(measuredFacePitchDegrees, baseLoftDegrees, activeClub) {
  if (!Number.isFinite(measuredFacePitchDegrees)) {
    return THREE.MathUtils.clamp(
      baseLoftDegrees,
      CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
      CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
    );
  }

  const orientationLoftInfluence = Number.isFinite(activeClub?.orientationLoftInfluence)
    ? activeClub.orientationLoftInfluence
    : 0.3;
  const maxDynamicLoftDeltaDegrees = Number.isFinite(activeClub?.maxDynamicLoftDeltaDegrees)
    ? activeClub.maxDynamicLoftDeltaDegrees
    : 8;
  const orientationDeltaDegrees = THREE.MathUtils.clamp(
    (measuredFacePitchDegrees - baseLoftDegrees) * orientationLoftInfluence,
    -maxDynamicLoftDeltaDegrees,
    maxDynamicLoftDeltaDegrees,
  );

  return THREE.MathUtils.clamp(
    baseLoftDegrees + orientationDeltaDegrees,
    CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
    CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  );
}

function getMeasuredFacePitchDegrees(impactSample) {
  if (!impactSample.quaternion) {
    return null;
  }

  if (!getLaunchDirection(impactSample)) {
    return null;
  }

  const radians = Math.atan2(
    CLUB_HEAD_LAUNCH_DIRECTION.y,
    Math.max(Math.hypot(CLUB_HEAD_LAUNCH_DIRECTION.x, CLUB_HEAD_LAUNCH_DIRECTION.z), 1e-6),
  );
  return THREE.MathUtils.radToDeg(radians);
}

function getHorizontalLaunchAngleDegrees(impactSample) {
  if (!getLaunchDirection(impactSample)) {
    return 0;
  }

  HORIZONTAL_FACING_FORWARD.copy(impactSample.characterFacingForward);
  HORIZONTAL_FACING_FORWARD.y = 0;
  if (HORIZONTAL_FACING_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FACING_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FACING_FORWARD.normalize();
  }

  HORIZONTAL_LAUNCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION);
  HORIZONTAL_LAUNCH_DIRECTION.y = 0;
  if (HORIZONTAL_LAUNCH_DIRECTION.lengthSq() <= 1e-8) {
    HORIZONTAL_LAUNCH_DIRECTION.copy(HORIZONTAL_FACING_FORWARD);
  } else {
    HORIZONTAL_LAUNCH_DIRECTION.normalize();
  }

  return THREE.MathUtils.clamp(
    getSignedHorizontalAngleDegrees(
      HORIZONTAL_FACING_FORWARD,
      HORIZONTAL_LAUNCH_DIRECTION,
    ),
    -CLUB_HEAD_HORIZONTAL_LAUNCH_LIMIT_DEGREES,
    CLUB_HEAD_HORIZONTAL_LAUNCH_LIMIT_DEGREES,
  );
}

function getLaunchDirection(impactSample) {
  if (!impactSample.quaternion) {
    return false;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.copy(CLUB_HEAD_LAUNCH_DIRECTION_LOCAL)
    .applyQuaternion(impactSample.quaternion);
  if (CLUB_HEAD_LAUNCH_DIRECTION.lengthSq() <= 1e-8) {
    return false;
  }

  CLUB_HEAD_LAUNCH_DIRECTION.normalize();
  FORWARD_ALIGNMENT_DIRECTION.copy(impactSample.characterFacingForward);
  FORWARD_ALIGNMENT_DIRECTION.y = 0;
  if (FORWARD_ALIGNMENT_DIRECTION.lengthSq() <= 1e-8) {
    FORWARD_ALIGNMENT_DIRECTION.set(0, 0, -1);
  } else {
    FORWARD_ALIGNMENT_DIRECTION.normalize();
  }

  if (CLUB_HEAD_LAUNCH_DIRECTION.dot(FORWARD_ALIGNMENT_DIRECTION) < 0) {
    CLUB_HEAD_LAUNCH_DIRECTION.multiplyScalar(-1);
  }

  return true;
}

function isAllowedImpactGeometry(impactSample, ballPosition) {
  FORWARD_ALIGNMENT_DIRECTION.copy(impactSample.characterFacingForward);
  FORWARD_ALIGNMENT_DIRECTION.y = 0;
  if (FORWARD_ALIGNMENT_DIRECTION.lengthSq() <= 1e-8) {
    FORWARD_ALIGNMENT_DIRECTION.set(0, 0, -1);
  } else {
    FORWARD_ALIGNMENT_DIRECTION.normalize();
  }

  HORIZONTAL_CONTACT_DIRECTION.subVectors(ballPosition, impactSample.position);
  const verticalOffsetMeters = Math.abs(HORIZONTAL_CONTACT_DIRECTION.y);
  if (verticalOffsetMeters > CLUB_HEAD_CONTACT_MAX_VERTICAL_OFFSET) {
    return false;
  }

  HORIZONTAL_CONTACT_DIRECTION.y = 0;
  if (HORIZONTAL_CONTACT_DIRECTION.lengthSq() <= 1e-8) {
    return false;
  }

  HORIZONTAL_CONTACT_DIRECTION.normalize();
  return HORIZONTAL_CONTACT_DIRECTION.dot(FORWARD_ALIGNMENT_DIRECTION) >= CLUB_HEAD_CONTACT_MIN_FORWARD_ALIGNMENT;
}
