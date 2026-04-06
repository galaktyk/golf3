import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { configureFlatShadedMaterials, configureUnlitMaterials } from '/static/js/game/materials.js';

const SWING_LOOKUP_SAMPLE_RATE = 240;
const SWING_LOOKUP_RESAMPLED_COUNT = 180;
const SWING_MATCH_WINDOW_SECONDS = 0.2;
const SWING_MATCH_WINDOW_SAMPLES = 36;
const SWING_TIME_SMOOTHING = 14;
const SWING_SAMPLE_END_EPSILON = 1e-3;
const QUATERNION_MATCH_WEIGHT = 0;
const PRIMARY_AXIS_MATCH_WEIGHT = 0.85;
const SECONDARY_AXIS_MATCH_WEIGHT = 0.15;
const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_SWING_MODE = DEBUG_PARAMS.get('debugSwing');
const DEBUG_SWING_SWEEP_RATE = 0.35;
const SAMPLE_VARIATION_EPSILON = 1e-4;
const DEBUG_MATCH_LOG_INTERVAL_MS = 250;
const DEBUG_SHOW_SKELETON = DEBUG_PARAMS.get('debugSkeleton') === '1';
const DEBUG_SHOW_AXES = DEBUG_PARAMS.get('debugAxes') === '1';
const INITIAL_SOCKET_AXIS_NAME = normalizeAxisParam(DEBUG_PARAMS.get('socketAxis'), 'x');
const INITIAL_SOCKET_REF_AXIS_NAME = normalizeAxisParam(DEBUG_PARAMS.get('socketRefAxis'), 'y');

export function loadViewerModels(viewerScene, onStatus) {
  const loader = new GLTFLoader();
  const clubAxesHelper = new THREE.AxesHelper(0.35);
  clubAxesHelper.visible = DEBUG_SHOW_AXES;
  viewerScene.clubAxesHelper = clubAxesHelper;

  loader.load(
    '/assets/models/maps/blue_lagoon_1.glb',
    (gltf) => {
      configureUnlitMaterials(gltf.scene);
      viewerScene.mapRoot.add(gltf.scene);
      viewerScene.placeMapOriginAtTee();
      viewerScene.setMapBounds(new THREE.Box3().setFromObject(viewerScene.mapRoot));
      viewerScene.positionClubAtTee();
      viewerScene.positionLightsForMap();
      viewerScene.setInitialCameraPose();
    },
    undefined,
    (error) => {
      onStatus('Failed to load course model.');
      console.error(error);
    },
  );

  loader.load(
    '/assets/models/high_ball_low.glb',
    (gltf) => {
      configureFlatShadedMaterials(gltf.scene);
      viewerScene.positionBallAtStart();
      viewerScene.ballRoot.add(gltf.scene);
    },
    undefined,
    (error) => {
      onStatus('Failed to load ball model.');
      console.error(error);
    },
  );

  loader.load(
    '/assets/models/golf_club.glb',
    (gltf) => {
      configureUnlitMaterials(gltf.scene);
      viewerScene.clubRoot.add(gltf.scene);
      viewerScene.clubRoot.add(clubAxesHelper);
      viewerScene.positionClubAtTee();
      viewerScene.setInitialCameraPose();
    },
    undefined,
    (error) => {
      onStatus('Failed to load golf club model.');
      console.error(error);
    },
  );
}

export function loadCharacter(viewerScene, onStatus) {
  const loader = new GLTFLoader();
  const clubSocketPosition = new THREE.Vector3();
  const socketWorldQuaternion = new THREE.Quaternion();
  const liveSocketWorldQuaternion = new THREE.Quaternion();
  const mappedImuQuaternion = new THREE.Quaternion();
  const referencePrimaryAxis = new THREE.Vector3();
  const referenceSecondaryAxis = new THREE.Vector3();
  const socketShaftAxisLocal = parseAxisParam(INITIAL_SOCKET_AXIS_NAME, new THREE.Vector3(1, 0, 0));
  const socketReferenceAxisLocal = parseAxisParam(INITIAL_SOCKET_REF_AXIS_NAME, new THREE.Vector3(0, 1, 0));
  const imuAlignmentOffset = new THREE.Quaternion();
  const inverseImuQuaternion = new THREE.Quaternion();
  const initialSocketQuaternion = new THREE.Quaternion();
  const animatedBoneWorldPosition = new THREE.Vector3();
  const skinnedMeshBoneWorldPosition = new THREE.Vector3();
  const socketAxesHelper = new THREE.AxesHelper(0.2);
  socketAxesHelper.visible = DEBUG_SHOW_AXES;
  let characterMixer = null;
  let characterAction = null;
  let characterAnimationClip = null;
  let characterSocketBone = null;
  let characterSceneRoot = null;
  let characterSkinnedMeshes = [];
  let skeletonHelper = null;
  let swingSamples = [];
  let swingDurationSeconds = 0;
  let currentAnimationTimeSeconds = 0;
  let targetAnimationTimeSeconds = 0;
  let currentMatchFrameIndex = 0;
  let hasPoseMatch = false;
  let hasImuAlignment = false;
  let hasLoggedFrozenSamples = false;
  let lastMatchDebugLogTime = 0;
  let socketAxisName = INITIAL_SOCKET_AXIS_NAME;
  let socketRefAxisName = INITIAL_SOCKET_REF_AXIS_NAME;
  let showAxes = DEBUG_SHOW_AXES;

  const initializeCharacterControllerIfReady = () => {
    if (!characterAnimationClip || !characterSocketBone || characterMixer) {
      return;
    }

    characterMixer = new THREE.AnimationMixer(viewerScene.characterRoot);
    characterAction = characterMixer.clipAction(characterAnimationClip);
    characterAction.clampWhenFinished = false;
    characterAction.setLoop(THREE.LoopRepeat, Infinity);
    characterAction.enabled = true;
    characterAction.setEffectiveWeight(1);
    characterAction.setEffectiveTimeScale(1);
    characterAction.play();
    swingDurationSeconds = characterAnimationClip.duration;
    swingSamples = buildSwingSamples();
    characterAction.reset();
    characterAction.play();
    setCharacterAnimationTime(0);
    logSwingDiagnostics();
  };

  const buildSwingSamples = () => {
    const denseSamples = [];
    const sampleCount = Math.max(2, Math.ceil(swingDurationSeconds * SWING_LOOKUP_SAMPLE_RATE) + 1);
    const sampleDurationSeconds = Math.max(0, swingDurationSeconds - SWING_SAMPLE_END_EPSILON);
    const sampleStepSeconds = sampleDurationSeconds / (sampleCount - 1);

    for (let index = 0; index < sampleCount; index += 1) {
      const sampleTime = sampleStepSeconds * index;
      setCharacterAnimationTime(sampleTime);
      characterSocketBone.getWorldQuaternion(socketWorldQuaternion);
      denseSamples.push({
        index,
        time: sampleTime,
        quaternion: socketWorldQuaternion.clone(),
        primaryAxis: socketShaftAxisLocal.clone().applyQuaternion(socketWorldQuaternion),
        secondaryAxis: socketReferenceAxisLocal.clone().applyQuaternion(socketWorldQuaternion),
      });
    }

    return resampleSwingSamplesByPoseDistance(denseSamples);
  };

  const resampleSwingSamplesByPoseDistance = (denseSamples) => {
    if (denseSamples.length <= 2) {
      return denseSamples;
    }

    const cumulativeDistances = [0];
    for (let index = 1; index < denseSamples.length; index += 1) {
      const previousSample = denseSamples[index - 1];
      const currentSample = denseSamples[index];
      cumulativeDistances.push(
        cumulativeDistances[index - 1] + getPoseDistance(previousSample, currentSample),
      );
    }

    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
    if (totalDistance <= 0) {
      return denseSamples;
    }

    const lookupSamples = [];
    const lookupCount = Math.max(2, SWING_LOOKUP_RESAMPLED_COUNT);
    let denseIndex = 1;

    for (let lookupIndex = 0; lookupIndex < lookupCount; lookupIndex += 1) {
      const targetDistance = totalDistance * (lookupIndex / (lookupCount - 1));
      while (denseIndex < cumulativeDistances.length - 1 && cumulativeDistances[denseIndex] < targetDistance) {
        denseIndex += 1;
      }

      const previousIndex = Math.max(0, denseIndex - 1);
      const nextIndex = denseIndex;
      const distanceStart = cumulativeDistances[previousIndex];
      const distanceEnd = cumulativeDistances[nextIndex];
      const distanceSpan = Math.max(distanceEnd - distanceStart, Number.EPSILON);
      const interpolationAlpha = THREE.MathUtils.clamp(
        (targetDistance - distanceStart) / distanceSpan,
        0,
        1,
      );

      const previousSample = denseSamples[previousIndex];
      const nextSample = denseSamples[nextIndex];
      const interpolatedQuaternion = new THREE.Quaternion().slerpQuaternions(
        previousSample.quaternion,
        nextSample.quaternion,
        interpolationAlpha,
      );

      lookupSamples.push({
        index: lookupIndex,
        time: THREE.MathUtils.lerp(previousSample.time, nextSample.time, interpolationAlpha),
        quaternion: interpolatedQuaternion,
        primaryAxis: socketShaftAxisLocal.clone().applyQuaternion(interpolatedQuaternion),
        secondaryAxis: socketReferenceAxisLocal.clone().applyQuaternion(interpolatedQuaternion),
      });
    }

    return lookupSamples;
  };

  const getPoseDistance = (previousSample, currentSample) => {
    const quaternionDistance = 1 - Math.abs(previousSample.quaternion.dot(currentSample.quaternion));
    const primaryDistance = 1 - previousSample.primaryAxis.dot(currentSample.primaryAxis);
    const secondaryDistance = 1 - previousSample.secondaryAxis.dot(currentSample.secondaryAxis);
    return (quaternionDistance * Math.max(QUATERNION_MATCH_WEIGHT, 0.1))
      + (primaryDistance * PRIMARY_AXIS_MATCH_WEIGHT)
      + (secondaryDistance * SECONDARY_AXIS_MATCH_WEIGHT);
  };

  const logSwingDiagnostics = () => {
    if (!characterAnimationClip || !characterSocketBone || swingSamples.length === 0) {
      return;
    }

    const firstQuaternion = swingSamples[0].quaternion;
    const hasSampleVariation = swingSamples.some((sample) => (
      1 - Math.abs(firstQuaternion.dot(sample.quaternion)) > SAMPLE_VARIATION_EPSILON
    ));
    const trackNames = characterAnimationClip.tracks.map((track) => track.name);

    console.groupCollapsed('[swing-debug] character animation diagnostics');
    console.log('clip name:', characterAnimationClip.name || '(unnamed)');
    console.log('duration:', swingDurationSeconds);
    console.log('track count:', trackNames.length);
    console.log('sample count:', swingSamples.length);
    console.log('lookup sample rate:', SWING_LOOKUP_SAMPLE_RATE);
    console.log('lookup resampled count:', SWING_LOOKUP_RESAMPLED_COUNT);
    console.log('Bone01 sampled variation:', hasSampleVariation);
    console.log('first track names:', trackNames.slice(0, 12));
    console.log('socketAxis:', socketAxisName, socketShaftAxisLocal.toArray());
    console.log('socketRefAxis:', socketRefAxisName, socketReferenceAxisLocal.toArray());
    console.groupEnd();

    if (!hasSampleVariation && !hasLoggedFrozenSamples) {
      hasLoggedFrozenSamples = true;
      onStatus('Swing clip loaded, but Bone01 does not change across sampled frames. Check browser console.');
      console.warn('[swing-debug] Bone01 stayed effectively unchanged across sampled frames. The clip may not be bound to this rig, or Bone01 may not be animated in the source clip.');
    }
  };

  const logCharacterMeshDiagnostics = () => {
    if (!characterSceneRoot) {
      return;
    }

    const meshes = [];
    characterSceneRoot.traverse((node) => {
      if (node.isSkinnedMesh) {
        meshes.push({
          name: node.name || '(unnamed skinned mesh)',
          materialType: Array.isArray(node.material)
            ? node.material.map((material) => material.type)
            : [node.material?.type ?? '(missing material)'],
          boneCount: node.skeleton?.bones?.length ?? 0,
          hasBone01: Boolean(node.skeleton?.getBoneByName('Bone01')),
        });
      }
    });

    console.groupCollapsed('[swing-debug] character mesh diagnostics');
    console.log('skinned mesh count:', meshes.length);
    console.table(meshes);
    console.groupEnd();

    if (meshes.length === 0) {
      onStatus('Character scene has no SkinnedMesh nodes. Check browser console.');
      console.warn('[swing-debug] No SkinnedMesh nodes were found under the loaded character scene.');
    }
  };

  const logBoneBindingDiagnostics = () => {
    if (characterSkinnedMeshes.length === 0 || !characterSocketBone) {
      return;
    }

    characterSocketBone.getWorldPosition(animatedBoneWorldPosition);
    const firstSkinnedMeshBone = characterSkinnedMeshes[0].skeleton?.getBoneByName('Bone01');
    firstSkinnedMeshBone?.getWorldPosition(skinnedMeshBoneWorldPosition);

    console.groupCollapsed('[swing-debug] bone binding diagnostics');
    console.log('controller Bone01 position:', animatedBoneWorldPosition.toArray());
    console.log('skinned mesh Bone01 position:', firstSkinnedMeshBone ? skinnedMeshBoneWorldPosition.toArray() : '(missing Bone01 in skeleton)');
    console.log('same bone instance:', firstSkinnedMeshBone === characterSocketBone);
    console.groupEnd();
  };

  const setCharacterAnimationTime = (nextTimeSeconds) => {
    if (!characterMixer || !characterAction) {
      return;
    }

    currentAnimationTimeSeconds = THREE.MathUtils.clamp(nextTimeSeconds, 0, swingDurationSeconds);
    characterAction.time = currentAnimationTimeSeconds;
    characterMixer.setTime(currentAnimationTimeSeconds);
    viewerScene.characterRoot.updateMatrixWorld(true);
  };

  const refreshSwingSampleAxes = () => {
    for (const sample of swingSamples) {
      sample.primaryAxis.copy(socketShaftAxisLocal).applyQuaternion(sample.quaternion);
      sample.secondaryAxis.copy(socketReferenceAxisLocal).applyQuaternion(sample.quaternion);
    }
  };

  const alignImuToSwing = (imuQuaternion) => {
    if (hasImuAlignment || swingSamples.length === 0) {
      return;
    }

    initialSocketQuaternion.copy(swingSamples[0].quaternion);
    inverseImuQuaternion.copy(imuQuaternion).invert();
    imuAlignmentOffset.copy(initialSocketQuaternion).multiply(inverseImuQuaternion).normalize();
    hasImuAlignment = true;
  };

  const findTargetAnimationTime = (referenceQuaternion) => {
    if (swingSamples.length === 0) {
      return 0;
    }

    referencePrimaryAxis.copy(socketShaftAxisLocal).applyQuaternion(referenceQuaternion);
    referenceSecondaryAxis.copy(socketReferenceAxisLocal).applyQuaternion(referenceQuaternion);

    const shouldSearchWholeClip = !hasPoseMatch;
    const windowStartIndex = Math.max(0, currentMatchFrameIndex - SWING_MATCH_WINDOW_SAMPLES);
    const windowEndIndex = Math.min(swingSamples.length - 1, currentMatchFrameIndex + SWING_MATCH_WINDOW_SAMPLES);

    let bestSample = null;
    let bestScore = -Infinity;

    for (const sample of swingSamples) {
      if (!shouldSearchWholeClip && (sample.index < windowStartIndex || sample.index > windowEndIndex)) {
        continue;
      }

      const quaternionScore = Math.abs(referenceQuaternion.dot(sample.quaternion));
      const primaryScore = referencePrimaryAxis.dot(sample.primaryAxis);
      const secondaryScore = referenceSecondaryAxis.dot(sample.secondaryAxis);
      const score = (quaternionScore * QUATERNION_MATCH_WEIGHT)
        + (primaryScore * PRIMARY_AXIS_MATCH_WEIGHT)
        + (secondaryScore * SECONDARY_AXIS_MATCH_WEIGHT);
      if (score > bestScore) {
        bestScore = score;
        bestSample = sample;
      }
    }

    if (!bestSample) {
      for (const sample of swingSamples) {
        const quaternionScore = Math.abs(referenceQuaternion.dot(sample.quaternion));
        const primaryScore = referencePrimaryAxis.dot(sample.primaryAxis);
        const secondaryScore = referenceSecondaryAxis.dot(sample.secondaryAxis);
        const score = (quaternionScore * QUATERNION_MATCH_WEIGHT)
          + (primaryScore * PRIMARY_AXIS_MATCH_WEIGHT)
          + (secondaryScore * SECONDARY_AXIS_MATCH_WEIGHT);
        if (score > bestScore) {
          bestScore = score;
          bestSample = sample;
        }
      }
    }

    hasPoseMatch = true;
    currentMatchFrameIndex = bestSample?.index ?? 0;
    return bestSample?.time ?? 0;
  };

  const logMatchDiagnostics = () => {
    if (DEBUG_SWING_MODE !== 'match') {
      return;
    }

    const now = performance.now();
    if (now - lastMatchDebugLogTime < DEBUG_MATCH_LOG_INTERVAL_MS) {
      return;
    }

    lastMatchDebugLogTime = now;
    console.log('[swing-debug] match', {
      currentAnimationTimeSeconds: Number(currentAnimationTimeSeconds.toFixed(3)),
      targetAnimationTimeSeconds: Number(targetAnimationTimeSeconds.toFixed(3)),
      hasImuAlignment,
      hasPoseMatch,
    });
  };

  loader.load(
    '/assets/models/chara/nuri/nuri_base.glb',
    (gltf) => {
      configureUnlitMaterials(gltf.scene);
      characterSceneRoot = gltf.scene;
      viewerScene.characterRoot.add(gltf.scene);
      characterSkinnedMeshes = [];
      gltf.scene.traverse((node) => {
        if (node.isSkinnedMesh) {
          characterSkinnedMeshes.push(node);
        }
      });
      characterSocketBone = gltf.scene.getObjectByName('Bone01');
      if (!characterSocketBone) {
        onStatus('Character loaded, but Bone01 socket was not found.');
      }
      if (socketAxesHelper && characterSocketBone) {
        characterSocketBone.add(socketAxesHelper);
      }
      if (DEBUG_SHOW_SKELETON) {
        skeletonHelper = new THREE.SkeletonHelper(gltf.scene);
        viewerScene.scene.add(skeletonHelper);
      }
      logCharacterMeshDiagnostics();
      initializeCharacterControllerIfReady();
      logBoneBindingDiagnostics();
    },
    undefined,
    (error) => {
      onStatus('Failed to load character model.');
      console.error(error);
    },
  );

  loader.load(
    '/assets/models/chara/nuri/nuri_swing.glb',
    (gltf) => {
      characterAnimationClip = gltf.animations[0] ?? null;
      initializeCharacterControllerIfReady();
    },
    undefined,
    (error) => {
      onStatus('Failed to load character animation.');
      console.error(error);
    },
  );

  return {
    update(deltaSeconds, clubQuaternion) {
      if (DEBUG_SWING_MODE === 'sweep' && swingDurationSeconds > 0) {
        const sweepTimeSeconds = ((performance.now() / 1000) * DEBUG_SWING_SWEEP_RATE) % swingDurationSeconds;
        setCharacterAnimationTime(sweepTimeSeconds);
      } else if (clubQuaternion) {
        alignImuToSwing(clubQuaternion);
        if (hasImuAlignment) {
          mappedImuQuaternion.copy(imuAlignmentOffset).multiply(clubQuaternion).normalize();
          targetAnimationTimeSeconds = findTargetAnimationTime(mappedImuQuaternion);
          const smoothedAnimationTime = THREE.MathUtils.damp(
            currentAnimationTimeSeconds,
            targetAnimationTimeSeconds,
            SWING_TIME_SMOOTHING,
            deltaSeconds,
          );
          setCharacterAnimationTime(smoothedAnimationTime);
          logMatchDiagnostics();
        }
      }

      if (clubQuaternion) {
        viewerScene.clubRoot.quaternion.copy(clubQuaternion);
      }

      if (!characterSocketBone) {
        return;
      }

      viewerScene.characterRoot.updateMatrixWorld(true);
      characterSocketBone.getWorldPosition(clubSocketPosition);
      characterSocketBone.getWorldQuaternion(liveSocketWorldQuaternion);
      viewerScene.clubRoot.position.copy(clubSocketPosition);
    },

    setSocketAxes(nextSocketAxisName, nextSocketRefAxisName) {
      socketAxisName = normalizeAxisParam(nextSocketAxisName, socketAxisName);
      socketRefAxisName = normalizeAxisParam(nextSocketRefAxisName, socketRefAxisName);
      socketShaftAxisLocal.copy(parseAxisParam(socketAxisName, socketShaftAxisLocal));
      socketReferenceAxisLocal.copy(parseAxisParam(socketRefAxisName, socketReferenceAxisLocal));
      refreshSwingSampleAxes();
      hasPoseMatch = false;
      console.log('[swing-debug] updated socket axes', {
        socketAxisName,
        socketRefAxisName,
      });
    },

    setDebugAxesVisible(isVisible) {
      showAxes = Boolean(isVisible);
      if (viewerScene.clubAxesHelper) {
        viewerScene.clubAxesHelper.visible = showAxes;
      }
      socketAxesHelper.visible = showAxes;
    },

    getDebugConfig() {
      return {
        socketAxis: socketAxisName,
        socketRefAxis: socketRefAxisName,
        showAxes,
      };
    },

    getDebugTelemetry() {
      return {
        boneQuaternion: liveSocketWorldQuaternion,
        currentAnimationTimeSeconds,
        targetAnimationTimeSeconds,
        currentMatchFrameIndex,
        sampleCount: swingSamples.length,
      };
    },
  };
}

function parseAxisParam(axisName, fallbackAxis) {
  switch ((axisName ?? '').toLowerCase()) {
    case 'x':
      return new THREE.Vector3(1, 0, 0);
    case '-x':
      return new THREE.Vector3(-1, 0, 0);
    case 'y':
      return new THREE.Vector3(0, 1, 0);
    case '-y':
      return new THREE.Vector3(0, -1, 0);
    case 'z':
      return new THREE.Vector3(0, 0, 1);
    case '-z':
      return new THREE.Vector3(0, 0, -1);
    default:
      return fallbackAxis.clone();
  }
}

function normalizeAxisParam(axisName, fallbackAxisName) {
  switch ((axisName ?? '').toLowerCase()) {
    case 'x':
    case '-x':
    case 'y':
    case '-y':
    case 'z':
    case '-z':
      return axisName.toLowerCase();
    default:
      return fallbackAxisName;
  }
}