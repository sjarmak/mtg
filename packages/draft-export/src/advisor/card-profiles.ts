import type { CardProfile } from './types';
import { BASE_PROFILES } from './baseline';
import { FAIR_GROUPS } from './groups-fair';
import { ENGINE_GROUPS } from './groups-engines';
import { MANA_GROUPS } from './groups-mana';
import { SPECIAL_GROUPS } from './groups-special';

export const PROFILE_GROUPS = [...FAIR_GROUPS, ...ENGINE_GROUPS, ...MANA_GROUPS, ...SPECIAL_GROUPS];
const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

/** Additive roles never replace a card's structural facts or its other paths. */
export const CARD_PROFILES: readonly CardProfile[] = BASE_PROFILES.map((base) => {
  const groups = PROFILE_GROUPS.filter((group) => group.names.includes(base.name));
  const memberships = groups.flatMap((group) => group.archetypes);
  const archetypes = unique(memberships.map((a) => a.archetype)).map((id) => {
    const matches = memberships.filter((a) => a.archetype === id);
    return {
      archetype: id,
      strength: Math.max(...matches.map((a) => a.strength)) as 1 | 2 | 3,
      roles: unique(matches.flatMap((a) => a.roles)),
      signal: Math.max(...matches.map((a) => a.signal)),
    };
  });
  return {
    ...base,
    quality: groups.findLast((g) => g.quality !== undefined)?.quality ?? base.quality,
    flexibility: Math.min(base.flexibility, ...groups.map((g) => g.flexibility ?? 1)),
    neutral: archetypes.length === 0,
    roles: unique([...base.roles, ...groups.flatMap((g) => g.roles)]),
    tags: unique([...base.tags, ...groups.flatMap((g) => g.tags)]),
    fixing: unique(groups.flatMap((g) => g.fixing ?? [])),
    sources: unique(groups.flatMap((g) => g.sources ?? [])),
    archetypes,
  };
});
