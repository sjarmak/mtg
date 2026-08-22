import { describe, expect, it } from 'vitest';
import type { Effect, EffectKind, EffectScope } from '@mtg/dsl';
import {
  EFFECT_KINDS,
  hasViolation,
  LEGAL_TARGETS,
  mana,
  validateCard,
  ZoneReachingModelEffectSchema,
} from '@mtg/dsl';
import type { Slot } from '@mtg/setgen';
import { allocateSlots, buildCritiquePrompt, buildFillPrompt, EFFECT_RANGES, parseBrief } from '@mtg/setgen';
import { synthesizeCard, TEST_BRIEF } from './helpers';
import { assembleCard } from '@mtg/setgen';

const brief = parseBrief(TEST_BRIEF);
const allocation = allocateSlots(brief);

/**
 * The numeric bounds `EFFECT_RANGES` promises the model, restated as data. Both
 * halves are asserted below: the prompt text has to name these numbers, and the
 * DSL validators have to accept them. Either side drifting fails this test.
 */
const BOUNDS: ReadonlyArray<{
  readonly kind: EffectKind;
  readonly min: number;
  readonly max: number;
  readonly build: (value: number) => Effect;
}> = [
  {
    kind: 'dealDamage',
    min: 1,
    max: 12,
    build: (amount) => ({ kind: 'dealDamage', amount, target: { kind: 'anyTarget' } }),
  },
  {
    kind: 'drawCards',
    min: 1,
    max: 6,
    build: (count) => ({ kind: 'drawCards', count, target: { kind: 'noTarget' } }),
  },
  {
    kind: 'gainLife',
    min: 1,
    max: 20,
    build: (amount) => ({ kind: 'gainLife', amount, target: { kind: 'noTarget' } }),
  },
  {
    kind: 'millCards',
    min: 1,
    max: 20,
    build: (count) => ({ kind: 'millCards', count, target: { kind: 'targetPlayer' } }),
  },
  {
    kind: 'createToken',
    min: 1,
    max: 8,
    build: (count) => ({
      kind: 'createToken',
      count,
      token: { name: 'Shard', power: 1, toughness: 1, colors: ['R'], subtypes: ['Elemental'], keywords: [] },
    }),
  },
];

/** Deliberately unparsed: out-of-range probes must reach the validators, not throw. */
function spellWithEffects(effects: readonly Effect[]): unknown {
  return {
    id: 'tst-range-probe',
    name: 'Range Probe',
    kind: 'instant',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['R'],
    manaCost: mana({ generic: 1, R: 1 }),
    effects: [...effects],
  };
}

function spellWith(effect: Effect): unknown {
  return spellWithEffects([effect]);
}

describe('EFFECT_RANGES stays in step with the DSL validators', () => {
  it('states a range for every effect kind', () => {
    for (const [kind, text] of Object.entries(EFFECT_RANGES)) {
      expect(text.length, kind).toBeGreaterThan(0);
    }
  });

  for (const bound of BOUNDS) {
    it(`${bound.kind}: the prompt names ${bound.min}-${bound.max} and the validators accept it`, () => {
      expect(EFFECT_RANGES[bound.kind]).toContain(`${bound.min}-${bound.max}`);
      expect(validateCard(spellWith(bound.build(bound.min)))).toStrictEqual([]);
      expect(validateCard(spellWith(bound.build(bound.max)))).toStrictEqual([]);
      expect(
        hasViolation(validateCard(spellWith(bound.build(bound.max + 1))), 'EFFECT_PARAM_OUT_OF_RANGE'),
      ).toBe(true);
    });
  }

  it('pump deltas hold at the stated -8..+8 bound', () => {
    expect(EFFECT_RANGES.pumpUntilEndOfTurn).toContain('-8..+8');
    const pump = (power: number): Effect => ({
      kind: 'pumpUntilEndOfTurn',
      power,
      toughness: 1,
      target: { kind: 'targetCreature' },
    });
    expect(validateCard(spellWith(pump(8)))).toStrictEqual([]);
    expect(hasViolation(validateCard(spellWith(pump(9))), 'EFFECT_PARAM_OUT_OF_RANGE')).toBe(true);
  });
});

/**
 * The effect budget a slot is offered, per allowed-kind list.
 *
 * `combatTrick` is a role with no substitution note, so the rendered slot block
 * is the slot line and the budget line and nothing else.
 */
function budgetLineFor(effectKinds: readonly EffectKind[]): string {
  const slot: Slot = {
    id: 'CR09',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'R',
    cardKind: 'instant',
    role: 'combatTrick',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds,
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
  const prompt = buildFillPrompt({
    brief,
    slots: [slot],
    rarityRules: allocation.profile.rarityRules,
    archetypes: allocation.archetypes,
    priorNames: [],
    sameColorCards: [],
    tierCards: [],
    corrections: new Map(),
    revisions: new Map(),
  });
  const line = prompt.split('\n').find((text) => text.startsWith('  effects:'));
  if (line === undefined) throw new Error(`no effect budget line for [${effectKinds.join('|')}]`);
  return line;
}

/**
 * Kinds whose entire legal space is one effect: nothing to vary and at most one
 * legal target. `only` is that effect, written out so the claim is checkable
 * rather than asserted.
 */
const ONE_EFFECT_KINDS: ReadonlyArray<{
  readonly kind: EffectKind;
  readonly only: Effect;
  /**
   * A scope the generatable member of this kind refuses, present only on the
   * kind that carries a `scope` field at all. It is what turns "the model has
   * no choice here" from a sentence into a check.
   */
  readonly refusedScope?: EffectScope;
}> = [
  { kind: 'destroyPermanent', only: { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } },
  { kind: 'tapPermanent', only: { kind: 'tapPermanent', target: { kind: 'targetCreature' } } },
  { kind: 'returnToHand', only: { kind: 'returnToHand', target: { kind: 'targetCreature' } } },
  { kind: 'counterSpell', only: { kind: 'counterSpell' } },
  { kind: 'exileTarget', only: { kind: 'exileTarget', target: { kind: 'targetCreature' } } },
  {
    kind: 'returnFromGraveyard',
    only: {
      kind: 'returnFromGraveyard',
      scope: 'creatureCardsInPlayerGraveyard',
      target: { kind: 'targetPlayer' },
    },
    refusedScope: 'creaturesThatPlayerControls',
  },
];

/** Kinds a designer can write twice without repeating, with a pair that proves it. */
const TWO_EFFECT_KINDS: ReadonlyArray<{
  readonly kind: EffectKind;
  readonly pair: readonly [Effect, Effect];
}> = [
  {
    kind: 'dealDamage',
    pair: [
      { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } },
      { kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } },
    ],
  },
  {
    kind: 'pumpUntilEndOfTurn',
    pair: [
      { kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } },
      { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 3, target: { kind: 'targetCreature' } },
    ],
  },
  {
    // Two entries really can differ: the counter kind is a field of the effect,
    // so a card may place two different parts on one creature. The model's own
    // schema does not carry this primitive yet, and the budget line still has
    // to be right for the brief that names it as a mechanic effect kind.
    kind: 'putCounters',
    pair: [
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
      { kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } },
    ],
  },
  {
    kind: 'drawCards',
    pair: [
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } },
    ],
  },
  {
    // The only kind in the vocabulary with neither a target nor a scope, so the
    // count is the whole of what two entries can differ by.
    kind: 'scry',
    pair: [
      { kind: 'scry', count: 1 },
      { kind: 'scry', count: 3 },
    ],
  },
  {
    kind: 'gainLife',
    pair: [
      { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      { kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } },
    ],
  },
  {
    kind: 'millCards',
    pair: [
      { kind: 'millCards', count: 2, target: { kind: 'targetPlayer' } },
      { kind: 'millCards', count: 4, target: { kind: 'targetPlayer' } },
    ],
  },
  {
    kind: 'createToken',
    pair: [
      {
        kind: 'createToken',
        count: 1,
        token: {
          name: 'Shard',
          power: 2,
          toughness: 2,
          colors: ['R'],
          subtypes: ['Elemental'],
          keywords: [],
        },
      },
      {
        kind: 'createToken',
        count: 2,
        token: {
          name: 'Shard',
          power: 1,
          toughness: 1,
          colors: ['R'],
          subtypes: ['Elemental'],
          keywords: [],
        },
      },
    ],
  },
];

/**
 * The slot spec may not ask for a card the DSL would reject.
 *
 * "1-2 entries, each of kind X" for a kind with no parameters and one legal
 * target has one answer with two entries, and it is a repeat — which
 * `DUPLICATE_EFFECT` refuses. Both halves are proved against the validators
 * here: the two-entry kinds get a pair the DSL accepts, and the one-entry kinds
 * get the repeat it refuses.
 */
describe('the effect budget a slot spec offers', () => {
  it('classifies every effect kind in the DSL vocabulary', () => {
    const classified = [...ONE_EFFECT_KINDS, ...TWO_EFFECT_KINDS].map((entry) => entry.kind).sort();
    expect(classified).toStrictEqual([...EFFECT_KINDS].sort());
  });

  for (const { kind, only, refusedScope } of ONE_EFFECT_KINDS) {
    it(`${kind}: asks for exactly one entry, because a second could only repeat it`, () => {
      expect(LEGAL_TARGETS[kind].length).toBeLessThanOrEqual(1);
      expect(
        Object.keys(only).filter((field) => field !== 'kind' && field !== 'target' && field !== 'scope'),
      ).toStrictEqual([]);
      if (refusedScope === undefined) {
        expect(Object.keys(only)).not.toContain('scope');
      } else {
        // `scope` is a field and not a choice. The generatable member pins it
        // to one value, so two entries of this kind still cannot differ by it,
        // and the refusal is what makes that a fact about the schema rather
        // than a sentence in the prompt.
        expect(ZoneReachingModelEffectSchema.safeParse(only).success).toBe(true);
        expect(ZoneReachingModelEffectSchema.safeParse({ ...only, scope: refusedScope }).success).toBe(false);
      }

      expect(budgetLineFor([kind])).toBe(
        `  effects: exactly 1 entry, of kind ${kind} - a second entry could only repeat the first, which the DSL rejects`,
      );
      expect(validateCard(spellWithEffects([only]))).toStrictEqual([]);
      expect(hasViolation(validateCard(spellWithEffects([only, only])), 'DUPLICATE_EFFECT')).toBe(true);
    });
  }

  for (const { kind, pair } of TWO_EFFECT_KINDS) {
    it(`${kind}: keeps the 1-2 budget, and two entries of it really can differ`, () => {
      expect(budgetLineFor([kind])).toBe(`  effects: 1-2 entries, each of kind ${kind}`);
      expect(validateCard(spellWithEffects(pair))).toStrictEqual([]);
    });
  }

  it('keeps the 1-2 budget when the slot allows more than one kind', () => {
    expect(budgetLineFor(['destroyPermanent', 'tapPermanent'])).toBe(
      '  effects: 1-2 entries, each of kind destroyPermanent or tapPermanent',
    );
  });
});

describe('buildFillPrompt', () => {
  const batch = allocation.slots.slice(0, 3);

  it('states the brief, every slot, and the effects those slots may use', () => {
    const prompt = buildFillPrompt({
      brief,
      slots: batch,
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map(),
    });
    expect(prompt).toContain('Testing Shoals');
    expect(prompt).toContain('Skywake');
    for (const slot of batch) expect(prompt).toContain(slot.id);
    expect(prompt).not.toContain('<corrections>');
    expect(prompt).not.toContain('<design_review>');
  });

  it('carries validator feedback for exactly the slot that failed', () => {
    const target = batch[0];
    if (target === undefined) throw new Error('allocation produced no slots');
    const prompt = buildFillPrompt({
      brief,
      slots: batch,
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: ['Tideglass Adept'],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map([[target.id, ['SLOT_MANA_VALUE_MISS: costs 5, needs 2']]]),
      revisions: new Map(),
    });
    expect(prompt).toContain('<corrections>');
    expect(prompt).toContain('SLOT_MANA_VALUE_MISS');
    expect(prompt).toContain('Tideglass Adept');
  });

  it('carries a design-review instruction when revising', () => {
    const target = batch[0];
    if (target === undefined) throw new Error('allocation produced no slots');
    const prompt = buildFillPrompt({
      brief,
      slots: [target],
      rarityRules: allocation.profile.rarityRules,
      archetypes: allocation.archetypes,
      priorNames: [],
      sameColorCards: [],
      tierCards: [],
      corrections: new Map(),
      revisions: new Map([[target.id, 'Rename it around tide and glass.']]),
    });
    expect(prompt).toContain('<design_review>');
    expect(prompt).toContain('Rename it around tide and glass.');
  });
});

describe('buildCritiquePrompt', () => {
  it('lists every printed card and the archetype pairs the sim will run', () => {
    const entries = allocation.slots.slice(0, 4).map((slot) => {
      const assembly = assembleCard(slot, synthesizeCard(slot), brief.setCode);
      if (assembly.card === undefined) throw new Error(`could not synthesize ${slot.id}`);
      return { slot, card: assembly.card };
    });
    const prompt = buildCritiquePrompt({ brief, entries, archetypePairs: ['WU', 'BR'] });
    for (const entry of entries) expect(prompt).toContain(entry.card.name);
    expect(prompt).toContain('WU, BR');
    expect(prompt).toContain('<set>');
  });
});

describe('the signpost sentence and the rarity it names', () => {
  /**
   * The prompt tells a signpost slot it is "the uncommon that advertises the
   * pair's plan", and that word is correct only because `candidatesFor` filters
   * to `rarity === 'uncommon'`. Nothing else keeps the two in step, so a lane
   * that let a signpost land on a rare would leave the prompt calling a rare an
   * uncommon and no test would say so (`mtg-u0ub`).
   *
   * The sentence is deliberately not parameterized. Prompt bytes are a fixture
   * key — `@mtg/llm` hashes system, prompt and schema together — so rewording it
   * re-records every run behind it, and the word is not wrong today. This is the
   * guard that makes it go red the day it becomes wrong, which is what a latent
   * bug is owed instead of a re-record.
   */
  it('assigns a signpost only at the rarity the prompt sentence names', () => {
    for (const size of [90, 125, 250]) {
      const sized = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: size }));
      const signposts = sized.slots.filter((slot) => slot.signpost);
      expect(signposts.length, `no signpost at ${size}`).toBeGreaterThan(0);
      expect(
        signposts.filter((slot) => slot.rarity !== 'uncommon').map((slot) => slot.id),
        `signposts outside uncommon at ${size}`,
      ).toStrictEqual([]);
    }
  });
});
