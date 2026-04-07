import { METERS_TO_YARDS } from '/static/js/game/constants.js';

export function formatQuaternion(quaternion) {
  const { x, y, z, w } = quaternion;
  return `(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}, ${w.toFixed(3)})`;
}

export function formatVector3(vector) {
  return `(${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)})`;
}

export function metersToYards(meters) {
  return meters * METERS_TO_YARDS;
}

export function formatDistanceYards(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return '-';
  }

  return `${Math.max(metersToYards(distanceMeters), 0).toFixed(1)} y`;
}

export function formatHeightDeltaMeters(deltaMeters) {
  if (!Number.isFinite(deltaMeters)) {
    return '-';
  }

  const normalizedDelta = Math.abs(deltaMeters) < 0.05 ? 0 : deltaMeters;
  const sign = normalizedDelta > 0 ? '+' : '';
  return `${sign}${normalizedDelta.toFixed(1)} M`;
}