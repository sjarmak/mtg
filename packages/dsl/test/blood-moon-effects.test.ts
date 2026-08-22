/**
 * The two effects the Blood Moon beat needed and the vocabulary did not have:
 * a mass gloom sweeper and a mass reanimation.
 *
 * Both are scoped, and neither is a new shape of scope — the sweeper is
 * `putCounters` widened with the same optional `scope` `exileTarget` already
 * carries, and `returnFromGraveyard` is a new kind whose `scope` is required
 * because an unscoped return has no group to name. What is new, and what these
 * assertions exist for, is that a scope is now legal on some kinds and not
 * others: a `putCounters` reaching into a graveyard would put -1/-1 counters on
 * cards that are not permanents, and a `returnFromGraveyard` scoped to the
 * battlefield would return cards that never left. The legality table says so
 * per kind and these are the refusals.
 *
 * The printed sentence is the other half. "Exile all creatures X controls" acts
 * once on a group; "put a gloom counter on each creature X controls" repeats
 * per member, so the sweeper renders through a distributive-singular phrase.
 * Rendering it through the plural one prints one counter for a whole board,
 * which is a card that lies about what it does, and the character counts below
 * are the 140-cap check with the gloom counter's derived reminder included.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '../src/index';
import {
  isPricedEffectKind,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  validateCard,
  ZONE_REACHING_MODEL_EFFECT_KINDS,
} from '../src/index';
import { parseCard } from '../src/parse';

const GLOOM_SWEEP: Effect = {
  kind: 'putCounters',
  counter: 'gloom',
  count: 1,
  scope: 'creaturesThatPlayerControls',
  target: { kind: 'targetOpponent' },
};

const REANIMATE: Effect = {
  kind: 'returnFromGraveyard',
  scope: 'creatureCardsInPlayerGraveyard',
  target: { kind: 'targetPlayer' },
};

function sorceryInput(name: string, effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-blood-moon',
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 4, B: 2 },
    colors: ['B'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

function codesFor(effects: readonly Effect[]): readonly string[] {
  const card = sorceryInput('Blood Moon Rite', effects) as unknown as Parameters<typeof validateCard>[0];
  return validateCard(card).map((found) => found.code);
}

describe('the mass gloom sweeper', () => {
  it('parses as a scoped putCounters aimed at a player', () => {
    const card = parseCard(sorceryInput('Gloom of the Blood Moon', [GLOOM_SWEEP]));
    expect(card.kind).toBe('sorcery');
    expect(codesFor([GLOOM_SWEEP])).toEqual([]);
  });

  /**
   * Distributive, not plural. A renderer that reused the group phrase would
   * print "put a gloom counter on all creatures target opponent controls",
   * which reads as one counter shared out over a board.
   */
  it('prints one counter per creature, with the derived reminder, under the cap', () => {
    const text = renderOracleText(parseCard(sorceryInput('Gloom of the Blood Moon', [GLOOM_SWEEP])));
    expect(text).toBe(
      'Put a gloom counter on each creature target opponent controls. (A creature with a gloom counter gets -1/-1.)',
    );
    expect(text.length).toBe(108);
    expect(text.length).toBeLessThanOrEqual(140);
  });

  it('refuses a scope that names cards outside the battlefield', () => {
    for (const scope of ['creatureCardsInPlayerHand', 'creatureCardsInPlayerGraveyard'] as const) {
      expect(codesFor([{ ...GLOOM_SWEEP, scope }])).toEqual(['ILLEGAL_EFFECT_SCOPE']);
    }
  });

  it('refuses a scope aimed at a permanent slot', () => {
    expect(codesFor([{ ...GLOOM_SWEEP, target: { kind: 'targetCreature' } }])).toEqual([
      'ILLEGAL_EFFECT_SCOPE',
    ]);
  });

  /**
   * The quiet direction: a player slot with no scope names nothing the kernel
   * can put a counter on, so it resolves into silence rather than an error.
   */
  it('refuses a player slot with no scope', () => {
    const { scope: _dropped, ...unscoped } = GLOOM_SWEEP as Extract<Effect, { kind: 'putCounters' }>;
    expect(codesFor([unscoped as Effect])).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });
});

describe('mass reanimation', () => {
  it('parses and validates as a scoped return aimed at a player', () => {
    expect(codesFor([REANIMATE])).toEqual([]);
  });

  /**
   * "Under their owner's control" is printed rather than left implied, because
   * Magic's default for a put-onto-the-battlefield effect is the spell's
   * controller and the kernel's `moveObject` hands the object back to its
   * owner. A card that behaves one way and prints the other is the exact
   * failure the vocabulary exists to prevent.
   */
  it('prints the owner clause and stays under the cap', () => {
    const text = renderOracleText(parseCard(sorceryInput('Rise of the Blood Moon', [REANIMATE])));
    expect(text).toBe(
      "Return all creature cards from target player's graveyard to the battlefield under their owner's control.",
    );
    expect(text.length).toBe(104);
    expect(text.length).toBeLessThanOrEqual(140);
  });

  it('refuses any scope that does not name a graveyard', () => {
    for (const scope of ['creaturesThatPlayerControls', 'creatureCardsInPlayerHand'] as const) {
      expect(codesFor([{ ...REANIMATE, scope }])).toEqual(['ILLEGAL_EFFECT_SCOPE']);
    }
  });

  /**
   * Twice over: a creature slot is not a legal target for this kind at all,
   * and the scope has no player to read its group off. The sweeper only draws
   * the second, because `putCounters` legally targets creatures unscoped.
   */
  it('refuses a permanent slot, since the group is read off a player', () => {
    expect(codesFor([{ ...REANIMATE, target: { kind: 'targetCreature' } }])).toEqual([
      'ILLEGAL_TARGET_FOR_EFFECT',
      'ILLEGAL_EFFECT_SCOPE',
    ]);
  });
});

describe('containment', () => {
  /**
   * `mtg-q5yg` moved half of this and left the other half exactly where it was.
   * Reanimation is priced now and a slot may be allocated it, so the sentence
   * that used to read "unreachable" would be false — but only through
   * `ZoneReachingModelEffectSchema`, the union an opted-in batch is shown.
   * `ModelEffectSchema` is the default vocabulary every other batch sees, and a
   * new member there is a new byte in every recorded prompt, so what these
   * assertions guard is that the promotion did not reach it.
   *
   * The sweeper did not move at all: `putCounters` was outside the model subset
   * before the scope was added to it and is outside it still.
   */
  it('is unreachable from the default model vocabulary', () => {
    expect(MODEL_EFFECT_KINDS).not.toContain('returnFromGraveyard');
    expect(MODEL_EFFECT_KINDS).not.toContain('putCounters');
  });

  /**
   * The generatable form is the one the wider union carries, and the scope it
   * pins is the only scope this kind has. So what a slot can be allocated is a
   * mass reanimation of one player's graveyard and nothing else; the sweeper
   * scope stays a hand-authored reach, because `putCounters` has no
   * model-facing member at any tier.
   */
  it('offers reanimation to an opted-in batch and the gloom sweep to nobody', () => {
    expect(ZONE_REACHING_MODEL_EFFECT_KINDS).toContain('returnFromGraveyard');
    expect(ZONE_REACHING_MODEL_EFFECT_KINDS).not.toContain('putCounters');
  });

  it('prices returnFromGraveyard, which is what lets a slot be allocated it', () => {
    expect(isPricedEffectKind('returnFromGraveyard')).toBe(true);
  });
});
