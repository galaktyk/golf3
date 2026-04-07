import { formatQuaternion, formatVector3 } from '/static/js/game/formatting.js';

export function createViewerHud(dom) {
  return {
    initialize(cameraPosition, incomingQuaternion) {
      this.updateSocketState('Connecting');
      this.updateFps(0);
      this.updatePacketRate(0);
      this.updateQuaternion(incomingQuaternion);
      this.updateBoneQuaternion(incomingQuaternion);
      this.updateMatchFrame(0, 0, 0);
      this.updateCameraPosition(cameraPosition);
      this.updateBallState('ready', null, 0);
      this.updateShotStates('control', 'ready', null);
      this.updateLaunchPanelVisible(false);
    },

    setStatus(message) {
      dom.statusLabel.textContent = message;
    },

    updateSocketState(state) {
      dom.socketStateLabel.textContent = state;
    },

    updatePacketRate(value) {
      dom.packetRateLabel.textContent = `${value.toFixed(1)} pkt/s`;
    },

    updateFps(value) {
      dom.fpsLabel.textContent = `${value.toFixed(1)} fps`;
    },

    updateQuaternion(quaternion) {
      dom.quaternionLabel.textContent = formatQuaternion(quaternion);
    },

    updateBoneQuaternion(quaternion) {
      if (!dom.boneQuaternionLabel) {
        return;
      }

      dom.boneQuaternionLabel.textContent = formatQuaternion(quaternion);
    },

    updateMatchFrame(frameIndex, sampleCount, timeSeconds) {
      if (!dom.matchFrameLabel) {
        return;
      }

      dom.matchFrameLabel.textContent = `Frame ${frameIndex}/${Math.max(sampleCount - 1, 0)} @ ${timeSeconds.toFixed(3)}s`;
    },

    updateCameraPosition(position) {
      dom.cameraPositionLabel.textContent = formatVector3(position);
    },

    updateBallState(phase, movementState, speedMetersPerSecond) {
      if (!dom.ballStateLabel || !dom.ballSpeedLabel) {
        return;
      }

      dom.ballStateLabel.textContent = phase === 'moving' && movementState
        ? `moving/${movementState}`
        : phase;
      dom.ballSpeedLabel.textContent = `${speedMetersPerSecond.toFixed(2)} m/s`;
    },

    updateLaunchPanelVisible(visible) {
      if (!dom.launchPanel) {
        return;
      }

      dom.launchPanel.hidden = !visible;
    },

    updateShotStates(playerState, ballPhase, movementState) {
      if (!dom.playerStateLabel || !dom.ballPhaseLabel || !dom.ballMovementLabel) {
        return;
      }

      dom.playerStateLabel.textContent = playerState;
      dom.ballPhaseLabel.textContent = ballPhase;
      dom.ballMovementLabel.textContent = movementState ?? '-';
    },
  };
}