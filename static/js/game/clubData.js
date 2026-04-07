export const DEFAULT_CLUB_SET_ID = 'air_lance_set';
export const DEFAULT_CLUB_ID = '1W';

const AIR_LANCE_SET = {
  id: DEFAULT_CLUB_SET_ID,
  name: 'Air Lance Set',
  aliases: ['air_lance', 'air-lance', 'lance'],
  clubs: [
    createClubDefinition('1W', 10.5, 'wood', 0.9, 0.35, 8),
    createClubDefinition('2W', 15, 'wood', 0.9, 0.35, 9),
    createClubDefinition('3W', 18, 'wood', 0.9, 0.35, 10),
    createClubDefinition('2I', 20, 'iron', 0.8, 0.32, 8),
    createClubDefinition('3I', 23, 'iron', 0.8, 0.32, 8),
    createClubDefinition('4I', 26, 'iron', 0.8, 0.3, 8),
    createClubDefinition('5I', 29, 'iron', 0.8, 0.3, 8),
    createClubDefinition('6I', 32, 'iron', 0.8, 0.28, 8),
    createClubDefinition('7I', 36, 'iron', 0.8, 0.28, 9),
    createClubDefinition('8I', 40, 'iron', 0.8, 0.28, 9),
    createClubDefinition('9I', 44, 'iron', 0.8, 0.26, 10),
    createClubDefinition('PW', 48, 'wedge', 0.8, 0.24, 11),
    createClubDefinition('SW', 56, 'wedge', 0.8, 0.22, 12),
    createClubDefinition('PT', 3, 'putter', 0.35, 0.15, 3),
  ],
};

const CLUB_SET_DEFINITIONS = [AIR_LANCE_SET];
const CLUB_SET_LOOKUP = new Map();

for (const clubSet of CLUB_SET_DEFINITIONS) {
  CLUB_SET_LOOKUP.set(clubSet.id, clubSet);
  for (const alias of clubSet.aliases) {
    CLUB_SET_LOOKUP.set(alias, clubSet);
  }
}

function createClubDefinition(
  id,
  loftDegrees,
  category,
  launchFactor,
  orientationLoftInfluence,
  maxDynamicLoftDeltaDegrees,
) {
  return {
    id,
    name: id,
    loftDegrees,
    category,
    launchFactor,
    orientationLoftInfluence,
    maxDynamicLoftDeltaDegrees,
    aliases: [id.toLowerCase()],
  };
}

function normalizeLookupValue(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

function cloneClub(club) {
  return {
    ...club,
    aliases: [...club.aliases],
  };
}

function cloneClubSet(clubSet) {
  return {
    ...clubSet,
    aliases: [...clubSet.aliases],
    clubs: clubSet.clubs.map(cloneClub),
  };
}

export function getClubSetById(clubSetId) {
  const clubSet = CLUB_SET_LOOKUP.get(normalizeLookupValue(clubSetId));
  return clubSet ? cloneClubSet(clubSet) : null;
}

export function getClubById(clubId, clubSet = null) {
  const normalizedClubId = normalizeLookupValue(clubId);
  const resolvedClubSet = clubSet
    ? CLUB_SET_LOOKUP.get(normalizeLookupValue(clubSet.id)) ?? clubSet
    : CLUB_SET_LOOKUP.get(DEFAULT_CLUB_SET_ID);

  if (!resolvedClubSet) {
    return null;
  }

  const resolvedClub = resolvedClubSet.clubs.find((club) => {
    if (normalizeLookupValue(club.id) === normalizedClubId) {
      return true;
    }
    return club.aliases.some((alias) => normalizeLookupValue(alias) === normalizedClubId);
  });

  return resolvedClub ? cloneClub(resolvedClub) : null;
}

export function getActiveClubSetFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const requestedClubSet = params.get('clubSet');
  const resolvedClubSet = CLUB_SET_LOOKUP.get(normalizeLookupValue(requestedClubSet));

  if (resolvedClubSet) {
    return cloneClubSet(resolvedClubSet);
  }

  if (requestedClubSet) {
    console.warn(
      `[club] Unknown club set "${requestedClubSet}". Falling back to ${DEFAULT_CLUB_SET_ID}. Available sets: ${CLUB_SET_DEFINITIONS.map((clubSet) => clubSet.id).join(', ')}`,
    );
  }

  return cloneClubSet(CLUB_SET_LOOKUP.get(DEFAULT_CLUB_SET_ID));
}

export function getActiveClubFromUrl(search = window.location.search, clubSet = ACTIVE_CLUB_SET) {
  const params = new URLSearchParams(search);
  const requestedClubId = params.get('club');
  const resolvedClub = getClubById(requestedClubId, clubSet);

  if (resolvedClub) {
    return resolvedClub;
  }

  if (requestedClubId) {
    console.warn(
      `[club] Unknown club "${requestedClubId}" for ${clubSet.name}. Falling back to ${DEFAULT_CLUB_ID}. Available clubs: ${clubSet.clubs.map((club) => club.id).join(', ')}`,
    );
  }

  return getClubById(DEFAULT_CLUB_ID, clubSet);
}

export const CLUB_SETS = CLUB_SET_DEFINITIONS.map(cloneClubSet);
export const ACTIVE_CLUB_SET = getActiveClubSetFromUrl();
export const ACTIVE_CLUB = getActiveClubFromUrl(window.location.search, ACTIVE_CLUB_SET);
export const ACTIVE_CLUB_SET_ID = ACTIVE_CLUB_SET.id;
export const ACTIVE_CLUB_ID = ACTIVE_CLUB.id;