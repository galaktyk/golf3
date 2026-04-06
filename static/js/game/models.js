import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCourseCollision } from '/static/js/game/collision.js';
import { BALL_RADIUS } from '/static/js/game/constants.js';
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
      viewerScene.positionClubAtTee();
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
  const swingMatcher = createSwingMatcher({ onStatus });
  const clubSocketPosition = new THREE.Vector3();
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
        characterSocketBone.getWorldQuaternion(targetQuaternion);
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
      const nextAnimationTimeSeconds = swingMatcher.update(
        deltaSeconds,
        clubQuaternion,
        currentAnimationTimeSeconds,
      );
      if (nextAnimationTimeSeconds !== currentAnimationTimeSeconds) {
        setCharacterAnimationTime(nextAnimationTimeSeconds);
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

    getDebugTelemetry() {
      return {
        boneQuaternion: liveSocketWorldQuaternion,
        currentAnimationTimeSeconds,
        ...swingMatcher.getDebugTelemetry(),
      };
    },
  };
}
