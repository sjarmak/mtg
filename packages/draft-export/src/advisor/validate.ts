import { ARCHETYPES } from './metadata';
import { CARD_PROFILES, PROFILE_GROUPS } from './card-profiles';
import { SYNERGY_PACKAGES } from './packages';

export const LEGACY_CUBE_CARD_COUNT = 600;
export const LEGACY_CUBE_NAMES_SHA256 = '9d624b8df21265b69c92a62650d6bb4910db3617ad61782677df87582c9fba77';
export const LEGACY_CUBE_CONTENT_SHA256 = '65e32dd53edc2583c555ccf6922406229a2f6056ad21862370365b329bf5367c';

export interface LegacyCubeCatalogSnapshot {
  readonly cards: readonly { readonly correctedName: string }[];
  readonly contentSha256: string;
}

export interface MetadataValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function namesFingerprint(names: readonly string[]): string {
  // FNV-1a is intentionally used here so validation is browser-safe. The
  // published SHA is checked by the metadata test with node:crypto as well.
  let hash = 2166136261;
  for (const character of names.join('\n')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function validateAdvisorMetadata(catalog: LegacyCubeCatalogSnapshot): MetadataValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const catalogNames = catalog.cards.map((card) => card.correctedName);
  if (catalog.contentSha256 !== LEGACY_CUBE_CONTENT_SHA256)
    errors.push('catalog content hash drifted; regenerate advisor metadata');
  const profiles = new Map<string, (typeof CARD_PROFILES)[number]>(
    CARD_PROFILES.map((profile) => [profile.name, profile]),
  );
  if (profiles.size !== CARD_PROFILES.length) errors.push('duplicate card profiles');
  for (const group of PROFILE_GROUPS) {
    for (const name of group.names)
      if (!profiles.has(name)) errors.push(`authored group names a card outside the cube: ${name}`);
  }
  if (catalog.cards.length !== LEGACY_CUBE_CARD_COUNT)
    errors.push(
      `catalog has ${String(catalog.cards.length)} cards, expected ${String(LEGACY_CUBE_CARD_COUNT)}`,
    );
  if (new Set(catalogNames).size !== catalogNames.length)
    errors.push('catalog correctedName values are not unique');
  if (CARD_PROFILES.length !== catalogNames.length) errors.push('profile count does not match catalog count');
  for (const name of catalogNames) if (!profiles.has(name)) errors.push(`missing profile for ${name}`);
  for (const profile of CARD_PROFILES) {
    if (profile.neutral !== (profile.archetypes.length === 0))
      errors.push(`neutral classification contradicts memberships: ${profile.name}`);
    if (new Set(profile.archetypes.map((a) => a.archetype)).size !== profile.archetypes.length)
      errors.push(`duplicate archetype membership: ${profile.name}`);
    if ([...profile.fixing, ...(profile.sources ?? [])].some((c) => !['W', 'U', 'B', 'R', 'G'].includes(c)))
      errors.push(`invalid fixing color: ${profile.name}`);
    if (!catalogNames.includes(profile.name)) errors.push(`profile is not in catalog: ${profile.name}`);
    if (!Number.isInteger(profile.quality) || profile.quality < 1 || profile.quality > 5)
      errors.push(`invalid quality for ${profile.name}`);
    if (profile.flexibility < 0 || profile.flexibility > 1)
      errors.push(`invalid flexibility for ${profile.name}`);
    if (profile.roles.length < 1 || profile.tags.length < 1)
      errors.push(`empty roles or tags for ${profile.name}`);
    for (const assessment of profile.archetypes) {
      const archetype = ARCHETYPES.find((entry) => entry.id === assessment.archetype);
      if (archetype === undefined)
        errors.push(`${profile.name} references unknown archetype ${assessment.archetype}`);
      if (assessment.signal < 0 || assessment.signal > 1) errors.push(`invalid signal for ${profile.name}`);
      if (![1, 2, 3].includes(assessment.strength) || assessment.roles.length === 0)
        errors.push(`invalid membership for ${profile.name}`);
    }
  }
  const archetypeIds = new Set(ARCHETYPES.map((archetype) => archetype.id));
  const packageIds = new Set(SYNERGY_PACKAGES.map((synergyPackage) => synergyPackage.id));
  for (const archetype of ARCHETYPES) {
    if (archetype.packages.some((id) => !packageIds.has(id)))
      errors.push(`${archetype.id} references an unknown package`);
    for (const id of archetype.packages)
      if (!SYNERGY_PACKAGES.find((p) => p.id === id)?.archetypes.includes(archetype.id))
        errors.push(`${archetype.id} and package ${id} disagree on membership`);
    for (const finisher of archetype.finishers)
      if (!profiles.has(finisher))
        errors.push(`${archetype.id} names a finisher absent from the catalog: ${finisher}`);
    if (
      !CARD_PROFILES.some((profile) =>
        profile.archetypes.some((assessment) => assessment.archetype === archetype.id),
      )
    )
      errors.push(`${archetype.id} has no profiled members`);
    for (const need of archetype.needs) {
      if (!Number.isInteger(need.min) || need.min < 1)
        errors.push(`invalid need threshold: ${archetype.id}/${need.tag}`);
      const count = CARD_PROFILES.filter((profile) => profile.tags.includes(need.tag)).length;
      if (count < need.min)
        errors.push(
          `${archetype.id} need ${need.tag} requires ${String(need.min)} cards but has ${String(count)}`,
        );
    }
  }
  for (const synergyPackage of SYNERGY_PACKAGES) {
    if (!synergyPackage.needs.length) errors.push(`empty package: ${synergyPackage.id}`);
    if (synergyPackage.archetypes.some((id) => !archetypeIds.has(id)))
      errors.push(`${synergyPackage.id} references an unknown archetype`);
    for (const example of synergyPackage.examples)
      if (!profiles.has(example))
        errors.push(`${synergyPackage.id} names an example absent from the catalog: ${example}`);
    for (const need of synergyPackage.needs) {
      if (!Number.isInteger(need.min) || need.min < 1)
        errors.push(`invalid package threshold: ${synergyPackage.id}/${need.tag}`);
      const count = CARD_PROFILES.filter((profile) => profile.tags.includes(need.tag)).length;
      if (count < need.min)
        errors.push(
          `${synergyPackage.id} need ${need.tag} requires ${String(need.min)} cards but has ${String(count)}`,
        );
    }
  }
  const taggedArchetypes = new Set<string>(
    CARD_PROFILES.flatMap((profile) => profile.archetypes.map((assessment) => assessment.archetype)),
  );
  for (const archetype of ARCHETYPES)
    if (!taggedArchetypes.has(archetype.id)) errors.push(`${archetype.id} has no profiled cards`);
  // This cheap fingerprint catches a changed catalog in browser builds; the
  // cryptographic fingerprint is pinned in the test because node:crypto is not
  // part of the browser bundle.
  if (namesFingerprint(catalogNames) !== 'ce0addbb')
    errors.push('catalog correctedName fingerprint drifted; regenerate advisor metadata');
  return { ok: errors.length === 0, errors, warnings };
}
