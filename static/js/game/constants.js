import * as THREE from 'three';


// Character position related to ball
export const CHARACTER_BALL_X_OFFSET = -0.87;
export const CHARACTER_BALL_Z_OFFSET = 0.05;

export const MAP_TEE_ORIGIN = new THREE.Vector3(-0.1228, -0.9267, -0.8853);
export const TEE_ORIGIN = new THREE.Vector3(0, 0, 0);
export const BALL_RADIUS = 0.02135;
export const BALL_START_POSITION = TEE_ORIGIN.clone().add(new THREE.Vector3(0, BALL_RADIUS, 0));
export const BALL_FIXED_STEP_SECONDS = 1 / 60;
export const BALL_MAX_FIXED_STEPS_PER_FRAME = 8;
export const BALL_GRAVITY_ACCELERATION = 9.81;
export const BALL_AIR_DRAG = 0.04;
export const BALL_BOUNCE_RESTITUTION = 0.3;
export const BALL_IMPACT_FRICTION = 0.06;
export const BALL_ROLLING_FRICTION = 0.15;
export const BALL_GROUND_CAPTURE_NORMAL_SPEED = 0.45;
export const BALL_GROUND_CAPTURE_SPEED = 2.4;
export const BALL_STOP_SPEED = 0.08;

export const BALL_COLLISION_SKIN = 0.001;
export const BALL_COLLISION_STEP_DISTANCE = 0.01;
export const BALL_MAX_COLLISION_SUBSTEPS = 12;
export const BALL_MAX_COLLISION_ITERATIONS = 4;
export const BALL_GROUND_SNAP_DISTANCE = 0.06;
export const BALL_GROUNDED_NORMAL_MIN_Y = 0.6;

// In metric units, for debugging purposes only
export const BALL_DEFAULT_LAUNCH_DATA = {
  ballSpeed: 45.2, // m/s (approx 101 mph)
  verticalLaunchAngle: 15.4,
  horizontalLaunchAngle: 0,
  spinSpeed: 3021, // RPM, not being use right now
  spinAxis: -0.5 // degrees, not being use right now
};
export const BALL_IMPACT_VERTICAL_LAUNCH_ANGLE = 15;
export const BALL_IMPACT_DEBUG_SPIN_SPEED = 0;
export const BALL_IMPACT_DEBUG_SPIN_AXIS = 0;

export const CLUB_HEAD_COLLIDER_RADIUS = 0.14;
export const CLUB_HEAD_COLLIDER_TIP_BACKOFF = 0.05;
export const CLUB_HEAD_COLLIDER_SIDE_OFFSET = 0.1;
export const CLUB_HEAD_LAUNCH_DIRECTION_LOCAL = new THREE.Vector3(0, 0, 1);
export const CLUB_HEAD_IMPACT_MIN_SPEED = 1;
export const CLUB_HEAD_TO_BALL_SPEED_FACTOR = 2.5;
export const CLUB_HEAD_CONTACT_RELEASE_DISTANCE = 0.18;
export const CLUB_HEAD_HISTORY_DURATION_SECONDS = 0.08;
export const CLUB_HEAD_HISTORY_MAX_SAMPLES = 8;
export const CLUB_HEAD_VELOCITY_FIT_WINDOW_SECONDS = 0.1;
export const CLUB_HEAD_VELOCITY_FIT_MIN_SAMPLES = 6;
export const CLUB_HEAD_VERTICAL_LAUNCH_MIN_ANGLE = 0;
export const CLUB_HEAD_VERTICAL_LAUNCH_MAX_ANGLE = 85;
export const SHOT_AUDIO_LIGHT_MAX_IMPACT_SPEED = 8;
export const SHOT_AUDIO_MEDIUM_MAX_IMPACT_SPEED = 14;
export const SHOT_AUDIO_PANGYA_MAX_HORIZONTAL_ANGLE_DEGREES = 10;
export const SHOT_AUDIO_VOLUME = 0.85;

export const CHARACTER_SETUP_OFFSET = new THREE.Vector3(CHARACTER_BALL_X_OFFSET, -BALL_RADIUS, CHARACTER_BALL_Z_OFFSET);
export const CHARACTER_ROTATION_SPEED_DEGREES = 45;
export const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);
export const CAMERA_START_DISTANCE = 6;
export const CAMERA_LOOK_AHEAD_DISTANCE = 0;
export const CAMERA_TILT_OFFSET_DEGREES = 12;
export const CAMERA_FOLLOW_STIFFNESS = 8;
export const MAX_RENDER_PIXEL_RATIO = 0.65;
export const CAMERA_LABEL_UPDATE_INTERVAL_MS = 120;
export const FPS_LABEL_UPDATE_INTERVAL_MS = 250;