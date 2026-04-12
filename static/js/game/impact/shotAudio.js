import {
  CLUB_SWING_WHOOSH_MAX_SPEED,
  SHOT_AUDIO_LIGHT_MAX_IMPACT_SPEED,
  SHOT_AUDIO_MEDIUM_MAX_IMPACT_SPEED,
  SHOT_AUDIO_VOLUME,
} from '/static/js/game/constants.js';

const SHOT_AUDIO_PATHS = {
  light: '/assets/audio_clip/shot/shot_light_normal.wav',
  medium: '/assets/audio_clip/shot/shot_medium_normal.wav',
  practice: '/assets/audio_clip/shot/shot_practice.wav',
  strong: '/assets/audio_clip/shot/shot_strong_normal.wav',
  pangya: '/assets/audio_clip/shot/pangya.wav',
  whoosh: '/assets/audio_clip/whoosh/whoosh_foley1.wav',
};

const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

export function createShotImpactAudio() {
  const clips = {
    light: createClipState(SHOT_AUDIO_PATHS.light),
    medium: createClipState(SHOT_AUDIO_PATHS.medium),
    practice: createClipState(SHOT_AUDIO_PATHS.practice),
    strong: createClipState(SHOT_AUDIO_PATHS.strong),
    pangya: createClipState(SHOT_AUDIO_PATHS.pangya),
    whoosh: createClipState(SHOT_AUDIO_PATHS.whoosh),
  };

  const unlockAudio = () => {
    removeUnlockListeners(unlockAudio);
    primeClip(clips.light.base);
    primeClip(clips.medium.base);
    primeClip(clips.practice.base);
    primeClip(clips.strong.base);
    primeClip(clips.pangya.base);
    primeClip(clips.whoosh.base);
  };

  addUnlockListeners(unlockAudio);

  return {
    playForImpactSpeed(impactSpeedMetersPerSecond) {
      if (!Number.isFinite(impactSpeedMetersPerSecond) || impactSpeedMetersPerSecond <= 0) {
        return;
      }

      const clip = selectClip(clips, impactSpeedMetersPerSecond);
      playClip(clip);
    },
    playPangya() {
      playClip(clips.pangya);
    },
    playPractice() {
      playClip(clips.practice);
    },
    playWhoosh(clubHeadSpeedMetersPerSecond) {
      const volume = getWhooshVolume(clubHeadSpeedMetersPerSecond);
      playClip(clips.whoosh, volume);
    },
  };
}

function createClipState(src) {
  const base = new Audio(src);
  base.preload = 'auto';
  base.volume = SHOT_AUDIO_VOLUME;
  base.load();

  return {
    base,
    activeClones: new Set(),
  };
}

function selectClip(clips, impactSpeedMetersPerSecond) {
  if (impactSpeedMetersPerSecond < SHOT_AUDIO_LIGHT_MAX_IMPACT_SPEED) {
    return clips.light;
  }

  if (impactSpeedMetersPerSecond < SHOT_AUDIO_MEDIUM_MAX_IMPACT_SPEED) {
    return clips.medium;
  }

  return clips.strong;
}

function addUnlockListeners(unlockAudio) {
  for (const eventName of AUDIO_UNLOCK_EVENTS) {
    window.addEventListener(eventName, unlockAudio, { passive: true });
  }
}

function removeUnlockListeners(unlockAudio) {
  for (const eventName of AUDIO_UNLOCK_EVENTS) {
    window.removeEventListener(eventName, unlockAudio);
  }
}

function playClip(clipState, volume = clipState.base.volume) {
  const resolvedVolume = Math.max(0, Math.min(volume, 1));

  if (isClipAvailable(clipState.base)) {
    clipState.base.currentTime = 0;
    clipState.base.volume = resolvedVolume;
    const playPromise = clipState.base.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
    return;
  }

  const playbackClip = clipState.base.cloneNode();
  playbackClip.volume = resolvedVolume;
  playbackClip.preload = 'auto';
  playbackClip.currentTime = 0;
  clipState.activeClones.add(playbackClip);

  const releaseClip = () => {
    playbackClip.pause();
    playbackClip.currentTime = 0;
    clipState.activeClones.delete(playbackClip);
  };

  playbackClip.addEventListener('ended', releaseClip, { once: true });
  playbackClip.addEventListener('error', releaseClip, { once: true });

  const playPromise = playbackClip.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      clipState.activeClones.delete(playbackClip);
    });
  }
}

function isClipAvailable(clip) {
  return clip.paused || clip.ended || clip.currentTime <= 0;
}

function getWhooshVolume(clubHeadSpeedMetersPerSecond) {
  if (!Number.isFinite(clubHeadSpeedMetersPerSecond) || clubHeadSpeedMetersPerSecond <= 0) {
    return 0;
  }

  return SHOT_AUDIO_VOLUME * Math.min(clubHeadSpeedMetersPerSecond, CLUB_SWING_WHOOSH_MAX_SPEED) / CLUB_SWING_WHOOSH_MAX_SPEED;
}

function primeClip(clip) {
  const previousMuted = clip.muted;
  clip.muted = true;
  clip.currentTime = 0;

  const playPromise = clip.play();
  if (!playPromise?.then) {
    clip.pause();
    clip.currentTime = 0;
    clip.muted = previousMuted;
    return;
  }

  playPromise
    .then(() => {
      clip.pause();
      clip.currentTime = 0;
      clip.muted = previousMuted;
    })
    .catch(() => {
      clip.muted = previousMuted;
    });
}