/** Oak Street Innkeeper's hexproof grant follows turn, tap, control, and source state live. */
import { parseCard } from '@mtg/dsl';
import { canBeTargetedBy, hasKeywordAbility, moveObject, scenario } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, instant } from './cards';
import { oidOf } from './helpers';

const INNKEEPER = parseCard({
  kind: 'creature',
  id: 'rtr-131-oak-street-innkeeper-kernel',
  name: 'Oak Street Innkeeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 131 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Elf'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      filter: { tapped: true },
      activeDuring: 'turnsOtherThanYours',
      modification: { kind: 'grantKeyword', keyword: 'hexproof' },
    },
  ],
});

const TAPPED_ALLY = creature('Oak Street Tapped Ally', 2, 2);
const UNTAPPED_ALLY = creature('Oak Street Untapped Ally', 2, 2);
const TAPPED_OPPONENT = creature('Oak Street Tapped Opponent', 2, 2);
const HOSTILE = instant(
  'Oak Street Hostile Spell',
  [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
  { U: 1 },
);

describe('Oak Street Innkeeper live grant', () => {
  it('protects only tapped controlled creatures, only outside the controller turn', () => {
    const ownTurn = scenario({
      active: 0,
      battlefield: [
        { card: INNKEEPER, controller: 0 },
        { card: TAPPED_ALLY, controller: 0, tapped: true },
        { card: UNTAPPED_ALLY, controller: 0 },
        { card: TAPPED_OPPONENT, controller: 1, tapped: true },
      ],
    }).state;
    const tapped = oidOf(ownTurn, TAPPED_ALLY.name);
    const untapped = oidOf(ownTurn, UNTAPPED_ALLY.name);
    const opposing = oidOf(ownTurn, TAPPED_OPPONENT.name);

    expect(canBeTargetedBy(ownTurn, tapped, HOSTILE, 1)).toBe(true);
    const otherTurn = { ...ownTurn, turn: { ...ownTurn.turn, active: 1 as const } };
    expect(hasKeywordAbility(otherTurn, tapped, 'hexproof')).toBe(true);
    expect(canBeTargetedBy(otherTurn, tapped, HOSTILE, 1)).toBe(false);
    expect(canBeTargetedBy(otherTurn, untapped, HOSTILE, 1)).toBe(true);
    expect(canBeTargetedBy(otherTurn, opposing, HOSTILE, 0)).toBe(true);
    expect(canBeTargetedBy(otherTurn, tapped, HOSTILE, 0)).toBe(true);
  });

  it('updates on untap and ends when the Innkeeper leaves', () => {
    const start = scenario({
      active: 1,
      battlefield: [
        { card: INNKEEPER, controller: 0 },
        { card: TAPPED_ALLY, controller: 0, tapped: true },
      ],
    });
    const source = oidOf(start.state, INNKEEPER.name);
    const target = oidOf(start.state, TAPPED_ALLY.name);
    expect(canBeTargetedBy(start.state, target, HOSTILE, 1)).toBe(false);

    const object = start.state.objects[target];
    if (object === undefined) throw new Error('Oak Street target disappeared');
    const untapped = {
      ...start.state,
      objects: { ...start.state.objects, [target]: { ...object, tapped: false } },
    };
    expect(canBeTargetedBy(untapped, target, HOSTILE, 1)).toBe(true);

    const departed = moveObject(start, source, 'graveyard');
    expect(canBeTargetedBy(departed.state, target, HOSTILE, 1)).toBe(true);
  });
});
