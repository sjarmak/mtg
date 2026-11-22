import type { CardProfile } from './types';

/** Additive expert assignments. Names are checked against the pinned catalog. */
export interface ProfileGroup {
  readonly names: readonly string[];
  readonly tags: readonly string[];
  readonly roles: readonly string[];
  readonly archetypes: CardProfile['archetypes'];
  readonly flexibility?: number;
  readonly quality?: number;
  readonly fixing?: readonly string[];
  readonly sources?: readonly string[];
}
export function members(
  names: string,
  tags: readonly string[],
  roles: readonly string[],
  archetypes: CardProfile['archetypes'] = [],
  options: Pick<ProfileGroup, 'flexibility' | 'quality' | 'fixing' | 'sources'> = {},
): ProfileGroup {
  return { names: names.split('|').map((name) => name.trim()), tags, roles, archetypes, ...options };
}
export function lane(
  archetype: string,
  strength: 1 | 2 | 3,
  roles: readonly string[],
  signal: number,
): CardProfile['archetypes'][number] {
  return { archetype, strength, roles, signal };
}
