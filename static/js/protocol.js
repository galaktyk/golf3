const INT16_MAX = 32767;

export const CONTROL_ACTIONS = Object.freeze({
  clubPrevious: 'club.previous',
  clubNext: 'club.next',
  rotateLeft: 'character.rotateLeft',
  rotateRight: 'character.rotateRight',
});

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

export function encodeControlMessage(action, active = true) {
  return JSON.stringify({
    type: 'control',
    action,
    active,
  });
}

export function decodeControlMessage(payload) {
  if (!payload || payload.type !== 'control' || typeof payload.action !== 'string') {
    return null;
  }

  return {
    type: payload.type,
    action: payload.action,
    active: payload.active !== false,
  };
}

function clampToInt16(value) {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * INT16_MAX);
}

function decodeInt16(value) {
  return Math.max(-1, Math.min(1, value / INT16_MAX));
}