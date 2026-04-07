import * as THREE from 'three';
import {
  CLUB_HEAD_VELOCITY_FIT_MIN_SAMPLES,
  CLUB_HEAD_VELOCITY_FIT_WINDOW_SECONDS,
} from '/static/js/game/constants.js';

const INTERPOLATED_POSITION = new THREE.Vector3();
const INTERPOLATED_QUATERNION = new THREE.Quaternion();
const INTERPOLATED_FACING_FORWARD = new THREE.Vector3();
const REGRESSION_OFFSET = new THREE.Vector3();
const REGRESSION_VELOCITY = new THREE.Vector3();

export function interpolateClubHeadSample(startSample, endSample, alpha) {
  const clampedAlpha = THREE.MathUtils.clamp(alpha, 0, 1);

  INTERPOLATED_POSITION.lerpVectors(startSample.position, endSample.position, clampedAlpha);
  INTERPOLATED_QUATERNION.slerpQuaternions(startSample.quaternion, endSample.quaternion, clampedAlpha).normalize();
  INTERPOLATED_FACING_FORWARD.lerpVectors(
    startSample.characterFacingForward,
    endSample.characterFacingForward,
    clampedAlpha,
  );
  INTERPOLATED_FACING_FORWARD.y = 0;

  if (INTERPOLATED_FACING_FORWARD.lengthSq() <= 1e-8) {
    INTERPOLATED_FACING_FORWARD.copy(startSample.characterFacingForward);
    INTERPOLATED_FACING_FORWARD.y = 0;
  }

  if (INTERPOLATED_FACING_FORWARD.lengthSq() <= 1e-8) {
    INTERPOLATED_FACING_FORWARD.set(0, 0, -1);
  } else {
    INTERPOLATED_FACING_FORWARD.normalize();
  }

  return {
    timeSeconds: THREE.MathUtils.lerp(startSample.timeSeconds, endSample.timeSeconds, clampedAlpha),
    position: INTERPOLATED_POSITION.clone(),
    quaternion: INTERPOLATED_QUATERNION.clone(),
    characterFacingForward: INTERPOLATED_FACING_FORWARD.clone(),
  };
}

export function estimateVelocityAtSample(history, contactSample) {
  const halfWindowSeconds = CLUB_HEAD_VELOCITY_FIT_WINDOW_SECONDS * 0.5;
  let selectedSamples = history.filter((sample) => (
    Math.abs(sample.timeSeconds - contactSample.timeSeconds) <= halfWindowSeconds
  ));

  if (selectedSamples.length < CLUB_HEAD_VELOCITY_FIT_MIN_SAMPLES) {
    selectedSamples = [...history]
      .sort((leftSample, rightSample) => (
        Math.abs(leftSample.timeSeconds - contactSample.timeSeconds)
        - Math.abs(rightSample.timeSeconds - contactSample.timeSeconds)
      ))
      .slice(0, CLUB_HEAD_VELOCITY_FIT_MIN_SAMPLES);
  }

  REGRESSION_VELOCITY.set(0, 0, 0);
  let denominator = 0;

  for (const sample of selectedSamples) {
    const deltaTimeSeconds = sample.timeSeconds - contactSample.timeSeconds;
    if (Math.abs(deltaTimeSeconds) <= 1e-6) {
      continue;
    }

    REGRESSION_OFFSET.subVectors(sample.position, contactSample.position);
    REGRESSION_VELOCITY.addScaledVector(REGRESSION_OFFSET, deltaTimeSeconds);
    denominator += deltaTimeSeconds * deltaTimeSeconds;
  }

  if (denominator > 1e-8) {
    return REGRESSION_VELOCITY.clone().multiplyScalar(1 / denominator);
  }

  return estimateSegmentVelocity(history, contactSample.timeSeconds);
}

function estimateSegmentVelocity(history, targetTimeSeconds) {
  if (history.length < 2) {
    return new THREE.Vector3();
  }

  let startSample = history[0];
  let endSample = history[1];

  if (targetTimeSeconds >= history[history.length - 1].timeSeconds) {
    startSample = history[history.length - 2];
    endSample = history[history.length - 1];
  } else {
    for (let index = 1; index < history.length; index += 1) {
      if (history[index].timeSeconds >= targetTimeSeconds) {
        startSample = history[index - 1];
        endSample = history[index];
        break;
      }
    }
  }

  const deltaTimeSeconds = endSample.timeSeconds - startSample.timeSeconds;
  if (deltaTimeSeconds <= 1e-6) {
    return new THREE.Vector3();
  }

  return endSample.position.clone().sub(startSample.position).multiplyScalar(1 / deltaTimeSeconds);
}
