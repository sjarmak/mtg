/** Composable answer-schema routing for reviewed generator capabilities. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as setgen from '@mtg/setgen';
import {
  FILL_CAPABILITIES,
  assembleCard,
  buildFillPrompt,
  allocateSlots,
  checkSlotConformance,
  fillCapabilitiesFor,
  fillSchemaForCapabilities,
  parseBrief,
} from '@mtg/setgen';
import type { FillCapability, FilledCard, Slot } from '@mtg/setgen';
import type { Effect, GeneratorModelAbility } from '@mtg/dsl';
import { TEST_BRIEF } from './helpers';

const BASE_SLOT: Slot = {
  id: 'CU01',
  index: 0,
  collectorNumber: 1,
  rarity: 'common',
  color: 'U',
  cardKind: 'instant',
  role: 'test',
  manaValueMin: 2,
  manaValueMax: 2,
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  auraModifications: [],
  triggerConditions: [],
  mechanics: [],
  archetypes: [],
  signpost: false,
};

const PROMOTIONS = [
  'controlledCreatureKeywordGrant',
  'controlledCreatureCounterOnEntry',
  'fightOpposingCreature',
  'untapControlledCreature',
  'artifactOrEnchantmentBounce',
  'ownGraveyardToHand',
] as const satisfies readonly FillCapability[];

const PROMOTED_EFFECTS: Readonly<Record<(typeof PROMOTIONS)[number], Record<string, unknown>>> = {
  controlledCreatureKeywordGrant: {
    kind: 'grantKeywordUntilEndOfTurn',
    keyword: 'flying',
    target: { kind: 'targetCreatureYouControl' },
  },
  controlledCreatureCounterOnEntry: {
    kind: 'putCounters',
    counter: 'plusOnePlusOne',
    count: 1,
    target: { kind: 'targetCreatureYouControl' },
  },
  fightOpposingCreature: {
    kind: 'fight',
    target: { kind: 'targetCreatureYouDontControl' },
  },
  untapControlledCreature: {
    kind: 'untapPermanent',
    target: { kind: 'targetCreatureYouControl' },
  },
  artifactOrEnchantmentBounce: {
    kind: 'returnToHand',
    target: { kind: 'targetArtifactOrEnchantment' },
  },
  ownGraveyardToHand: {
    kind: 'chooseFromGraveyard',
    whose: 'you',
    filter: { cardTypes: ['creature'] },
    destination: 'hand',
  },
};

function spell(effect: unknown): unknown {
  return {
    cards: [
      {
        slotId: BASE_SLOT.id,
        kind: 'instant',
        name: 'Capability Proof',
        manaCost: { generic: 1, U: 1 },
        effects: [effect],
        designNote: 'Exercises one reviewed capability through the fill boundary.',
      },
    ],
  };
}

function creatureAbility(ability: unknown): unknown {
  return {
    cards: [
      {
        slotId: 'CG01',
        kind: 'creature',
        name: 'Capability Bearer',
        subtypes: ['Warrior'],
        manaCost: { generic: 2, G: 1 },
        power: 3,
        toughness: 3,
        abilities: [ability],
        designNote: 'Exercises one reviewed ability capability through the fill boundary.',
      },
    ],
  };
}

describe('the composable fill capability address', () => {
  it('is one flag registry rather than exported FillBatchWith combinations', () => {
    expect(FILL_CAPABILITIES).toStrictEqual([
      'abilities',
      'equipment',
      'setMechanics',
      'spellPermanents',
      'zoneReach',
      ...PROMOTIONS,
    ]);
    expect(Object.keys(setgen).filter((name) => name.startsWith('FillBatchWith'))).toStrictEqual([]);
  });

  it('composes unrelated capabilities without adding a named tier', () => {
    const schema = fillSchemaForCapabilities([
      'abilities',
      'spellPermanents',
      'zoneReach',
      'controlledCreatureKeywordGrant',
      'ownGraveyardToHand',
    ]);
    expect(schema.safeParse(spell(PROMOTED_EFFECTS.ownGraveyardToHand)).success).toBe(true);
    expect(schema.safeParse(spell(PROMOTED_EFFECTS.controlledCreatureKeywordGrant)).success).toBe(true);
  });
});

describe('the six reviewed bundles at the answer-schema seam', () => {
  for (const capability of PROMOTIONS.filter(
    (candidate) => candidate !== 'controlledCreatureCounterOnEntry',
  )) {
    it(`admits ${capability} as an exact effect bundle`, () => {
      expect(
        fillSchemaForCapabilities([capability]).safeParse(spell(PROMOTED_EFFECTS[capability])).success,
      ).toBe(true);
    });
  }

  it('admits the counter trigger only as the reviewed trigger/effect/target bundle', () => {
    const schema = fillSchemaForCapabilities(['abilities', 'controlledCreatureCounterOnEntry']);
    const ability = {
      kind: 'triggered',
      condition: 'anotherControlledCreatureEnters',
      effects: [PROMOTED_EFFECTS.controlledCreatureCounterOnEntry],
    };
    expect(schema.safeParse(creatureAbility(ability)).success).toBe(true);
    expect(schema.safeParse(creatureAbility({ ...ability, condition: 'selfEnters' })).success).toBe(false);
  });

  it('keeps neighboring targets and graveyard destinations outside the promoted space', () => {
    expect(
      fillSchemaForCapabilities(['fightOpposingCreature']).safeParse(
        spell({ ...PROMOTED_EFFECTS.fightOpposingCreature, target: { kind: 'targetCreature' } }),
      ).success,
    ).toBe(false);
    expect(
      fillSchemaForCapabilities(['untapControlledCreature']).safeParse(
        spell({ ...PROMOTED_EFFECTS.untapControlledCreature, target: { kind: 'targetPermanent' } }),
      ).success,
    ).toBe(false);
    expect(
      fillSchemaForCapabilities(['ownGraveyardToHand']).safeParse(
        spell({ ...PROMOTED_EFFECTS.ownGraveyardToHand, destination: 'battlefield' }),
      ).success,
    ).toBe(false);
    expect(
      fillSchemaForCapabilities(['artifactOrEnchantmentBounce']).safeParse(
        spell({ ...PROMOTED_EFFECTS.artifactOrEnchantmentBounce, target: { kind: 'targetCreature' } }),
      ).success,
    ).toBe(false);
  });
});

describe('slot routing, prompts, and engine containment', () => {
  const fightSlot: Slot = {
    ...BASE_SLOT,
    id: 'CG01',
    color: 'G',
    cardKind: 'creature',
    role: 'creature',
    effectKinds: [],
    abilityKinds: ['triggered'],
    triggerConditions: ['selfEnters'],
    capabilities: ['fightOpposingCreature'],
  };

  it('derives flags from the batch and prints only the exact capability contract', () => {
    expect(fillCapabilitiesFor([fightSlot])).toStrictEqual(['abilities', 'fightOpposingCreature']);
    const brief = parseBrief(TEST_BRIEF);
    const prompt = buildFillPrompt({
      brief,
      slots: [fightSlot],
      rarityRules: allocateSlots(brief).profile.rarityRules,
      archetypes: [],
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
    expect(prompt).toContain(
      '- fightOpposingCreature: {"kind":"fight","target":{"kind":"targetCreatureYouDontControl"}}',
    );
    expect(prompt).not.toContain('targetPermanent');
    expect(prompt).not.toContain('chooseFromGraveyard');
  });

  it('assembles a capability-bearing model answer into an engine-valid card', () => {
    const answer = fillSchemaForCapabilities(fillCapabilitiesFor([fightSlot])).parse(
      creatureAbility({
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [PROMOTED_EFFECTS.fightOpposingCreature],
      }),
    );
    const [filled] = answer.cards;
    if (filled === undefined) throw new Error('capability schema returned no card');
    const result = assembleCard(fightSlot, filled, 'TST');
    expect(result.violations).toStrictEqual([]);
    expect(result.card?.abilities[0]).toMatchObject({
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [PROMOTED_EFFECTS.fightOpposingCreature],
    });
  });

  it('keeps every composable fill output inside the engine types at compile time', () => {
    type FilledSpellEffect = Extract<FilledCard, { kind: 'instant' }>['effects'][number];
    type FilledPermanentAbility = NonNullable<Extract<FilledCard, { kind: 'creature' }>['abilities']>[number];
    expectTypeOf<FilledSpellEffect>().toMatchTypeOf<Effect>();
    expectTypeOf<FilledPermanentAbility>().toMatchTypeOf<GeneratorModelAbility>();
  });

  for (const [capability, role, effect] of [
    [
      'controlledCreatureKeywordGrant',
      'grantControlledCreatureKeyword',
      PROMOTED_EFFECTS.controlledCreatureKeywordGrant,
    ],
    ['untapControlledCreature', 'untapControlledCreature', PROMOTED_EFFECTS.untapControlledCreature],
    [
      'artifactOrEnchantmentBounce',
      'bounceArtifactOrEnchantment',
      PROMOTED_EFFECTS.artifactOrEnchantmentBounce,
    ],
    ['ownGraveyardToHand', 'returnOwnCreatureCard', PROMOTED_EFFECTS.ownGraveyardToHand],
  ] as const) {
    it(`assembles and conforms the ${capability} spell route`, () => {
      const slot: Slot = {
        ...BASE_SLOT,
        role,
        capabilities: [capability],
        effectKinds: capability === 'artifactOrEnchantmentBounce' ? ['returnToHand'] : [],
      };
      const answer = fillSchemaForCapabilities(fillCapabilitiesFor([slot])).parse(spell(effect));
      const filled = answer.cards[0];
      if (filled === undefined) throw new Error('capability schema returned no card');
      const result = assembleCard(slot, filled, 'TST');
      expect(result.violations).toStrictEqual([]);
      if (result.card === undefined) throw new Error('capability answer did not assemble');
      expect(checkSlotConformance(slot, result.card)).toStrictEqual([]);
    });
  }

  it('assembles and conforms the complete counter-on-entry ability route', () => {
    const slot: Slot = {
      ...fightSlot,
      id: 'CG02',
      manaValueMin: 3,
      manaValueMax: 3,
      triggerConditions: ['anotherControlledCreatureEnters'],
      capabilities: ['controlledCreatureCounterOnEntry'],
    };
    const answer = fillSchemaForCapabilities(fillCapabilitiesFor([slot])).parse(
      creatureAbility({
        kind: 'triggered',
        condition: 'anotherControlledCreatureEnters',
        effects: [PROMOTED_EFFECTS.controlledCreatureCounterOnEntry],
      }),
    );
    const filled = answer.cards[0];
    if (filled === undefined) throw new Error('counter capability schema returned no card');
    const result = assembleCard(slot, filled, 'TST');
    expect(result.violations).toStrictEqual([]);
    if (result.card === undefined) throw new Error('counter capability answer did not assemble');
    expect(checkSlotConformance(slot, result.card)).toStrictEqual([]);
  });
});
