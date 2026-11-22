/** Narrow generator promotions composed from already engine-legal vocabulary. */
import { describe, expect, it } from 'vitest';
import {
  ControlledCreatureCounterOnEntryModelAbilitySchema,
  FightOpposingCreatureModelEffectSchema,
  KeywordGrantToControlledCreatureModelEffectSchema,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  OwnGraveyardCardToHandModelEffectSchema,
  ReturnArtifactOrEnchantmentToHandModelEffectSchema,
  UntapControlledCreatureModelEffectSchema,
  type Effect,
} from '../src/index';

const GRANT = {
  kind: 'grantKeywordUntilEndOfTurn',
  keyword: 'flying',
  target: { kind: 'targetCreatureYouControl' },
} as const;

describe('keyword-grant capability bundle', () => {
  it('admits the approved effect and target only', () => {
    expect(KeywordGrantToControlledCreatureModelEffectSchema.parse(GRANT)).toStrictEqual(GRANT);
    expect(
      KeywordGrantToControlledCreatureModelEffectSchema.safeParse({
        ...GRANT,
        target: { kind: 'targetCreature' },
      }).success,
    ).toBe(false);
    expect(
      KeywordGrantToControlledCreatureModelEffectSchema.safeParse({
        ...GRANT,
        additionalKeywords: ['lifelink'],
      }).success,
    ).toBe(false);
  });

  it('is contained by the engine without independently widening frozen model tuples', () => {
    type PromotedEffect = ReturnType<typeof KeywordGrantToControlledCreatureModelEffectSchema.parse>;
    const _contained: PromotedEffect extends Effect ? true : never = true;
    expect(_contained).toBe(true);

    expect(MODEL_EFFECT_KINDS).not.toContain('grantKeywordUntilEndOfTurn');
    expect(MODEL_TARGET_KINDS).not.toContain('targetCreatureYouControl');
    expect(MODEL_TRIGGER_CONDITIONS).toStrictEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect(ModelEffectSchema.safeParse(GRANT).success).toBe(false);
  });
});

describe('controlled-creature counter-on-entry capability bundle', () => {
  const ability = {
    kind: 'triggered',
    condition: 'anotherControlledCreatureEnters',
    effects: [
      {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: 2,
        target: { kind: 'targetCreatureYouControl' },
      },
    ],
  } as const;

  it('binds the effect, target, counter, and trigger as one schema', () => {
    expect(ControlledCreatureCounterOnEntryModelAbilitySchema.parse(ability)).toStrictEqual(ability);
    for (const neighbor of [
      { ...ability, condition: 'selfEnters' },
      {
        ...ability,
        effects: [{ ...ability.effects[0], target: { kind: 'targetCreature' } }],
      },
      {
        ...ability,
        effects: [{ ...ability.effects[0], counter: 'gloom' }],
      },
    ]) {
      expect(ControlledCreatureCounterOnEntryModelAbilitySchema.safeParse(neighbor).success).toBe(false);
    }
  });

  it('does not widen the three frozen global tuples', () => {
    expect(MODEL_EFFECT_KINDS).not.toContain('putCounters');
    expect(MODEL_TARGET_KINDS).not.toContain('targetCreatureYouControl');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('anotherControlledCreatureEnters');
  });
});

describe('fight-opposing-creature capability bundle', () => {
  const effect = { kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } } as const;

  it('binds fight to the opposing-creature selector', () => {
    expect(FightOpposingCreatureModelEffectSchema.parse(effect)).toStrictEqual(effect);
    expect(
      FightOpposingCreatureModelEffectSchema.safeParse({
        ...effect,
        target: { kind: 'targetCreature' },
      }).success,
    ).toBe(false);
    expect(
      FightOpposingCreatureModelEffectSchema.safeParse({
        ...effect,
        fighter: { kind: 'targetCreatureYouControl' },
      }).success,
    ).toBe(false);
  });

  it('keeps the general vocabulary tuple closed', () => {
    expect(MODEL_EFFECT_KINDS).not.toContain('fight');
    expect(MODEL_TARGET_KINDS).not.toContain('targetCreatureYouDontControl');
  });
});

describe('untap-controlled-creature capability bundle', () => {
  const effect = { kind: 'untapPermanent', target: { kind: 'targetCreatureYouControl' } } as const;

  it('binds untap to a controlled creature', () => {
    expect(UntapControlledCreatureModelEffectSchema.parse(effect)).toStrictEqual(effect);
    for (const target of ['targetCreature', 'targetPermanent', 'targetLandYouControl']) {
      expect(
        UntapControlledCreatureModelEffectSchema.safeParse({ ...effect, target: { kind: target } }).success,
      ).toBe(false);
    }
  });

  it('keeps the general vocabulary tuple closed', () => {
    expect(MODEL_EFFECT_KINDS).not.toContain('untapPermanent');
    expect(MODEL_TARGET_KINDS).not.toContain('targetCreatureYouControl');
  });
});

describe('artifact-or-enchantment return routing capability bundle', () => {
  const effect = {
    kind: 'returnToHand',
    target: { kind: 'targetArtifactOrEnchantment' },
  } as const;

  it('binds the selector to return-to-hand only', () => {
    expect(ReturnArtifactOrEnchantmentToHandModelEffectSchema.parse(effect)).toStrictEqual(effect);
    expect(
      ReturnArtifactOrEnchantmentToHandModelEffectSchema.safeParse({
        kind: 'exileTarget',
        target: effect.target,
      }).success,
    ).toBe(false);
    expect(
      ReturnArtifactOrEnchantmentToHandModelEffectSchema.safeParse({
        ...effect,
        target: { kind: 'targetPermanent' },
      }).success,
    ).toBe(false);
  });

  it('keeps the general vocabulary tuple closed', () => {
    expect(MODEL_TARGET_KINDS).not.toContain('targetArtifactOrEnchantment');
  });
});

describe('own-graveyard-card-to-hand capability bundle', () => {
  const creature = {
    kind: 'chooseFromGraveyard',
    whose: 'you',
    filter: { cardTypes: ['creature'], maxManaValue: 3 },
    destination: 'hand',
  } as const;
  const spells = {
    kind: 'chooseFromGraveyard',
    whose: 'you',
    filter: { cardTypes: ['instant', 'sorcery'] },
    destination: 'hand',
  } as const;

  it('admits the two reviewed filters and own-graveyard-to-hand route only', () => {
    expect(OwnGraveyardCardToHandModelEffectSchema.parse(creature)).toStrictEqual(creature);
    expect(OwnGraveyardCardToHandModelEffectSchema.parse(spells)).toStrictEqual(spells);
    for (const neighbor of [
      { ...creature, whose: 'opponent' },
      { ...creature, destination: 'battlefield' },
      { ...creature, destination: 'exile' },
      { ...creature, control: 'you' },
      { ...creature, filter: { cardTypes: ['artifact'] } },
    ]) {
      expect(OwnGraveyardCardToHandModelEffectSchema.safeParse(neighbor).success).toBe(false);
    }
  });

  it('keeps the general vocabulary tuple closed', () => {
    expect(MODEL_EFFECT_KINDS).not.toContain('chooseFromGraveyard');
  });
});
