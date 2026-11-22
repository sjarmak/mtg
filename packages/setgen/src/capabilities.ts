/** Independent switches that compose one fill answer schema for one batch. */
export const FILL_CAPABILITIES = [
  'abilities',
  'equipment',
  'setMechanics',
  'spellPermanents',
  'zoneReach',
  'controlledCreatureKeywordGrant',
  'controlledCreatureCounterOnEntry',
  'fightOpposingCreature',
  'untapControlledCreature',
  'artifactOrEnchantmentBounce',
  'ownGraveyardToHand',
] as const;

export type FillCapability = (typeof FILL_CAPABILITIES)[number];

/** Effect discriminants a reviewed bundle may add without widening EffectKind. */
export const CAPABILITY_EFFECT_KINDS = [
  'grantKeywordUntilEndOfTurn',
  'fight',
  'untapPermanent',
  'chooseFromGraveyard',
] as const;
export type CapabilityEffectKind = (typeof CAPABILITY_EFFECT_KINDS)[number];

/** The one reviewed trigger extension; useful only with the counter-entry bundle. */
export const CAPABILITY_TRIGGER_CONDITIONS = ['anotherControlledCreatureEnters'] as const;
export type CapabilityTriggerCondition = (typeof CAPABILITY_TRIGGER_CONDITIONS)[number];

/** The six reviewed promotions; every other flag describes an older schema dimension. */
export const PROMOTED_FILL_CAPABILITIES = FILL_CAPABILITIES.slice(5) as readonly FillCapability[];

export function orderedFillCapabilities(flags: Iterable<FillCapability>): readonly FillCapability[] {
  const wanted = new Set(flags);
  return FILL_CAPABILITIES.filter((flag) => wanted.has(flag));
}

interface CapabilityMechanic {
  readonly abilityKinds: readonly string[];
  readonly effectKinds: readonly string[];
  readonly capabilityEffectKinds?: readonly string[];
  readonly triggerConditions: readonly string[];
}

/** Recognize only complete, reviewed mechanic contracts. */
export function capabilitiesForMechanic(mechanic: CapabilityMechanic): readonly FillCapability[] {
  const capabilities: FillCapability[] = [];
  const effects = [...mechanic.effectKinds, ...(mechanic.capabilityEffectKinds ?? [])];
  const resolvesThroughAbility = mechanic.abilityKinds.some(
    (kind) => kind === 'triggered' || kind === 'activated',
  );
  if (resolvesThroughAbility && effects.includes('grantKeywordUntilEndOfTurn')) {
    capabilities.push('controlledCreatureKeywordGrant');
  }
  if (resolvesThroughAbility && effects.includes('fight')) {
    capabilities.push('fightOpposingCreature');
  }
  if (resolvesThroughAbility && effects.includes('untapPermanent')) {
    capabilities.push('untapControlledCreature');
  }
  if (resolvesThroughAbility && effects.includes('chooseFromGraveyard')) {
    capabilities.push('ownGraveyardToHand');
  }
  if (
    mechanic.abilityKinds.includes('triggered') &&
    mechanic.triggerConditions.includes('anotherControlledCreatureEnters') &&
    mechanic.effectKinds.includes('putCounters')
  ) {
    capabilities.push('controlledCreatureCounterOnEntry');
  }
  return orderedFillCapabilities(capabilities);
}
