/**
 * `selfPermanent`: the ability's own source, named as a permanent rather than
 * as a creature, so an artifact can put a counter on itself (`mtg-rji`).
 *
 * the flagship set's Trisigil cycle is three `Legendary Artifact — Trisigil`
 * cards, each of which accrues its own counter until the third arrives. Before
 * this kind the vocabulary could not print any of them, and the gap was two
 * independent walls rather than one. `EFFECT_RULES.putCounters` named
 * `targetCreature` and `targetCreatureYouControl` and no kind that reaches the
 * source at all; and `selfCreature`, the kind that does reach the source, is
 * refused on a card that is not a creature (`checkSelfCreatureTarget`) because
 * it prints the word "creature".
 *
 * So this is the same retained referent `selfCreature` already is — CR 115.6a,
 * an object referring to itself is not targeting itself, filled from the
 * ability's own `sourceOid` — with the creature word taken out of both the
 * printed phrase and the permission. What is left needs no card-kind gate of
 * its own: `checkPlacement` (`validate/abilities.ts`) already refuses an
 * ability on an instant or a sorcery, so every card that can print this kind
 * inside an ability is a permanent, and the only refusal left to write is the
 * spell one — an instant's own `effects` list, where `checkEffectTarget`
 * refuses `selfCreature` for the identical reason.
 *
 * It is legal on `putCounters` and on nothing else, which is `LEGAL_TARGETS`'
 * decision and follows the rule the rest of the vocabulary follows: a widening
 * arrives with the card that needs it. The two effects that admit
 * `selfCreature` keep it alone, so no effect kind admits both and there is no
 * second spelling of one card.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, TargetKind } from '../src/index';
import {
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  HAND_AUTHORED_TARGETS,
  LEGAL_TARGETS,
  MODEL_TARGET_KINDS,
  TARGET_KINDS,
  counterReminderText,
  isSourceBodyOnlyTarget,
  legalTargetsFor,
  renderOracleText,
  restrictionFitsTargetKind,
  safeParseCard,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { ModelTargetSpecSchema, targetKindsCanCollide } from '../src/targets';

const SELF_PERMANENT_KIND: TargetKind = 'selfPermanent';

/** "At the beginning of your upkeep, put a Trisigil counter on this permanent." */
const UPKEEP_ACCRUAL: AbilityInput = {
  kind: 'triggered',
  condition: 'beginningOfYourUpkeep',
  effects: [{ kind: 'putCounters', counter: 'trisigil', count: 1, target: { kind: SELF_PERMANENT_KIND } }],
};

function trisigilInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'xmp-trisigil-of-power',
    name: 'Trisigil of Power',
    rarity: 'mythic',
    set: { code: 'XMP', collectorNumber: 300 },
    manaCost: { generic: 3 },
    supertypes: ['legendary'],
    subtypes: ['Trisigil'],
    abilities: [UPKEEP_ACCRUAL],
    ...overrides,
  };
}

function instantInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-selfpermanent-bolt',
    name: 'Probe Bolt',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 301 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [],
    ...overrides,
  };
}

describe("the targeting mode that names the ability's own source as a permanent", () => {
  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(SELF_PERMANENT_KIND);
    expect([...MODEL_TARGET_KINDS]).not.toContain(SELF_PERMANENT_KIND);
    expect([...TARGET_KINDS].slice(0, MODEL_TARGET_KINDS.length)).toEqual([...MODEL_TARGET_KINDS]);
    expect(ModelTargetSpecSchema.safeParse({ kind: SELF_PERMANENT_KIND }).success).toBe(false);
  });

  it('is hand-authored on putCounters, the only row it answers', () => {
    expect(HAND_AUTHORED_TARGETS['putCounters']).toContain(SELF_PERMANENT_KIND);
    expect(legalTargetsFor('putCounters')).toContain(SELF_PERMANENT_KIND);
    // The generatable half is untouched, so the fill prompt's printed list and
    // every fixture keyed to those bytes stay exactly where they were.
    expect(LEGAL_TARGETS.putCounters).toEqual(['targetCreature', 'targetCreatureYouControl']);
  });

  it('reaches no other effect kind, so no card can spell one sentence two ways', () => {
    const rows = Object.keys(LEGAL_TARGETS) as (keyof typeof LEGAL_TARGETS)[];
    const reached = rows.filter((kind) => legalTargetsFor(kind).includes(SELF_PERMANENT_KIND));
    expect(reached).toEqual(['putCounters']);
    expect(legalTargetsFor('pumpUntilEndOfTurn')).not.toContain(SELF_PERMANENT_KIND);
    expect(legalTargetsFor('putCounters')).not.toContain('selfCreature');
  });

  it('prints the Trisigil cycle, counter and all', () => {
    const card = parseCard(trisigilInput() as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'At the beginning of your upkeep, put a Trisigil counter on this permanent.',
    );
  });

  it('is legal on every permanent card kind an ability can be printed on', () => {
    const creatureCard = parseCard({
      kind: 'creature',
      id: 'xmp-selfpermanent-bear',
      name: 'Probe Bear',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 302 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      subtypes: ['Bear'],
      keywords: [],
      power: 2,
      toughness: 2,
      abilities: [UPKEEP_ACCRUAL],
    } as CardInput);
    expect(validateCard(creatureCard)).toEqual([]);

    const enchantmentCard = parseCard({
      kind: 'enchantment',
      id: 'xmp-selfpermanent-shrine',
      name: 'Probe Shrine',
      rarity: 'rare',
      set: { code: 'XMP', collectorNumber: 303 },
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      abilities: [UPKEEP_ACCRUAL],
    } as CardInput);
    expect(validateCard(enchantmentCard)).toEqual([]);
  });

  it('is refused on a spell, which has no source permanent for "this permanent" to name', () => {
    const result = safeParseCard(
      instantInput({
        effects: [
          { kind: 'putCounters', counter: 'trisigil', count: 1, target: { kind: SELF_PERMANENT_KIND } },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('is a source-body kind, so no instrument offers it on a spell shape', () => {
    expect(isSourceBodyOnlyTarget(SELF_PERMANENT_KIND)).toBe(true);
  });

  it('carries no restriction and collides with nothing, the footing every retained referent has', () => {
    expect(restrictionFitsTargetKind(SELF_PERMANENT_KIND)).toBe(false);
    expect(targetKindsCanCollide(SELF_PERMANENT_KIND, 'targetPermanent')).toBe(false);
    expect(targetKindsCanCollide(SELF_PERMANENT_KIND, SELF_PERMANENT_KIND)).toBe(false);
  });
});

describe('the Trisigil counter', () => {
  it('is a marker counter: it modifies nothing and prints no reminder', () => {
    expect(COUNTER_KINDS).toContain('trisigil');
    expect(COUNTER_DECLARATIONS.trisigil.printName).toBe('Trisigil');
    expect(counterReminderText('trisigil')).toBeNull();
  });
});
