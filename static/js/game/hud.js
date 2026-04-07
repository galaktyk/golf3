import {
  formatDegrees,
  formatMeters,
  formatMetersPerSecond,
  formatQuaternion,
  formatScalar,
  formatVector3,
} from '/static/js/game/formatting.js';

function formatGroundTransitionDebug(transitionDebug) {
  if (!transitionDebug?.captureAttempted) {
    return '-';
  }

  const stateLabel = transitionDebug.snappedToGround
    ? transitionDebug.movementState ?? 'ground'
    : 'capture-missed';

  return `pre ${transitionDebug.preImpactSpeedMetersPerSecond.toFixed(2)} | `
    + `post ${transitionDebug.postImpactSpeedMetersPerSecond.toFixed(2)} | `
    + `snap ${transitionDebug.postSnapSpeedMetersPerSecond.toFixed(2)} | `
    + `loss ${transitionDebug.snapLossMetersPerSecond.toFixed(2)} | `
    + stateLabel;
}

function formatGroundTransitionNormals(transitionDebug) {
  if (!transitionDebug?.captureAttempted || !transitionDebug.impactNormal) {
    return '-';
  }

  const impactLabel = `impact ${formatVector3(transitionDebug.impactNormal)}`;
  if (!transitionDebug.supportNormal) {
    return impactLabel;
  }

  return `${impactLabel} | support ${formatVector3(transitionDebug.supportNormal)}`;
}

function formatGroundTransitionComponents(transitionDebug) {
  if (!transitionDebug?.captureAttempted) {
    return '-';
  }

  return `n ${transitionDebug.preImpactNormalSpeedMetersPerSecond.toFixed(2)} -> ${transitionDebug.postImpactNormalSpeedMetersPerSecond.toFixed(2)} | `
    + `t ${transitionDebug.preImpactTangentSpeedMetersPerSecond.toFixed(2)} -> ${transitionDebug.postImpactTangentSpeedMetersPerSecond.toFixed(2)}`;
}

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
      this.updateGroundTransitionDebug(null);
      this.updateShotStates('control', 'ready', null);
      this.updateClubDebug(null, null);
      this.updateLaunchPreview(null);
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

    updateGroundTransitionDebug(transitionDebug) {
      if (!dom.ballLandingDebugLabel || !dom.ballLandingComponentsLabel || !dom.ballLandingNormalsLabel) {
        return;
      }

      dom.ballLandingDebugLabel.textContent = formatGroundTransitionDebug(transitionDebug);
      dom.ballLandingComponentsLabel.textContent = formatGroundTransitionComponents(transitionDebug);
      dom.ballLandingNormalsLabel.textContent = formatGroundTransitionNormals(transitionDebug);
    },

    updateClubDebug(clubSet, club) {
      if (
        !dom.clubSetLineLabel
        || !dom.clubIdLabel
        || !dom.clubLoftLabel
        || !dom.clubLaunchFactorLabel
        || !dom.clubOrientationLoftInfluenceLabel
        || !dom.clubMaxDynamicLoftDeltaLabel
        || !dom.clubEffectiveLengthLabel
        || !dom.clubSmashFactorLabel
      ) {
        return;
      }

      if (!clubSet || !club) {
        dom.clubSetLineLabel.textContent = '-';
        dom.clubIdLabel.textContent = '-';
        dom.clubLoftLabel.textContent = '-';
        dom.clubLaunchFactorLabel.textContent = '-';
        dom.clubOrientationLoftInfluenceLabel.textContent = '-';
        dom.clubMaxDynamicLoftDeltaLabel.textContent = '-';
        dom.clubEffectiveLengthLabel.textContent = '-';
        dom.clubSmashFactorLabel.textContent = '-';
        return;
      }

      dom.clubSetLineLabel.textContent = clubSet.name;
      dom.clubIdLabel.textContent = club.id;
      dom.clubLoftLabel.textContent = formatDegrees(club.loftDegrees);
      dom.clubLaunchFactorLabel.textContent = formatScalar(club.launchFactor);
      dom.clubOrientationLoftInfluenceLabel.textContent = formatScalar(club.orientationLoftInfluence);
      dom.clubMaxDynamicLoftDeltaLabel.textContent = formatDegrees(club.maxDynamicLoftDeltaDegrees);
      dom.clubEffectiveLengthLabel.textContent = formatMeters(club.effectiveLengthMeters);
      dom.clubSmashFactorLabel.textContent = formatScalar(club.smashFactor);
    },

    updateLaunchPreview(preview) {
      if (
        !dom.launchPreviewMessage
        || !dom.previewClubSpeedLabel
        || !dom.previewBallSpeedLabel
        || !dom.previewHorizontalLaunchAngleLabel
        || !dom.previewFacePitchLabel
        || !dom.previewDynamicLoftLabel
        || !dom.previewLaunchAngleLabel
      ) {
        return;
      }

      if (!preview) {
        dom.launchPreviewMessage.textContent = 'Updates when a shot launches.';
        dom.previewClubSpeedLabel.textContent = '-';
        dom.previewBallSpeedLabel.textContent = '-';
        dom.previewHorizontalLaunchAngleLabel.textContent = '-';
        dom.previewFacePitchLabel.textContent = '-';
        dom.previewDynamicLoftLabel.textContent = '-';
        dom.previewLaunchAngleLabel.textContent = '-';
        return;
      }

      dom.launchPreviewMessage.textContent = 'Captured at launch from phone motion and club face impact.';
      dom.previewClubSpeedLabel.textContent = formatMetersPerSecond(preview.clubHeadSpeedMetersPerSecond);
      dom.previewBallSpeedLabel.textContent = formatMetersPerSecond(preview.ballSpeed);
      dom.previewHorizontalLaunchAngleLabel.textContent = formatDegrees(preview.horizontalLaunchAngle);
      dom.previewFacePitchLabel.textContent = formatDegrees(preview.measuredFacePitchDegrees);
      dom.previewDynamicLoftLabel.textContent = formatDegrees(preview.dynamicLoftDegrees);
      dom.previewLaunchAngleLabel.textContent = formatDegrees(preview.verticalLaunchAngle);
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