const INT16_MAX = 32767;

export function encodeQuaternionToPacket(quaternion) {
  const normalized = quaternion.clone().normalize();
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);

  view.setInt16(0, clampToInt16(normalized.x), true);
  view.setInt16(2, clampToInt16(normalized.y), true);
  view.setInt16(4, clampToInt16(normalized.z), true);
  view.setInt16(6, clampToInt16(normalized.w), true);

  return buffer;
}

export function decodeQuaternionPacket(buffer, targetQuaternion) {
  const view = new DataView(buffer);

  targetQuaternion.set(
    decodeInt16(view.getInt16(0, true)),
    decodeInt16(view.getInt16(2, true)),
    decodeInt16(view.getInt16(4, true)),
    decodeInt16(view.getInt16(6, true)),
  );

  return targetQuaternion.normalize();
}

function clampToInt16(value) {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * INT16_MAX);
}

function decodeInt16(value) {
  return Math.max(-1, Math.min(1, value / INT16_MAX));
}