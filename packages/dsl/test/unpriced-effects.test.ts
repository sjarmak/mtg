/**
 * The half of the effect vocabulary the color pie has not ruled on.
 *
 * `EFFECT_KINDS` stopped being "every effect kind" and became "every effect
 * kind two packages outside this one are keyed by", and that is a claim worth
 * a file because both keyings are load-bearing and neither is obvious:
 *
 *  - `@mtg/design-data` builds `COLOR_PIE_SUBJECTS` as
 *    `[...KEYWORDS, ...EFFECT_KINDS]` and its document schema *refuses to
 *    load* without a row per subject. Adding a name to the tuple without
 *    researching a sourced row is a package that throws on import.
 *  - `@mtg/setgen`'s `EFFECT_RANGES` is a total `Record<EffectKind, string>` of
 *    prompt text, so the same name is a compile error in the fill prompt.
 *
 * Neither is a question about whether the kernel can run the effect, which is
 * why the split exists. The assertions below are the properties that make it
 * safe: the two halves are disjoint, together they are exactly what an `Effect`
 * can carry, nothing unpriced is generatable, and the prompt-facing tables are
 * unmoved.
 */
import { describe, expect, it } from 'vitest';
import type { AnyEffectKind, CardInput, Effect } from '../src/index';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  isPricedEffectKind,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-void-call',
    name: 'Void Call',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 1 },
    colors: ['W'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

describe('the unpriced half of the effect vocabulary', () => {
  it('is disjoint from the priced half and completes it', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    for (const kind of UNPRICED_EFFECT_KINDS) {
      expect(priced, kind).not.toContain(kind);
    }
    expect([...ALL_EFFECT_KINDS].sort()).toEqual([...EFFECT_KINDS, ...UNPRICED_EFFECT_KINDS].sort());
    expect(ALL_EFFECT_KINDS).toHaveLength(EFFECT_KINDS.length + UNPRICED_EFFECT_KINDS.length);
  });

  /**
   * The freeze, and the reason the tuple is appended to rather than inserted
   * into: `EFFECT_KINDS` is what two other packages index, so its members and
   * their order are the thing that must not move.
   */
  it('leaves the priced tuple where it was, in order', () => {
    expect([...ALL_EFFECT_KINDS].slice(0, EFFECT_KINDS.length)).toEqual([...EFFECT_KINDS]);
  });

  it('is not generatable, derived rather than asserted', () => {
    const generatable: readonly string[] = MODEL_EFFECT_KINDS;
    for (const kind of UNPRICED_EFFECT_KINDS) {
      expect(generatable, kind).not.toContain(kind);
      expect(isPricedEffectKind(kind), kind).toBe(false);
    }
    for (const kind of EFFECT_KINDS) {
      expect(isPricedEffectKind(kind), kind).toBe(true);
    }
  });

  it('still gets a targeting rule, because the validator is total over both halves', () => {
    for (const kind of ALL_EFFECT_KINDS) {
      expect(legalTargetsFor(kind as AnyEffectKind), kind).toBeDefined();
    }
    // Two kinds on one row because `scope` splits the primitive in two;
    // `effect-scope.test.ts` holds the rule that decides which half a card is.
    // The last two are unscoped and name a permanent: Altar's Light, and the
    // filtered whole-board space this era's exile spells draw from.
    expect(legalTargetsFor('exileTarget')).toEqual([
      'targetCreature',
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
    ]);
    // A hand is somebody's, and narrowly an opponent's: "reveal your own hand"
    // is a clause no card here wants.
    expect(legalTargetsFor('revealHand')).toEqual(['targetOpponent']);
  });
});

/**
 * CR 701.16a. Revealing is an action, so the DSL's whole contribution is a
 * primitive with a target and a sentence; the kernel's is one event and no
 * state (`packages/kernel/test/reveal-hand.test.ts` holds that half).
 */
describe('revealing a hand', () => {
  it('validates and prints Magic sentence', () => {
    const card = parseCard(sorceryInput([{ kind: 'revealHand', target: { kind: 'targetOpponent' } }]));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Target opponent reveals their hand.');
  });

  it('cannot be aimed at a creature, because a creature has no hand', () => {
    const card = sorceryInput([
      { kind: 'revealHand', target: { kind: 'targetCreature' } },
    ]) as unknown as Parameters<typeof validateCard>[0];
    expect(validateCard(card).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * The pairing that made the card: reveal, then take what the reveal showed.
   * Two sentences, one target each, and in a two-player game both name the same
   * person — which is why the printed card can say "that player" where the DSL
   * says "target opponent" twice.
   */
  it('reads beside a hand sweep as one paragraph', () => {
    const card = parseCard(
      sorceryInput([
        { kind: 'revealHand', target: { kind: 'targetOpponent' } },
        {
          kind: 'exileTarget',
          scope: 'creatureCardsInPlayerHand',
          target: { kind: 'targetOpponent' },
        },
      ]),
    );
    expect(validateCard(card)).toEqual([]);
    // "from it" once the hand has been revealed, which is Magic's own wording
    // and the reason `renderEffectList` computes back-references over the list
    // rather than per effect.
    expect(renderOracleText(card)).toBe(
      'Target opponent reveals their hand. Exile all creature cards from it.',
    );
  });
});

describe('exiling a single permanent', () => {
  it('validates clean and prints Magic sentence', () => {
    const card = parseCard(sorceryInput([{ kind: 'exileTarget', target: { kind: 'targetCreature' } }]));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Exile target creature.');
  });

  it('cannot be aimed at a player', () => {
    const card = sorceryInput([
      { kind: 'exileTarget', target: { kind: 'targetPlayer' } },
    ]) as unknown as Parameters<typeof validateCard>[0];
    expect(validateCard(card).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * Two removal spells that differ only in where the creature goes are two
   * different cards, and `checkDuplicateEffects` compares by `canonicalJson`,
   * so this is also the guard that the kind is a real discriminant rather than
   * a flag on the destroy arm.
   */
  it('is a different effect from destroying the same creature', () => {
    const card = parseCard(
      sorceryInput([
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'exileTarget', target: { kind: 'targetCreature' } },
      ]),
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Destroy target creature. Exile target creature.');
  });
});
