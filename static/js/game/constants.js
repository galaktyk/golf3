import * as THREE from 'three';

export const MAP_TEE_ORIGIN = new THREE.Vector3(-0.1228, -0.9267, -0.8853);
export const TEE_ORIGIN = new THREE.Vector3(0, 0, 0);
export const BALL_RADIUS = 0.02135;
export const BALL_START_POSITION = TEE_ORIGIN.clone().add(new THREE.Vector3(0, BALL_RADIUS, 0));
export const CLUB_FORWARD = new THREE.Vector3(0, 0, -1);
export const CLUB_OFFSET = new THREE.Vector3(-0.3, 0.8, 0);
export const CAMERA_START_DISTANCE = 6;
export const CAMERA_LOOK_AHEAD_DISTANCE = 0;
export const MAX_RENDER_PIXEL_RATIO = 0.65;
export const CAMERA_LABEL_UPDATE_INTERVAL_MS = 120;
export const FPS_LABEL_UPDATE_INTERVAL_MS = 250;