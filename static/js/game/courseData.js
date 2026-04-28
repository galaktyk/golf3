import * as THREE from 'three';
import { resolveAssetUrl } from '../assets.js';

export const DEFAULT_COURSE_ID = 'blue_lagoon_1';

const COURSE_DEFINITIONS = [
  {
    id: 'blue_lagoon_1',
    name: 'Blue Lagoon 1',
    par: 4,
    modelPath: resolveAssetUrl('models/maps/blue_lagoon_1.glb'),
    tee: new THREE.Vector3(-0.134, -1.32, -7.978),
    hole: new THREE.Vector3(42.9607 , -2.52835 , -394.162),
    aliases: ['lagoon1', 'lagoon_1', 'blue-lagoon-1', '1'],
  },
  {
    id: 'blue_lagoon_2',
    name: 'Blue Lagoon 2',
    par: 3,
    modelPath: resolveAssetUrl('models/maps/blue_lagoon_2.glb'),
    tee: new THREE.Vector3(-0.033, -1.327, -7.215),
    hole: new THREE.Vector3(-0.000422, -5.09763 , -216.9),
    aliases: ['lagoon2', 'lagoon_2', 'blue-lagoon-2', '2'],
  },
  {
    id: 'wiz_wiz_1',
    name: 'Wiz Wiz 1',
    par: 4,
    modelPath: resolveAssetUrl('models/maps/wiz_wiz_1.glb'),
    tee: new THREE.Vector3(0.000024, -1.28543, -7.43164),
    hole: new THREE.Vector3(21.5223, -5.28773, -393.675),
    aliases: ['wiz1', 'wiz_wiz_1', 'wiz-wiz-1'],
  },
  {
    id: 'wiz_wiz_2',
    name: 'Wiz Wiz 2',
    par: 5,
    modelPath: resolveAssetUrl('models/maps/wiz_wiz_2.glb'),
    tee: new THREE.Vector3(-0.000004, -1.28576, -7.42901),
    hole: new THREE.Vector3(-6.37351, -12.4968, -476.544),
    aliases: ['wiz2', 'wiz_wiz_2', 'wiz-wiz-2'],
  },
  {
    id: 'wiz_wiz_3',
    name: 'Wiz Wiz 3',
    par: 4,
    modelPath: resolveAssetUrl('models/maps/wiz_wiz_3.glb'),
    tee: new THREE.Vector3(0.021414, -1.28487, -7.56164),
    hole: new THREE.Vector3(-0.011929, -10.3085, -225.437),
    aliases: ['wiz3', 'wiz_wiz_3', 'wiz-wiz-3'],
  },
];

const COURSE_ID_LOOKUP = new Map();

for (const course of COURSE_DEFINITIONS) {
  COURSE_ID_LOOKUP.set(course.id, course);
  for (const alias of course.aliases) {
    COURSE_ID_LOOKUP.set(alias, course);
  }
}

function normalizeCourseParam(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

export function getCourseById(courseId) {
  return COURSE_ID_LOOKUP.get(normalizeCourseParam(courseId)) ?? null;
}

export function getActiveCourseFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const requestedCourse = params.get('map');
  const resolvedCourse = getCourseById(requestedCourse);

  if (resolvedCourse) {
    return resolvedCourse;
  }

  if (requestedCourse) {
    console.warn(
      `[course] Unknown map "${requestedCourse}". Falling back to ${DEFAULT_COURSE_ID}. Available maps: ${COURSE_DEFINITIONS.map((course) => course.id).join(', ')}`,
    );
  }

  return COURSE_ID_LOOKUP.get(DEFAULT_COURSE_ID);
}

export const COURSES = COURSE_DEFINITIONS.map((course) => ({
  ...course,
  tee: course.tee.clone(),
  hole: course.hole.clone(),
  aliases: [...course.aliases],
}));

export const ACTIVE_COURSE = getActiveCourseFromUrl();
export const ACTIVE_COURSE_ID = ACTIVE_COURSE.id;