/**
 * The four sweepers: `dealDamage`, `destroyPermanent`, `pumpUntilEndOfTurn` and
 * `tapPermanent` with a `scope`.
 *
 * `effect-scope.test.ts` argues the mechanism on `exileTarget`, which is where
 * it was built. This file is about the four primitives that were widened onto
 * it, and the reason they need their own assertions is that they are the priced
 * ones. `exileTarget` is unpriced and unreachable from a slot menu; these four
 * are the vocabulary a generated card is actually made of, so the pairing rule
 * and the printed sentence are load-bearing in a way they were not before.
 *
 * The printed sentence is the half worth watching. A sweeper's subject is
 * plural and its unscoped pair's is singular, and English does not let one
 * template carry both: "all creatures ... get" against "target creature ...
 * gets", and damage distributing over "each creature" rather than collecting
 * into "all creatures". A renderer that reached for one shape would print a
 * card that reads as a different card than the one that resolves.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '../src/index';
import { legalTargetsFor, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

const BATTLEFIELD = 'creaturesThatPlayerControls' as const;

function sorceryInput(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-calamity',
    name: 'Calamity',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 4, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

function oracleOf(effects: readonly Effect[]): string {
  const card = parseCard(sorceryInput(effects));
  expect(validateCard(card)).toEqual([]);
  return renderOracleText(card);
}

function codesFor(effects: readonly Effect[]): readonly string[] {
  const card = sorceryInput(effects) as unknown as Parameters<typeof validateCard>[0];
  return validateCard(card).map((found) => found.code);
}

describe('the sweeping half of each priced primitive', () => {
  /**
   * Damage is the one that does not collect. Each creature is dealt its own
   * amount by its own damage event (CR 120.3 simultaneous, but still one
   * instance per recipient), so the sentence distributes: "each creature", not
   * "all creatures". The other three act on the group as a group and read the
   * other way.
   */
  it('distributes damage over each member and collects the other three', () => {
    expect(
      oracleOf([{ kind: 'dealDamage', amount: 3, scope: BATTLEFIELD, target: { kind: 'targetOpponent' } }]),
    ).toBe('Calamity deals 3 damage to each creature target opponent controls.');
    expect(
      oracleOf([{ kind: 'destroyPermanent', scope: BATTLEFIELD, target: { kind: 'targetPlayer' } }]),
    ).toBe('Destroy all creatures target player controls.');
    expect(oracleOf([{ kind: 'tapPermanent', scope: BATTLEFIELD, target: { kind: 'targetOpponent' } }])).toBe(
      'Tap all creatures target opponent controls.',
    );
  });

  /**
   * A plural subject takes a plural verb, and the pump renderer is the only one
   * of the four whose verb is inflected at all. It had one form, written for
   * the single target it used to be the only shape of.
   */
  it('conjugates the pump for a plural subject', () => {
    expect(
      oracleOf([
        {
          kind: 'pumpUntilEndOfTurn',
          power: 3,
          toughness: 3,
          scope: BATTLEFIELD,
          target: { kind: 'targetPlayer' },
        },
      ]),
    ).toBe('All creatures target player controls get +3/+3 until end of turn.');
    expect(
      oracleOf([{ kind: 'pumpUntilEndOfTurn', power: 3, toughness: 3, target: { kind: 'targetCreature' } }]),
    ).toBe('Target creature gets +3/+3 until end of turn.');
  });

  /**
   * A one-sided wrath is a card aimed either way. `targetPlayer` lets it hit
   * the caster's own board, which is a legal play and occasionally the right
   * one; `targetOpponent` is the ordinary printing. Both are on the row and
   * neither is generatable, because the fill prompt prints the generatable list
   * verbatim and every recorded fixture is keyed to those bytes.
   *
   * `noTarget` is on three of the four rows and is the *board* sweep's slot
   * rather than a targeted one's: "destroy all creatures" chooses nothing (CR
   * 115.1), so the spec has to be able to say so. `tapPermanent` does not carry
   * it, because no printed tapper in the population reads a region of the board
   * — every one of them names a player (`board-sweep.test.ts` has the census).
   *
   * `destroyPermanent` carries two kinds that are not sweepers at all:
   * Disenchant's "target artifact or enchantment" and the filtered
   * whole-board space (`mtg-6y4g`), both unscoped and both naming one
   * permanent. They are asserted here so the sweeper widening and the
   * board-answer widening cannot be confused for each other.
   */
  it('admits both player slots on every sweeper and no other new one', () => {
    expect([...legalTargetsFor('destroyPermanent')].sort()).toEqual([
      'noTarget',
      'targetArtifactOrEnchantment',
      'targetCreature',
      'targetOpponent',
      'targetPermanent',
      'targetPlayer',
    ]);
    // `thatCreature` on this row is the back-reference Stabbing Pain (M11 #118)
    // needs to tap the creature it just shrank, and like `selfCreature` below
    // it predates none of the sweeper widening: it is pinned here because this
    // is the one place the row's full membership is stated.
    expect([...legalTargetsFor('tapPermanent')].sort()).toEqual([
      'targetCreature',
      'targetOpponent',
      'targetPlayer',
      'thatCreature',
    ]);
    // `selfCreature` on this row predates the sweeper widening and is
    // unrelated to it: it is the retained-referent kind that means "this
    // creature" (`self-creature-target.test.ts`), asserted here only because
    // this is the one place the row's full membership is pinned.
    expect([...legalTargetsFor('pumpUntilEndOfTurn')].sort()).toEqual([
      'noTarget',
      'selfCreature',
      'targetCreature',
      'targetCreatureDefendingPlayerControls',
      'targetOpponent',
      'targetPlayer',
    ]);
    expect([...legalTargetsFor('dealDamage')].sort()).toEqual([
      'anyTarget',
      'noTarget',
      'targetCreature',
      'targetOpponent',
      'targetPlayer',
      'targetPlayerOrPlaneswalker',
      'thatCreaturesController',
    ]);
  });

  /**
   * The two directions the pairing rule refuses. The visible mistake is a scope
   * on a creature slot; the quiet one is a player slot with no scope, which
   * parses, sits on a legal row, and resolves into nothing at all because the
   * kernel would look for a permanent and find a player.
   *
   * The second list is three of the four, not four. `dealDamage` acts on
   * whatever it is aimed at and a player is one of those things, which the test
   * below this one is about.
   */
  it('refuses a scope on a permanent slot and a player slot with no scope', () => {
    const scopedAtACreature: readonly Effect[] = [
      { kind: 'dealDamage', amount: 2, scope: BATTLEFIELD, target: { kind: 'targetCreature' } },
      { kind: 'destroyPermanent', scope: BATTLEFIELD, target: { kind: 'targetCreature' } },
      { kind: 'tapPermanent', scope: BATTLEFIELD, target: { kind: 'targetCreature' } },
      {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 1,
        scope: BATTLEFIELD,
        target: { kind: 'targetCreature' },
      },
    ];
    const playerWithNoScope: readonly Effect[] = [
      { kind: 'destroyPermanent', target: { kind: 'targetPlayer' } },
      { kind: 'tapPermanent', target: { kind: 'targetOpponent' } },
      { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetPlayer' } },
    ];
    for (const effect of scopedAtACreature) {
      expect(codesFor([effect]), effect.kind).toContain('ILLEGAL_EFFECT_SCOPE');
    }
    for (const effect of playerWithNoScope) {
      expect(codesFor([effect]), effect.kind).toContain('ILLEGAL_EFFECT_SCOPE');
    }
  });

  /**
   * `dealDamage` is the exception to the quiet half, and it has to be: "deals 3
   * damage to target player" is a whole card and was one long before a scope
   * existed. Widening the primitive nearly took it away — the missing-scope
   * rule reads off "carries a scope field", every burn spell aimed at a player
   * suddenly carried one, and the rule refused them all. `anyTarget` hid it,
   * because that slot does not name a player and so bolts kept validating.
   */
  it('leaves unscoped damage at a player alone, because that is a real card', () => {
    expect(oracleOf([{ kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } }])).toBe(
      'Calamity deals 3 damage to target player.',
    );
    expect(oracleOf([{ kind: 'dealDamage', amount: 3, target: { kind: 'targetOpponent' } }])).toBe(
      'Calamity deals 3 damage to target opponent.',
    );
    expect(oracleOf([{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }])).toBe(
      'Calamity deals 3 damage to any target.',
    );
  });

  it('leaves every unscoped form printing exactly what it printed before', () => {
    expect(oracleOf([{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }])).toBe(
      'Destroy target creature.',
    );
    expect(oracleOf([{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }])).toBe(
      'Tap target creature.',
    );
    expect(oracleOf([{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }])).toBe(
      'Calamity deals 3 damage to target creature.',
    );
  });

  /**
   * The scopes that name a hand or a graveyard are refused on all four, and for
   * four different reasons rather than one shared one: damage is marked on a
   * permanent, destruction is a move off the battlefield, a P/T modification is
   * a layer-7c effect the layer system does not apply off it (CR 611.2c), and
   * tapped is a status only a permanent has (CR 110.5).
   */
  it('refuses the zones a sweeper has nothing to say about', () => {
    expect(
      codesFor([
        {
          kind: 'destroyPermanent',
          scope: 'creatureCardsInPlayerGraveyard',
          target: { kind: 'targetOpponent' },
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
    expect(
      codesFor([
        { kind: 'tapPermanent', scope: 'creatureCardsInPlayerHand', target: { kind: 'targetOpponent' } },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });
});
