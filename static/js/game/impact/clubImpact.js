import * as THREE from 'three';
import {
  BALL_IMPACT_VERTICAL_LAUNCH_ANGLE,
  CLUB_HEAD_HORIZONTAL_LAUNCH_LIMIT_DEGREES,
  CLUB_HEAD_IMPACT_MIN_SPEED,
  CLUB_HEAD_LAUNCH_DIRECTION_LOCAL,
  CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE,
  CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE,
  DEFAULT_CLUB_MIDDLE_SMASH_FACTOR,
  PUTTER_CLUB_HEAD_IMPACT_MIN_SPEED,
} from '/static/js/game/constants.js';
import { interpolateClubHeadSample } from '/static/js/game/impact/contactHistory.js';

const SEGMENT_SWEEP = new THREE.Vector3();
const FORWARD_ALIGNMENT_DIRECTION = new THREE.Vector3();
const HORIZONTAL_FACING_FORWARD = new THREE.Vector3();
const HORIZONTAL_CONTACT_DIRECTION = new THREE.Vector3();
const CLUB_HEAD_LAUNCH_DIRECTION = new THREE.Vector3();
const HORIZONTAL_LAUNCH_DIRECTION = new THREE.Vector3();
const VELOCITY_DIRECTION = new THREE.Vector3();
const SIGNED_ANGLE_CROSS = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Scratch vectors for hit-zone plane intersection.
const PLANE_NORMAL = new THREE.Vector3();
const PLANE_RIGHT = new THREE.Vector3();
const CONTACT_POINT = new THREE.Vector3();

/**
 * Number of history samples to span when computing the smoothed velocity direction at impact.
 * A wider span reduces per-frame jitter caused by low FPS or low gyro sampling rates.
 * Falls back to the adjacent pair when the wide span is degenerate.
 */
const VELOCITY_SMOOTH_WINDOW_SAMPLES = 3;

/**
 * Half-extents of the 1×1 m hit-zone plane used to detect club-ball impact.
 * Any club-head sweep that crosses the plane centred on the ball within these
 * bounds registers as a valid impact.
 */
export const HIT_ZONE_HALF_WIDTH = 0.75;   // metres, horizontal (left / right)
export const HIT_ZONE_HALF_HEIGHT = 0.6;  // metres, vertical  (up   / down)

const CLUB_CATEGORY_DEFAULT_SPIN_PROFILE = {
  wood: 0.85,
  iron: 1,
  wedge: 1.08,
};

export function resolveClubBallImpact(
  characterTelemetry,
  ballPosition,
  estimatedClubHeadSpeedMetersPerSecond,
  activeClub = null,
  debugInfo = null,
) {
  const history = characterTelemetry.clubHeadSampleHistory;
  assignImpactDebugInfo(debugInfo, {
    reason: 'unknown',
    historyLength: history?.length ?? 0,
    estimatedClubHeadSpeedMetersPerSecond,
    minimumImpactSpeedMetersPerSecond: getImpactMinSpeedMetersPerSecond(activeClub),
    geometryRejectCount: 0,
    backwardSweepRejectCount: 0,
    hitZoneBoundsRejectCount: 0,
  });
  if (!history || history.length === 0) {
    assignImpactDebugInfo(debugInfo, { reason: 'no_history' });
    return null;
  }

  if (!Number.isFinite(estimatedClubHeadSpeedMetersPerSecond) || estimatedClubHeadSpeedMetersPerSecond <= 0) {
    assignImpactDebugInfo(debugInfo, { reason: 'invalid_speed' });
    return null;
  }

  if (estimatedClubHeadSpeedMetersPerSecond < getImpactMinSpeedMetersPerSecond(activeClub)) {
    assignImpactDebugInfo(debugInfo, { reason: 'below_min_speed' });
    return null;
  }

  const impactSample = findImpactSample(
    history,
    ballPosition,
    debugInfo,
  );
  if (!impactSample) {
    if (debugInfo?.reason === 'unknown') {
      assignImpactDebugInfo(debugInfo, { reason: 'no_valid_contact' });
    }
    return null;
  }

  assignImpactDebugInfo(debugInfo, { reason: 'accepted' });

  const resolvedImpactSample = {
    ...impactSample,
    clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
  };
  const launchMetrics = getLaunchMetrics(resolvedImpactSample, activeClub);

  const launchData = buildImpactLaunchData(
    resolvedImpactSample,
    activeClub,
    launchMetrics,
  );
  const launchPreview = buildLaunchPreview(
    resolvedImpactSample,
    activeClub,
    launchMetrics,
  );

  return {
    launchData,
    launchPreview,
    impactSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    referenceForward: impactSample.characterFacingForward.clone(),
  };
}

/**
 * Uses a lower capture threshold for putts so slow rolls can still register as valid impacts.
 */
function getImpactMinSpeedMetersPerSecond(activeClub) {
  return activeClub?.category === 'putter'
    ? PUTTER_CLUB_HEAD_IMPACT_MIN_SPEED
    : CLUB_HEAD_IMPACT_MIN_SPEED;
}

/**
 *  Provides a launch preview based on the most recent club head sample, which can be used for real-time aiming feedback before impact.
 * 
 */
export function getClubLaunchPreview(characterTelemetry, estimatedClubHeadSpeedMetersPerSecond, activeClub = null) {
  if (!characterTelemetry?.hasClubHeadSample || !characterTelemetry.clubHeadQuaternion) {
    return null;
  }

  if (!Number.isFinite(estimatedClubHeadSpeedMetersPerSecond) || estimatedClubHeadSpeedMetersPerSecond <= 0) {
    return null;
  }

  // Derive a smoothed swing-path velocity from multiple recent history samples so the
  // preview horizontal angle is stable at low FPS or low gyro rates.
  const history = characterTelemetry.clubHeadSampleHistory;
  const previewVelocityDirection = (history && history.length >= 2)
    ? getSmoothedVelocityDirection(history, history.length - 1)
    : null;

  return buildLaunchPreview(
    {
      quaternion: characterTelemetry.clubHeadQuaternion,
      characterFacingForward: characterTelemetry.characterFacingForward,
      clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
      velocityDirection: previewVelocityDirection,
    },
    activeClub,
  );
}


/** 
 * Provides a neutral launch preview based solely on the estimated club head speed and the active club's base loft, without considering the actual club head orientation. This can be used as a fallback aiming feedback when no reliable club head samples are available.
 */
export function getNeutralClubLaunchPreview(estimatedClubHeadSpeedMetersPerSecond, activeClub = null) {
  if (!Number.isFinite(estimatedClubHeadSpeedMetersPerSecond) || estimatedClubHeadSpeedMetersPerSecond <= 0) {
    return null;
  }

  return buildLaunchPreview(
    {
      clubHeadSpeedMetersPerSecond: estimatedClubHeadSpeedMetersPerSecond,
    },
    activeClub,
  );
}

function buildLaunchPreview(impactSample, activeClub, launchMetrics = null) {
  const resolvedLaunchMetrics = launchMetrics ?? getLaunchMetrics(impactSample, activeClub);
  const spinMetrics = getLaunchSpinMetrics(impactSample, activeClub, resolvedLaunchMetrics);

  return {
    ...resolvedLaunchMetrics,
    ...spinMetrics,
    clubHeadSpeedMetersPerSecond: impactSample.clubHeadSpeedMetersPerSecond,
    isReady: impactSample.clubHeadSpeedMetersPerSecond > 0.1,
  };
}

/**
 * Finds the history segment where the club head crosses the 1×1 m hit-zone plane
 * centred on the ball.
 *
 * The plane's normal is derived from the most recent sample's characterFacingForward
 * (flattened to horizontal) so it faces the player's swing direction. An impact is
 * accepted when:
 *   1. The segment crosses the plane going in the forward direction (not backward).
 *   2. The contact point lies within ±HIT_ZONE_HALF_WIDTH (horizontal) and
 *      ±HIT_ZONE_HALF_HEIGHT (vertical) of the ball centre.
 *
 * Searching newest-to-oldest prevents an older graze from shadowing a later valid strike.
 */
function findImpactSample(history, ballPosition, debugInfo = null) {
  // Build the hit-zone plane normal from the most recent sample's facing direction.
  const latestSample = history[history.length - 1];
  PLANE_NORMAL.copy(latestSample.characterFacingForward).setY(0);
  if (PLANE_NORMAL.lengthSq() <= 1e-8) {
    PLANE_NORMAL.set(0, 0, -1);
  } else {
    PLANE_NORMAL.normalize();
  }
  // Right axis of the plane: perpendicular to the normal in the horizontal plane.
  PLANE_RIGHT.crossVectors(PLANE_NORMAL, WORLD_UP).normalize();

  for (let index = history.length - 1; index >= 1; index -= 1) {
    const startSample = history[index - 1];
    const endSample = history[index];

    SEGMENT_SWEEP.subVectors(endSample.position, startSample.position);

    // How much of the segment projects onto the plane normal.
    // Must be positive: the club must be sweeping toward the target, not backward.
    const denom = SEGMENT_SWEEP.dot(PLANE_NORMAL);
    if (denom <= 1e-6) {
      if (debugInfo) {
        debugInfo.backwardSweepRejectCount += 1;
      }
      continue;
    }

    // Signed distance from segment start to the plane, along the normal.
    const distToPlane = ballPosition.dot(PLANE_NORMAL) - startSample.position.dot(PLANE_NORMAL);
    const alpha = distToPlane / denom;

    if (alpha < 0 || alpha > 1) {
      // Segment does not reach (or overshoots) the plane within this step.
      continue;
    }

    // World-space point where the segment crosses the plane.
    CONTACT_POINT.copy(startSample.position).addScaledVector(SEGMENT_SWEEP, alpha);

    // Project the contact offset onto the plane's local axes and check bounds.
    const localRight = CONTACT_POINT.dot(PLANE_RIGHT) - ballPosition.dot(PLANE_RIGHT);
    const localUp = CONTACT_POINT.y - ballPosition.y;

    if (Math.abs(localRight) > HIT_ZONE_HALF_WIDTH || Math.abs(localUp) > HIT_ZONE_HALF_HEIGHT) {
      if (debugInfo) {
        debugInfo.hitZoneBoundsRejectCount += 1;
      }
      continue;
    }

    // Valid crossing — interpolate the full sample and attach the smoothed velocity.
    const impactSample = interpolateClubHeadSample(startSample, endSample, alpha);
    impactSample.velocityDirection = getSmoothedVelocityDirection(history, index);

    return impactSample;
  }

  return null;
}

/**
 * Returns a normalised velocity direction for the club head at `contactEndIndex` by
 * spanning back up to VELOCITY_SMOOTH_WINDOW_SAMPLES entries in history. A wider span
 * averages out per-frame noise that would otherwise corrupt the horizontal launch angle
 * at low FPS or slow gyro rates. Falls back to the adjacent pair if the wide span is
 * degenerate (e.g. only 2 samples exist).
 */
function getSmoothedVelocityDirection(history, contactEndIndex) {
  const endPosition = history[contactEndIndex].position;

  // Wide window: reach back as many samples as available up to VELOCITY_SMOOTH_WINDOW_SAMPLES.
  const lookbackIndex = Math.max(0, contactEndIndex - VELOCITY_SMOOTH_WINDOW_SAMPLES);
  if (lookbackIndex < contactEndIndex) {
    VELOCITY_DIRECTION.subVectors(endPosition, history[lookbackIndex].position);
    if (VELOCITY_DIRECTION.lengthSq() > 1e-10) {
      return VELOCITY_DIRECTION.clone().normalize();
    }
  }

  // Fallback: adjacent pair only.
  if (contactEndIndex >= 1) {
    VELOCITY_DIRECTION.subVectors(endPosition, history[contactEndIndex - 1].position);
    if (VELOCITY_DIRECTION.lengthSq() > 1e-10) {
      return VELOCITY_DIRECTION.clone().normalize();
    }
  }

  return null;
}


function buildImpactLaunchData(impactSample, activeClub, launchMetrics = null) {
  const resolvedLaunchMetrics = launchMetrics ?? getLaunchMetrics(impactSample, activeClub);
  const spinMetrics = getLaunchSpinMetrics(impactSample, activeClub, resolvedLaunchMetrics);

  return {
    ballSpeed: resolvedLaunchMetrics.ballSpeed,
    verticalLaunchAngle: resolvedLaunchMetrics.verticalLaunchAngle,
    horizontalLaunchAngle: resolvedLaunchMetrics.horizontalLaunchAngle,
    spinSpeed: spinMetrics.spinSpeed,
    spinAxis: spinMetrics.spinAxis,
  };
}

/**
 * Produces a compact club-and-impact-based spin estimate instead of a debug-only placeholder.
 */
function getLaunchSpinMetrics(impactSample, activeClub, launchMetrics) {
  const category = activeClub?.category ?? 'iron';
  if (category === 'putter') {
    return {
      spinSpeed: Math.max(0, impactSample.clubHeadSpeedMetersPerSecond * 12),
      spinAxis: 0,
    };
  }

  const loftDegrees = Number.isFinite(launchMetrics?.dynamicLoftDegrees)
    ? launchMetrics.dynamicLoftDegrees
    : launchMetrics?.baseLoftDegrees ?? BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  const baseLoftDegrees = Number.isFinite(launchMetrics?.baseLoftDegrees)
    ? launchMetrics.baseLoftDegrees
    : loftDegrees;
  const verticalLaunchAngleDegrees = Number.isFinite(launchMetrics?.verticalLaunchAngle)
    ? launchMetrics.verticalLaunchAngle
    : BALL_IMPACT_VERTICAL_LAUNCH_ANGLE;
  const spinLoftDegrees = Math.max(loftDegrees - verticalLaunchAngleDegrees, 0);
  const spinProfile = getClubSpinProfile(activeClub, category, baseLoftDegrees);
  const speedFactor = getSpinSpeedFactor(
    impactSample.clubHeadSpeedMetersPerSecond,
    spinProfile.referenceSpeedMetersPerSecond,
    getImpactMinSpeedMetersPerSecond(activeClub),
    spinProfile.minSpinFraction,
  );
  const spinLoftFactor = THREE.MathUtils.clamp(
    0.55 + (0.45 * (spinLoftDegrees / spinProfile.referenceSpinLoftDegrees)),
    0.45,
    1.25,
  );
  const loftRetentionFactor = THREE.MathUtils.clamp(
    0.8 + (0.2 * (loftDegrees / Math.max(baseLoftDegrees, 1e-6))),
    0.72,
    1.08,
  );

  return {
    spinSpeed: spinProfile.referenceSpinRpm * speedFactor * spinLoftFactor * loftRetentionFactor,
    spinAxis: THREE.MathUtils.clamp((launchMetrics?.horizontalLaunchAngle ?? 0) * 0.55, -18, 18),
  };
}

/**
 * Resolves the per-club spin baseline used for centered impacts at a representative speed.
 */
function getClubSpinProfile(activeClub, category, baseLoftDegrees) {
  const defaultReferenceSpeedMetersPerSecond = category === 'wood'
    ? 40
    : category === 'wedge'
      ? 24
      : 32;
  const defaultReferenceSpinRpm = Math.max(
    1800,
    (900 + (baseLoftDegrees * 120)) * (CLUB_CATEGORY_DEFAULT_SPIN_PROFILE[category] ?? 1),
  );

  return {
    referenceSpinRpm: Number.isFinite(activeClub?.spinProfile?.referenceSpinRpm)
      ? activeClub.spinProfile.referenceSpinRpm
      : defaultReferenceSpinRpm,
    referenceSpeedMetersPerSecond: Number.isFinite(activeClub?.spinProfile?.referenceSpeedMetersPerSecond)
      ? activeClub.spinProfile.referenceSpeedMetersPerSecond
      : defaultReferenceSpeedMetersPerSecond,
    minSpinFraction: Number.isFinite(activeClub?.spinProfile?.minSpinFraction)
      ? activeClub.spinProfile.minSpinFraction
      : 0.24,
    referenceSpinLoftDegrees: Number.isFinite(activeClub?.spinProfile?.referenceSpinLoftDegrees)
      ? activeClub.spinProfile.referenceSpinLoftDegrees
      : Math.max(4, baseLoftDegrees * 0.3),
  };
}

/**
 * Eases low-speed strikes toward a calibrated minimum spin instead of letting irons collapse unrealistically fast.
 */
function getSpinSpeedFactor(
  clubHeadSpeedMetersPerSecond,
  referenceSpeedMetersPerSecond,
  impactMinSpeedMetersPerSecond,
  minSpinFraction,
) {
  if (!Number.isFinite(clubHeadSpeedMetersPerSecond) || clubHeadSpeedMetersPerSecond <= 0) {
    return 0;
  }

  const clampedMinSpinFraction = THREE.MathUtils.clamp(minSpinFraction, 0.05, 0.75);
  const normalizedSpeedProgress = THREE.MathUtils.clamp(
    (clubHeadSpeedMetersPerSecond - impactMinSpeedMetersPerSecond)
      / Math.max(referenceSpeedMetersPerSecond - impactMinSpeedMetersPerSecond, 1e-6),
    0,
    1,
  );
  const easedSpeedProgress = Math.pow(normalizedSpeedProgress, 0.72);
  const baseSpeedFactor = THREE.MathUtils.lerp(clampedMinSpinFraction, 1, easedSpeedProgress);

  if (clubHeadSpeedMetersPerSecond <= referenceSpeedMetersPerSecond) {
    return baseSpeedFactor;
  }

  // Let overspeed strikes add spin, but slower than a straight linear ramp.
  const overspeedRatio = (clubHeadSpeedMetersPerSecond - referenceSpeedMetersPerSecond)
    / Math.max(referenceSpeedMetersPerSecond, 1e-6);
  return baseSpeedFactor * THREE.MathUtils.clamp(1 + (overspeedRatio * 0.55), 1, 1.35);
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

/**
 * Returns horizontal launch angle in degrees relative to the character's facing direction.
 * Uses club-head velocity direction (swing path) rather than face orientation so players
 * who yaw-rotate the phone still get the correct horizontal shot direction.
 */
function getHorizontalLaunchAngleDegrees(impactSample) {
  if (!impactSample.characterFacingForward || !impactSample.velocityDirection) {
    return 0;
  }
  HORIZONTAL_FACING_FORWARD.copy(impactSample.characterFacingForward);
  HORIZONTAL_FACING_FORWARD.y = 0;
  if (HORIZONTAL_FACING_FORWARD.lengthSq() <= 1e-8) {
    HORIZONTAL_FACING_FORWARD.set(0, 0, -1);
  } else {
    HORIZONTAL_FACING_FORWARD.normalize();
  }

  // Project the swing-path velocity onto the horizontal plane.
  VELOCITY_DIRECTION.copy(impactSample.velocityDirection);
  VELOCITY_DIRECTION.y = 0;
  if (VELOCITY_DIRECTION.lengthSq() <= 1e-8) {
    // Near-vertical swing — no meaningful horizontal direction; launch straight.
    return 0;
  }
  VELOCITY_DIRECTION.normalize();

  return THREE.MathUtils.clamp(
    -getSignedHorizontalAngleDegrees(
      HORIZONTAL_FACING_FORWARD,
      VELOCITY_DIRECTION,
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


function assignImpactDebugInfo(debugInfo, patch) {
  if (!debugInfo || !patch) {
    return;
  }

  Object.assign(debugInfo, patch);
}
