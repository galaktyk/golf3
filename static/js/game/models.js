import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCourseCollision } from '/static/js/game/collision.js';
import {
  BALL_RADIUS,
  CLUB_HEAD_COLLIDER_RADIUS,
  CLUB_HEAD_HISTORY_DURATION_SECONDS,
  CLUB_HEAD_HISTORY_MAX_SAMPLES,
  CLUB_HEAD_COLLIDER_TIP_BACKOFF,
  CLUB_HEAD_COLLIDER_SIDE_OFFSET,
  WORLD_FORWARD,
} from '/static/js/game/constants.js';
import { configureFlatShadedMaterials, configureUnlitMaterials } from '/static/js/game/materials.js';
import { createSwingMatcher } from '/static/js/game/swingMatcher.js';

const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_SHOW_SKELETON = DEBUG_PARAMS.get('debugSkeleton') === '1';
const DEBUG_SHOW_AXES = DEBUG_PARAMS.get('debugAxes') === '1';

export function loadViewerModels(viewerScene, onStatus) {
  const loader = new GLTFLoader();
  const clubAxesHelper = new THREE.AxesHelper(0.35);
  const ballBounds = new THREE.Box3();
  const ballSize = new THREE.Vector3();
  const ballCenter = new THREE.Vector3();
  clubAxesHelper.visible = DEBUG_SHOW_AXES;
  viewerScene.clubAxesHelper = clubAxesHelper;

  loader.load(
    '/assets/models/maps/blue_lagoon_1.glb',
    (gltf) => {
      configureUnlitMaterials(gltf.scene);
      viewerScene.mapRoot.add(gltf.scene);
      viewerScene.placeMapOriginAtTee();
      viewerScene.setMapBounds(new THREE.Box3().setFromObject(viewerScene.mapRoot));
      viewerScene.setCourseCollision(buildCourseCollision(viewerScene.mapRoot));
      viewerScene.positionLightsForMap();
      viewerScene.setInitialCameraPose();
      if (viewerScene.courseCollision?.triangleCount) {
        console.info(
          `[collision] Built static course BVH with ${viewerScene.courseCollision.triangleCount} triangles from ${viewerScene.courseCollision.meshCount} meshes.`,
        );
      } else {
        onStatus('Course model loaded, but no collision triangles were found.');
      }
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
      gltf.scene.updateMatrixWorld(true);
      ballBounds.setFromObject(gltf.scene);
      if (!ballBounds.isEmpty()) {
        ballBounds.getCenter(ballCenter);
        ballBounds.getSize(ballSize);
        const visualRadius = Math.max(ballSize.x, ballSize.y, ballSize.z) * 0.5;

        gltf.scene.position.sub(ballCenter);
        if (visualRadius > 1e-6) {
          gltf.scene.scale.multiplyScalar(BALL_RADIUS / visualRadius);
        }
      }

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
      gltf.scene.updateMatrixWorld(true);
      const clubBounds = new THREE.Box3().setFromObject(gltf.scene);
      const clubHeadCollider = createClubHeadColliderMesh(clubBounds);
      viewerScene.clubRoot.add(gltf.scene);
      viewerScene.clubRoot.add(clubHeadCollider);
      viewerScene.clubRoot.add(clubAxesHelper);
      viewerScene.setClubHeadCollider(clubHeadCollider);
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
  const swingMatcher = createSwingMatcher({ onStatus });
  const characterWorldQuaternion = new THREE.Quaternion();
  const inverseCharacterWorldQuaternion = new THREE.Quaternion();
  const clubSocketPosition = new THREE.Vector3();
  const clubHeadWorldPosition = new THREE.Vector3();
  const clubHeadWorldQuaternion = new THREE.Quaternion();
  const clubHeadPreviousWorldPosition = new THREE.Vector3();
  const lastClubHeadWorldPosition = new THREE.Vector3();
  const clubHeadWorldVelocity = new THREE.Vector3();
  const characterFacingForward = WORLD_FORWARD.clone();
  const worldClubQuaternion = new THREE.Quaternion();
  const liveSocketWorldQuaternion = new THREE.Quaternion();
  const animatedBoneWorldPosition = new THREE.Vector3();
  const skinnedMeshBoneWorldPosition = new THREE.Vector3();
  const socketAxesHelper = new THREE.AxesHelper(0.9);
  socketAxesHelper.visible = DEBUG_SHOW_AXES;
  let characterMixer = null;
  let characterAction = null;
  let characterAnimationClip = null;
  let characterSocketBone = null;
  let characterSceneRoot = null;
  let characterSkinnedMeshes = [];
  let skeletonHelper = null;
  let swingDurationSeconds = 0;
  let currentAnimationTimeSeconds = 0;
  let clubHeadSampleTimeSeconds = 0;
  let hasClubHeadSample = false;
  const clubHeadSampleHistory = [];

  const trimClubHeadSampleHistory = () => {
    while (clubHeadSampleHistory.length > CLUB_HEAD_HISTORY_MAX_SAMPLES) {
      clubHeadSampleHistory.shift();
    }

    while (
      clubHeadSampleHistory.length > 1
      && clubHeadSampleTimeSeconds - clubHeadSampleHistory[0].timeSeconds > CLUB_HEAD_HISTORY_DURATION_SECONDS
    ) {
      clubHeadSampleHistory.shift();
    }
  };

  const pushClubHeadSample = () => {
    clubHeadSampleHistory.push({
      timeSeconds: clubHeadSampleTimeSeconds,
      position: clubHeadWorldPosition.clone(),
      quaternion: clubHeadWorldQuaternion.clone(),
      characterFacingForward: characterFacingForward.clone(),
    });
    trimClubHeadSampleHistory();
  };

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
    swingMatcher.initialize({
      durationSeconds: swingDurationSeconds,
      clipName: characterAnimationClip.name,
      trackNames: characterAnimationClip.tracks.map((track) => track.name),
      sampleSocketQuaternionAtTime(sampleTime, targetQuaternion) {
        setCharacterAnimationTime(sampleTime);
        viewerScene.characterRoot.getWorldQuaternion(characterWorldQuaternion);
        inverseCharacterWorldQuaternion.copy(characterWorldQuaternion).invert();
        characterSocketBone.getWorldQuaternion(targetQuaternion);
        targetQuaternion.premultiply(inverseCharacterWorldQuaternion).normalize();
      },
    });
    characterAction.reset();
    characterAction.play();
    setCharacterAnimationTime(0);
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
      clubHeadSampleTimeSeconds += Math.max(deltaSeconds, 0);

      if (clubQuaternion) {
        viewerScene.characterRoot.getWorldQuaternion(characterWorldQuaternion);
        worldClubQuaternion.copy(characterWorldQuaternion).multiply(clubQuaternion).normalize();
      }

      const nextAnimationTimeSeconds = swingMatcher.update(
        deltaSeconds,
        clubQuaternion,
        currentAnimationTimeSeconds,
      );
      if (nextAnimationTimeSeconds !== currentAnimationTimeSeconds) {
        setCharacterAnimationTime(nextAnimationTimeSeconds);
      }

      if (clubQuaternion) {
        viewerScene.clubRoot.quaternion.copy(worldClubQuaternion);
      }

      if (!characterSocketBone) {
        hasClubHeadSample = false;
        clubHeadSampleHistory.length = 0;
        return;
      }

      viewerScene.characterRoot.updateMatrixWorld(true);
      characterSocketBone.getWorldPosition(clubSocketPosition);
      characterSocketBone.getWorldQuaternion(liveSocketWorldQuaternion);
      viewerScene.clubRoot.position.copy(clubSocketPosition);
      viewerScene.clubRoot.updateMatrixWorld(true);
      viewerScene.getCharacterForward(characterFacingForward);

      const clubHeadCollider = viewerScene.getClubHeadCollider();
      if (!clubHeadCollider) {
        clubHeadWorldVelocity.set(0, 0, 0);
        hasClubHeadSample = false;
        clubHeadSampleHistory.length = 0;
        return;
      }

      clubHeadCollider.getWorldPosition(clubHeadWorldPosition);
      clubHeadCollider.getWorldQuaternion(clubHeadWorldQuaternion);
      if (!hasClubHeadSample || deltaSeconds <= 1e-6) {
        clubHeadPreviousWorldPosition.copy(clubHeadWorldPosition);
        clubHeadWorldVelocity.set(0, 0, 0);
      } else {
        clubHeadPreviousWorldPosition.copy(lastClubHeadWorldPosition);
        clubHeadWorldVelocity.subVectors(clubHeadWorldPosition, lastClubHeadWorldPosition)
          .multiplyScalar(1 / deltaSeconds);
      }

      lastClubHeadWorldPosition.copy(clubHeadWorldPosition);
      hasClubHeadSample = true;
      pushClubHeadSample();
    },

    getDebugTelemetry() {
      return {
        boneQuaternion: liveSocketWorldQuaternion,
        clubHeadPreviousPosition: clubHeadPreviousWorldPosition,
        clubHeadPosition: clubHeadWorldPosition,
        clubHeadQuaternion: clubHeadWorldQuaternion,
        clubHeadSampleHistory,
        clubHeadVelocity: clubHeadWorldVelocity,
        clubHeadSpeedMetersPerSecond: clubHeadWorldVelocity.length(),
        characterFacingForward,
        currentAnimationTimeSeconds,
        hasClubHeadSample,
        ...swingMatcher.getDebugTelemetry(),
      };
    },
  };
}

function createClubHeadColliderMesh(clubBounds) {
  const collider = new THREE.Mesh(
    new THREE.SphereGeometry(CLUB_HEAD_COLLIDER_RADIUS, 16, 12),
    new THREE.MeshBasicMaterial({
      color: '#ec146e',
      transparent: true,
      opacity: 0.24,
      wireframe: true,
    }),
  );

  const tipY = clubBounds.isEmpty() ? 0 : clubBounds.max.y;
  collider.position.set(CLUB_HEAD_COLLIDER_SIDE_OFFSET, tipY - CLUB_HEAD_COLLIDER_TIP_BACKOFF, 0);
  return collider;
}
