import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { configureFlatShadedMaterials, configureUnlitMaterials } from '/static/js/game/materials.js';

export function loadViewerModels(viewerScene, onStatus) {
  const loader = new GLTFLoader();

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
  let characterMixer = null;
  let characterAnimationClip = null;

  const startCharacterAnimationIfReady = () => {
    if (!characterAnimationClip || viewerScene.characterRoot.children.length === 0 || characterMixer) {
      return;
    }

    characterMixer = new THREE.AnimationMixer(viewerScene.characterRoot);
    const action = characterMixer.clipAction(characterAnimationClip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  };

  loader.load(
    '/assets/models/chara/nuri/nuri_base.glb',
    (gltf) => {
      configureUnlitMaterials(gltf.scene);
      viewerScene.characterRoot.add(gltf.scene);
      startCharacterAnimationIfReady();
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
      startCharacterAnimationIfReady();
    },
    undefined,
    (error) => {
      onStatus('Failed to load character animation.');
      console.error(error);
    },
  );

  return {
    update(deltaSeconds) {
      characterMixer?.update(deltaSeconds);
    },
  };
}