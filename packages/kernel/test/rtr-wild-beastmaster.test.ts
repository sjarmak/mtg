/** Live power, departure LKI, and source exclusion for RTR Wild Beastmaster. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { artifact, creature } from './cards';
import { apply, oidOf } from './helpers';

const WILD_BEASTMASTER = parseCard({
  kind: 'creature',
  id: 'rtr-139-wild-beastmaster-kernel',
  name: 'Wild Beastmaster',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 139 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  subtypes: ['Human', 'Shaman'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: { kind: 'triggeringCreaturePower' },
          toughness: { kind: 'triggeringCreaturePower' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          excludeReferent: true,
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

const ALLY = creature('Beastmaster Ally', 2, 2);
const OPPONENT = creature('Beastmaster Opponent', 2, 2);
const ANTHEM = artifact('Beastmaster Anthem', { generic: 2 }, [
  {
    kind: 'static',
    scope: 'creaturesYouControl',
    subtype: null,
    modification: { kind: 'statBonus', power: 2, toughness: 0 },
  },
]);

function attack() {
  const opened = scenario({
    active: 0,
    step: 'declareAttackers',
    battlefield: [
      { card: WILD_BEASTMASTER, controller: 0, summoningSick: false },
      { card: ALLY, controller: 0 },
      { card: OPPONENT, controller: 1 },
      { card: ANTHEM, controller: 0 },
    ],
  });
  const beastmaster = oidOf(opened.state, WILD_BEASTMASTER.name);
  return {
    beastmaster,
    ally: oidOf(opened.state, ALLY.name),
    opponent: oidOf(opened.state, OPPONENT.name),
    anthem: oidOf(opened.state, ANTHEM.name),
    declared: reduce(opened.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: beastmaster, defender: 1 }],
    }),
  };
}

function resolveTrigger(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority')
      throw new Error(`Wild Beastmaster paused at ${decision?.kind ?? 'none'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Wild Beastmaster trigger did not resolve');
  return current;
}

describe('RTR #139 Wild Beastmaster kernel execution', () => {
  it('reads its live power on resolution and pumps only other creatures its controller controls', () => {
    const subject = attack();
    const anthemGone = moveObject(beginTrace(subject.declared.state), subject.anthem, 'graveyard');
    const done = resolveTrigger(anthemGone);

    expect(powerOf(done.state, subject.beastmaster)).toBe(1);
    expect(powerOf(done.state, subject.ally)).toBe(3);
    expect(powerOf(done.state, subject.opponent)).toBe(2);
  });

  it('uses source last-known power if the attacker leaves before its trigger resolves', () => {
    const subject = attack();
    expect(powerOf(subject.declared.state, subject.beastmaster)).toBe(3);
    const sourceGone = moveObject(beginTrace(subject.declared.state), subject.beastmaster, 'graveyard');
    const anthemGone = moveObject(sourceGone, subject.anthem, 'graveyard');
    const done = resolveTrigger(anthemGone);

    expect(powerOf(done.state, subject.ally)).toBe(5);
    expect(powerOf(done.state, subject.opponent)).toBe(2);
  });
});
