import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, FOREST, instant, ISLAND, lands, MOUNTAIN } from './cards';
import { apply, damageOn, handOidOf, oidOf } from './helpers';

const IZZET_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-172-izzet-charm-kernel',
  name: 'Izzet Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 172 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'counterSpell',
          spellFilter: { excludeCardTypes: ['creature'] },
          unlessCost: { generic: 2 },
        },
      ],
    },
    { effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }] },
    {
      effects: [
        { kind: 'drawCards', count: 2, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 2, target: { kind: 'noTarget' } },
      ],
    },
  ],
} as unknown as CardInput);

const STUDY = instant('Target Study', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }], {
  generic: 1,
});

function passUntilDecision(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority' || current.state.stack.length === 0) {
      return current;
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Izzet Charm stack did not settle');
}

function counterBoard(extraPayerLands: number): {
  readonly atToll: ReduceResult;
  readonly charmOid: string;
  readonly targetOid: string;
} {
  const start = scenario({
    battlefield: [
      ...lands(FOREST, extraPayerLands + 1).map((card) => ({ card, controller: 0 as const })),
      { card: ISLAND, controller: 1 },
      { card: MOUNTAIN, controller: 1 },
    ],
    hands: [[STUDY], [IZZET_CHARM]],
    libraries: [lands(FOREST, 4), lands(ISLAND, 4)],
  });
  const targetOid = handOidOf(start.state, 0, STUDY.name);
  const charmOid = handOidOf(start.state, 1, IZZET_CHARM.name);
  const targetCast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: targetOid,
    targets: [null],
  });
  const offered = apply(targetCast, { type: 'passPriority', player: 0 });
  const charmCast = apply(offered, {
    type: 'castSpell',
    player: 1,
    oid: charmOid,
    mode: 0,
    targets: [{ kind: 'spell', oid: targetOid }],
  });
  return { atToll: passUntilDecision(charmCast), charmOid, targetOid };
}

function tappedLands(result: ReduceResult, player: 0 | 1): number {
  return result.state.battlefield.filter((oid) => {
    const object = result.state.objects[oid];
    return object?.controller === player && object.card.kind === 'land' && object.tapped;
  }).length;
}

describe('RTR #172 Izzet Charm', () => {
  it('offers the noncreature spell controller exactly the {2} toll', () => {
    const { atToll, charmOid } = counterBoard(2);
    const decision = pendingDecision(atToll.state);
    if (decision?.kind !== 'unless') throw new Error('counter mode did not pause for its toll');

    expect(decision.player).toBe(0);
    expect(decision.oid).toBe(charmOid);
    expect(decision.cost.generic).toBe(2);
  });

  it('leaves the target spell on the stack when its controller pays', () => {
    const { atToll, charmOid, targetOid } = counterBoard(2);
    const paid = apply(atToll, { type: 'answerUnless', player: 0, oid: charmOid, pay: true });

    expect(paid.state.objects[charmOid]?.zone).toBe('graveyard');
    expect(paid.state.objects[targetOid]?.zone).toBe('stack');
    expect(paid.state.stack.map((entry) => entry.oid)).toContain(targetOid);
    expect(tappedLands(paid, 0)).toBe(3);
    expect(eventsOfType(paid.events, 'unlessPaid')).toHaveLength(1);
  });

  it('counters on decline and automatically counters when the toll is unaffordable', () => {
    const affordable = counterBoard(2);
    const declined = apply(affordable.atToll, {
      type: 'answerUnless',
      player: 0,
      oid: affordable.charmOid,
      pay: false,
    });
    expect(declined.state.objects[affordable.targetOid]?.zone).toBe('graveyard');
    expect(tappedLands(declined, 0)).toBe(1);

    const unaffordable = counterBoard(0);
    expect(pendingDecision(unaffordable.atToll.state)?.kind).toBe('priority');
    expect(unaffordable.atToll.state.objects[unaffordable.targetOid]?.zone).toBe('graveyard');
    expect(eventsOfType(unaffordable.atToll.events, 'unlessPaid')).toHaveLength(0);
  });

  it('does not offer the counter mode for a creature spell', () => {
    const bear = creature('Stack Bear', 2, 2, { cost: { generic: 1 } });
    const start = scenario({
      battlefield: [
        { card: FOREST, controller: 0 },
        { card: ISLAND, controller: 1 },
        { card: MOUNTAIN, controller: 1 },
      ],
      hands: [[bear], [IZZET_CHARM]],
    });
    const bearOid = handOidOf(start.state, 0, bear.name);
    const cast = apply(start, { type: 'castSpell', player: 0, oid: bearOid, targets: [] });
    const offered = apply(cast, { type: 'passPriority', player: 0 });
    const charmOid = handOidOf(offered.state, 1, IZZET_CHARM.name);
    const counterOptions = legalActions(offered.state).filter(
      (action): action is Extract<Action, { type: 'castSpell' }> =>
        action.type === 'castSpell' && action.oid === charmOid && action.mode === 0,
    );

    expect(counterOptions).toEqual([]);
  });

  it('deals exactly 2 only to the chosen creature without opening a toll', () => {
    const victim = creature('Charm Victim', 3, 3);
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: victim, controller: 1 },
      ],
      hands: [[IZZET_CHARM], []],
    });
    const victimOid = oidOf(start.state, victim.name);
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, IZZET_CHARM.name),
      mode: 1,
      targets: [{ kind: 'permanent', oid: victimOid }],
    });
    const resolved = passUntilDecision(cast);

    expect(damageOn(resolved.state, victimOid)).toBe(2);
    expect(eventsOfType(resolved.events, 'unlessPaid')).toHaveLength(0);
  });

  it('draws two then discards the entire two-card hand without leaking a toll or target', () => {
    const first = creature('First Drawn', 1, 1);
    const second = creature('Second Drawn', 1, 1);
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[IZZET_CHARM], []],
      libraries: [[first, second], lands(FOREST, 2)],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, IZZET_CHARM.name),
      mode: 2,
      targets: [null, null],
    });
    const resolved = passUntilDecision(cast);

    expect(resolved.state.players[0].hand).toEqual([]);
    expect(resolved.state.players[0].graveyard.map((oid) => resolved.state.objects[oid]?.card.name)).toEqual(
      expect.arrayContaining([IZZET_CHARM.name, first.name, second.name]),
    );
    expect(pendingDecision(resolved.state)?.kind).toBe('priority');
    expect(eventsOfType(resolved.events, 'unlessPaid')).toHaveLength(0);
  });
});
