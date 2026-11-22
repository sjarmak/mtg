import type { AdvisorModel } from './evidence';
import { ARCHETYPES } from './metadata';
import { CARD_PROFILES } from './card-profiles';
import { SYNERGY_PACKAGES } from './packages';

/** Public list metadata only: this value has no draft instance or card locations. */
export const LEGACY_CUBE_ADVISOR_MODEL: AdvisorModel = {
  archetypes: ARCHETYPES,
  profiles: CARD_PROFILES,
  profilesByName: new Map(CARD_PROFILES.map((profile) => [profile.name, profile])),
  packages: SYNERGY_PACKAGES,
};
