/**
 * An Aura whose bonus is a rate over the board: CR 613.4c, layer 7c, with the
 * count left live.
 *
 * Two M11 Auras are the subjects because they are the two readings that come
 * apart. Armored Ascension adds; Quag Sickness subtracts, and a sign error in
 * the layer walk would show up on exactly one of them. Both say "you control",
 * and "you" is the Aura's controller rather than the enchanted creature's --
 * a difference that is invisible on your own creature and is the whole card on
 * somebody else's, which is why the subtracting subject is put on the other
 * side of the table here.
 *
 * The rate is a static rather than a one-shot, so the count is re-read on every
 * layer walk. A land leaving the battlefield after the Aura resolved therefore
 * moves the body, and a test that only measured the attachment would pass on an
 * implementation that resolved the count once and kept the number.
 *
 * Both Auras are cast rather than placed, because an Aura placed on a
 * battlefield attached to nothing is put into its graveyard by CR 704.5n before
 * a test can read anything off it.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, validateCards, type Card } from '@mtg/dsl';
import {
  beginTrace,
  hasKeyword,
  moveObject,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { creature, lands, PLAINS, SWAMP } from './cards';
import { oidOf, oidsOf } from './helpers';

/** `Enchanted creature gets +1/+1 for each Plains you control and has flying.` -- Armored Ascension (M11 5). */
const ASCENSION: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-armored-ascension',
  name: 'Armored Ascension',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 5 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
      },
      { kind: 'grantKeyword', keyword: 'flying' },
    ],
  },
});

/** `Enchanted creature gets -1/-1 for each Swamp you control.` -- Quag Sickness (M11 111). */
const SICKNESS: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-quag-sickness',
  name: 'Quag Sickness',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 111 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'statBonusPer',
        power: -1,
        toughness: -1,
        each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
      },
    ],
  },
});

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 1 } });
const OGRE = creature('Opposing Ogre', 6, 6, { cost: { generic: 4, B: 1 } });

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/**
 * Seat 0 holds three Plains and one Swamp; seat 1 holds four Swamps. The two
 * Swamp counts differ on purpose, so "whose Swamps" has an answer that is a
 * number rather than a coincidence. Four lands is also exactly what either Aura
 * costs, so the board that pays for the spell is the board the spell counts.
 */
function board(hand: readonly Card[]): GameState {
  return scenario({
    battlefield: [
      { card: BEAR, controller: 0, summoningSick: false },
      { card: OGRE, controller: 1, summoningSick: false },
      ...lands(PLAINS, 3).map((card) => ({ card, controller: 0 as const })),
      ...lands(SWAMP, 1).map((card) => ({ card, controller: 0 as const })),
      ...lands(SWAMP, 4).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[...hand], []],
  }).state;
}

function castAuraOn(start: GameState, card: Card, host: ObjectId): GameState {
  const oid = start.players[0].hand.find((candidate) => start.objects[candidate]?.card.id === card.id);
  if (oid === undefined) throw new Error(`no ${card.name} in hand`);
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'permanent', oid: host }],
  });
  return reduceAll(cast.state, PASSES).state;
}

describe('an Aura whose bonus is a rate over the board', () => {
  it('is a legal DSL card in both signs', () => {
    expect(validateCards([ASCENSION, SICKNESS])).toEqual([]);
  });

  it('adds one bonus per Plains its controller has, and grants the keyword beside it', () => {
    const start = board([ASCENSION]);
    const bear = oidOf(start, 'Runeclaw Bear');
    expect(powerOf(start, bear)).toBe(2);
    expect(hasKeyword(start, bear, 'flying')).toBe(false);

    const attached = castAuraOn(start, ASCENSION, bear);
    // Three Plains, so a 2/2 becomes a 5/5. Neither seat's Swamps are Plains,
    // and none of the opponent's lands are the Aura controller's.
    expect(powerOf(attached, bear)).toBe(5);
    expect(toughnessOf(attached, bear)).toBe(5);
    expect(hasKeyword(attached, bear, 'flying')).toBe(true);
  });

  it('re-reads the count when a land leaves, rather than keeping the number', () => {
    const start = board([ASCENSION]);
    const bear = oidOf(start, 'Runeclaw Bear');
    const attached = castAuraOn(start, ASCENSION, bear);
    expect(powerOf(attached, bear)).toBe(5);

    const plains = oidsOf(attached, 'Plains')[0];
    if (plains === undefined) throw new Error('no Plains on the battlefield');
    const fewer = moveObject(beginTrace(attached), plains, 'graveyard').state;
    // Two Plains left, so the same Aura on the same creature is now worth 2.
    expect(powerOf(fewer, bear)).toBe(4);
    expect(toughnessOf(fewer, bear)).toBe(4);
  });

  it('counts the lands of whoever controls the Aura, not of whoever controls the creature', () => {
    const start = board([SICKNESS]);
    const ogre = oidOf(start, 'Opposing Ogre');
    const bear = oidOf(start, 'Runeclaw Bear');
    expect(powerOf(start, ogre)).toBe(6);

    const attached = castAuraOn(start, SICKNESS, ogre);
    // Seat 0 controls the Aura and one Swamp; seat 1 controls the creature and
    // four. The reading that matters is -1, not -4: a 5/5, not a 2/2.
    expect(powerOf(attached, ogre)).toBe(5);
    expect(toughnessOf(attached, ogre)).toBe(5);
    // And the creature with no Aura on it is untouched, in a game where an
    // effect that read the battlefield instead of the attachment would have
    // shrunk it too.
    expect(powerOf(attached, bear)).toBe(2);
    expect(toughnessOf(attached, bear)).toBe(2);
  });
});
