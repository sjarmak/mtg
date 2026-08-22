/**
 * `selfDiesNotSacrificed`: a death trigger that a sacrifice does not pay for.
 *
 * The design ruling this file exists to hold is a negative one. A creature that
 * leaves a 5/5 body behind when it dies is a fine card; the same creature next
 * to a sacrifice outlet is a value loop that converts any board into two
 * bodies at instant speed, and the set the condition was added for rules that
 * out. `selfDies` cannot say it — CR 700.4's "dies" is the zone change and
 * says nothing about the cause — so the vocabulary gained a narrower condition
 * and the kernel gained the fact it reads.
 *
 * That fact is recorded rather than inferred. `permanentSacrificed` is emitted
 * at the moment the cost is paid (`reduce.ts`), ahead of the zone change it
 * belongs to, and `collectTriggers` consumes it when it reads that zone change.
 * Inferring "sacrificed" from the absence of a preceding `permanentDestroyed`
 * would have quietly reclassified every future departure that is neither, so
 * the assertions below read the event log rather than the board: what is being
 * proved is which machinery answered, not that a token happens to be there.
 *
 * Both arms play through the real reducer, and the two boards differ in exactly
 * one thing — how the creature died.
 */
import { describe, expect, it } from 'vitest';
import type { Card, TokenSpec } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameEvent, GameState, ObjectId, ReduceResult, Trace } from '@mtg/kernel';
import { collectTriggers, eventsOfType, legalActions, pendingDecision, scenario } from '@mtg/kernel';
import { creature, FOREST, instant } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/** The body the death leaves behind, and the prize an outlet would farm. */
const REVENANT: TokenSpec = {
  name: 'Revenant',
  power: 5,
  toughness: 5,
  colors: ['B'],
  subtypes: ['Spirit'],
  keywords: [],
  abilities: [],
};

/** `When CARDNAME dies, if it wasn't sacrificed, create a 5/5 Revenant.` */
const CLUTCHING_DREAD: Card = creature('Clutching Dread', 3, 3, {
  cost: { generic: 2, B: 1 },
  subtypes: ['Horror'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDiesNotSacrificed',
      effects: [{ kind: 'createToken', count: 1, token: REVENANT }],
    },
  ],
});

/** The same card printing the wider condition, as the control on both arms. */
const MOURNING_DREAD: Card = creature('Mourning Dread', 3, 3, {
  cost: { generic: 2, B: 1 },
  subtypes: ['Horror'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'createToken', count: 1, token: REVENANT }],
    },
  ],
});

/** The outlet: `Sacrifice a Horror: You gain 1 life.` */
const HUNGRY_ALTAR: Card = parseCard({
  kind: 'artifact',
  id: 'tst-hungry-altar',
  name: 'Hungry Altar',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 77 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeOther: { count: 1, subtype: 'Horror' } },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const KILL_SPELL: Card = instant('Wrenching Blade', [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
]);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function board(subject: Card): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: subject, controller: 0 },
      { card: HUNGRY_ALTAR, controller: 0 },
      ...Array.from({ length: 3 }, () => ({ card: FOREST, controller: 0 as const })),
    ],
    hands: [[KILL_SPELL], []],
  });
  return { state: start.state, events: [...start.events] };
}

/** Passes back and forth until nothing is waiting on the stack. */
function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

function destroyIt(current: ReduceResult, victim: ObjectId): ReduceResult {
  const cast = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, KILL_SPELL.name),
    targets: [{ kind: 'permanent', oid: victim }],
  });
  let next = cast;
  for (const action of PASS) next = apply(next, action);
  return settle(next);
}

function sacrificeIt(current: ReduceResult, victim: ObjectId): ReduceResult {
  const altar = oidOf(current.state, 'Hungry Altar');
  const option = legalActions(current.state).find(
    (action) =>
      action.type === 'activateAbility' && action.oid === altar && action.sacrifices.includes(victim),
  );
  if (option === undefined) throw new Error('the altar offered no activation eating the subject');
  return settle(apply(current, option));
}

function tokensNamed(result: ReduceResult, name: string): readonly ObjectId[] {
  return eventsOfType(result.events, 'tokenCreated')
    .filter((event) => event.name === name)
    .map((event) => event.oid);
}

function triggeredConditions(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

function onBattlefield(state: GameState, name: string): number {
  return state.battlefield.filter((oid) => state.objects[oid]?.card.name === name).length;
}

describe('a death trigger a sacrifice does not pay for', () => {
  it('fires when the creature is destroyed, and leaves the body', () => {
    const start = board(CLUTCHING_DREAD);
    const subject = oidOf(start.state, 'Clutching Dread');

    const dead = destroyIt(start, subject);

    expect(eventsOfType(dead.events, 'permanentDestroyed').map((event) => event.oid)).toContain(subject);
    expect(eventsOfType(dead.events, 'permanentSacrificed')).toEqual([]);
    expect(triggeredConditions(dead, subject)).toEqual(['selfDiesNotSacrificed']);
    expect(tokensNamed(dead, 'Revenant')).toHaveLength(1);
    expect(onBattlefield(dead.state, 'Revenant')).toBe(1);
  });

  /**
   * The whole point of the condition. The same creature, the same graveyard,
   * and no trigger at all — read off the log, because "there is no Revenant on
   * the battlefield" is also what a countered trigger looks like.
   */
  it('does not fire when the creature is sacrificed', () => {
    const start = board(CLUTCHING_DREAD);
    const subject = oidOf(start.state, 'Clutching Dread');

    const eaten = sacrificeIt(start, subject);

    expect(
      eventsOfType(eaten.events, 'permanentSacrificed').map((event) => ({
        oid: event.oid,
        player: event.player,
      })),
    ).toEqual([{ oid: subject, player: 0 }]);
    expect(eventsOfType(eaten.events, 'permanentDestroyed')).toEqual([]);
    expect(
      eventsOfType(eaten.events, 'zoneChanged').filter(
        (event) => event.oid === subject && event.from === 'battlefield' && event.to === 'graveyard',
      ),
    ).toHaveLength(1);
    expect(triggeredConditions(eaten, subject)).toEqual([]);
    expect(tokensNamed(eaten, 'Revenant')).toEqual([]);
    expect(onBattlefield(eaten.state, 'Revenant')).toBe(0);
  });

  /**
   * The narrower condition is a filter on the wider one, not a replacement:
   * a card that prints `selfDies` still fires on a sacrifice. Without this the
   * two arms above would also pass on a kernel that had simply stopped deriving
   * death triggers from a sacrifice at all.
   */
  it('leaves the wider condition firing on both deaths', () => {
    const destroyed = board(MOURNING_DREAD);
    const first = oidOf(destroyed.state, 'Mourning Dread');
    const afterDestroy = destroyIt(destroyed, first);
    expect(triggeredConditions(afterDestroy, first)).toEqual(['selfDies']);
    expect(tokensNamed(afterDestroy, 'Revenant')).toHaveLength(1);

    const eaten = board(MOURNING_DREAD);
    const second = oidOf(eaten.state, 'Mourning Dread');
    const afterSacrifice = sacrificeIt(eaten, second);
    expect(triggeredConditions(afterSacrifice, second)).toEqual(['selfDies']);
    expect(tokensNamed(afterSacrifice, 'Revenant')).toHaveLength(1);
  });

  /**
   * The event is emitted before the zone change it explains, which is what
   * lets `collectTriggers` read the pair in one forward scan.
   */
  it('records the sacrifice ahead of the zone change it explains', () => {
    const start = board(CLUTCHING_DREAD);
    const subject = oidOf(start.state, 'Clutching Dread');
    const eaten = sacrificeIt(start, subject);

    const ordered = eaten.events
      .map((event, index) => ({ event, index }))
      .filter(
        ({ event }) =>
          (event.type === 'permanentSacrificed' && event.oid === subject) ||
          (event.type === 'zoneChanged' && event.oid === subject && event.to === 'graveyard'),
      )
      .map(({ event }) => event.type);
    expect(ordered).toEqual(['permanentSacrificed', 'zoneChanged']);
  });
});

/**
 * The sacrifice fact is *consumed* by the zone change it belongs to, rather
 * than accumulated for the rest of the scan. Driven through `collectTriggers`
 * over a hand-built trace, because a board that sacrifices one permanent,
 * returns it and destroys it inside a single settle window is not a state the
 * legal-move space can be walked into today — and a plain accumulating set
 * would call the second death a sacrifice too, which is a bug nothing else
 * here would catch.
 */
describe('the recorded sacrifice, consumed rather than accumulated', () => {
  it('reads a second death of the same object on its own merits', () => {
    const start = board(CLUTCHING_DREAD);
    const subject = oidOf(start.state, 'Clutching Dread');
    const eaten = sacrificeIt(start, subject);
    expect(eaten.state.objects[subject]?.zone).toBe('graveyard');

    const died = (): GameEvent => ({
      type: 'zoneChanged',
      oid: subject,
      from: 'battlefield',
      to: 'graveyard',
      owner: 0,
    });
    const trace: Trace = {
      state: eaten.state,
      events: [{ type: 'permanentSacrificed', oid: subject, player: 0 }, died(), died()],
    };

    const fired = collectTriggers(trace, 0);
    expect(fired.map((entry) => entry.condition)).toEqual(['selfDiesNotSacrificed']);
    expect(fired.map((entry) => entry.sourceOid)).toEqual([subject]);
  });
});
