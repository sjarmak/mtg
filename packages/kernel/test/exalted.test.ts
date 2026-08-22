/**
 * CR 702.83 exalted: one independent trigger per printed instance, with the
 * lone attacker retained as a non-target referent while the ability waits.
 */
import type { AbilityInput, Card } from '@mtg/dsl';
import {
  choose,
  createSession,
  deepCopy,
  eventsOfType,
  humanSeat,
  pendingDecision,
  powerOf,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  stateFingerprint,
  toughnessOf,
  type GameState,
  type GameSession,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, instant, PLAINS } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const EXALTED = {
  kind: 'triggered',
  condition: 'controlledCreatureAttacksAlone',
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 1,
      toughness: 1,
      target: { kind: 'triggeringCreature' },
    },
  ],
} as unknown as AbilityInput;

function lands(count: number, controller: 0 | 1): { readonly card: Card; readonly controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller }));
}

function settlePriority(start: ReduceResult, limit = 30): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && guard > 1) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('settlePriority: stack did not settle');
}

function declareSolo(state: GameState, attacker: string): ReduceResult {
  return reduce(state, {
    type: 'declareAttackers',
    player: state.turn.active,
    attackers: [{ oid: attacker, defender: state.turn.active === 0 ? 1 : 0 }],
  });
}

describe('exalted', () => {
  it('fires once per instance and gives the lone attacker every +1/+1 on resolution', () => {
    const attacker = creature('Lone Attacker', 2, 2);
    const squire = creature('Aven Squire', 1, 1, { abilities: [EXALTED] });
    const servant = creature('Servant of Nefarox', 3, 1, { abilities: [EXALTED] });
    const start = scenario({
      battlefield: [
        { card: attacker, controller: 0 },
        { card: squire, controller: 0 },
        { card: servant, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attackerOid = oidOf(start, 'Lone Attacker');

    const declared = declareSolo(start, attackerOid);
    expect(eventsOfType(declared.events, 'abilityTriggered').map((event) => event.condition)).toEqual([
      'controlledCreatureAttacksAlone',
      'controlledCreatureAttacksAlone',
    ]);
    expect(declared.state.stack).toHaveLength(2);
    expect(declared.state.stack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targets: [],
          triggerContext: {
            kind: 'controlledCreatureAttacksAlone',
            triggeringCreature: attackerOid,
          },
        }),
      ]),
    );
    const copied = deepCopy(declared.state);
    expect(copied.stack).toEqual(declared.state.stack);
    expect(copied.stack).not.toBe(declared.state.stack);
    expect(stateFingerprint(copied)).toBe(stateFingerprint(declared.state));
    expect(
      stateFingerprint({
        ...copied,
        stack: copied.stack.map((entry) => ({ ...entry, triggerContext: null })),
      }),
    ).not.toBe(stateFingerprint(declared.state));
    expect(powerOf(declared.state, attackerOid)).toBe(2);

    const resolved = settlePriority(declared);
    expect(powerOf(resolved.state, attackerOid)).toBe(4);
    expect(toughnessOf(resolved.state, attackerOid)).toBe(4);
    expect(eventsOfType(resolved.events, 'continuousEffectAdded')).toHaveLength(2);
  });

  it('does not fire when more than one creature attacks', () => {
    const first = creature('First Attacker', 2, 2);
    const second = creature('Second Attacker', 2, 2);
    const source = creature('Exalted Source', 1, 1, { abilities: [EXALTED] });
    const start = scenario({
      battlefield: [
        { card: first, controller: 0 },
        { card: second, controller: 0 },
        { card: source, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;

    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [
        { oid: oidOf(start, 'First Attacker'), defender: 1 },
        { oid: oidOf(start, 'Second Attacker'), defender: 1 },
      ],
    });

    expect(eventsOfType(declared.events, 'abilityTriggered')).toEqual([]);
    expect(declared.state.stack).toEqual([]);
  });

  it('uses the source controller at trigger time, including after a control change', () => {
    const attacker = creature('Changed-Control Attacker', 2, 2);
    const source = creature('Borrowed Exalted Source', 1, 1, { abilities: [EXALTED] });
    const stated = scenario({
      battlefield: [
        { card: attacker, controller: 0 },
        { card: source, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const sourceOid = oidOf(stated, 'Borrowed Exalted Source');
    const sourceObject = stated.objects[sourceOid];
    if (sourceObject === undefined) throw new Error('missing exalted source');
    const changed: GameState = {
      ...stated,
      objects: {
        ...stated.objects,
        [sourceOid]: { ...sourceObject, controller: 0 },
      },
    };

    const declared = declareSolo(changed, oidOf(changed, 'Changed-Control Attacker'));
    const fired = eventsOfType(declared.events, 'abilityTriggered');
    expect(fired).toHaveLength(1);
    expect(fired[0]).toEqual(expect.objectContaining({ source: sourceOid, player: 0 }));
  });

  it('resolves after its source leaves the battlefield and remains byte-deterministic', () => {
    const attacker = creature('Persistent Attacker', 2, 2);
    const source = creature('Doomed Exalted Source', 1, 1, { abilities: [EXALTED] });
    const removal = instant('Remove Source', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    ]);

    function run(): ReduceResult {
      const start = scenario({
        battlefield: [{ card: attacker, controller: 0 }, { card: source, controller: 0 }, ...lands(1, 1)],
        hands: [[], [removal]],
        active: 0,
        step: 'declareAttackers',
        seed: 'exalted/source-leaves',
      }).state;
      const attackerOid = oidOf(start, 'Persistent Attacker');
      const sourceOid = oidOf(start, 'Doomed Exalted Source');
      const declared = declareSolo(start, attackerOid);
      const passed = apply(declared, { type: 'passPriority', player: 0 });
      const answered = apply(passed, {
        type: 'castSpell',
        player: 1,
        oid: handOidOf(passed.state, 1, 'Remove Source'),
        targets: [{ kind: 'permanent', oid: sourceOid }],
      });
      const resolved = settlePriority(answered);
      expect(resolved.state.objects[sourceOid]?.zone).toBe('graveyard');
      expect(powerOf(resolved.state, attackerOid)).toBe(3);
      expect(toughnessOf(resolved.state, attackerOid)).toBe(3);
      return resolved;
    }

    const first = run();
    const second = run();
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });

  it('silently does nothing when its retained attacker leaves instead of becoming an illegal target', () => {
    const attacker = creature('Departing Attacker', 2, 2);
    const source = creature('Watching Exalted Source', 1, 1, { abilities: [EXALTED] });
    const removal = instant('Remove Attacker', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    ]);
    const start = scenario({
      battlefield: [{ card: attacker, controller: 0 }, { card: source, controller: 0 }, ...lands(1, 1)],
      hands: [[], [removal]],
      active: 0,
      step: 'declareAttackers',
      seed: 'exalted/referent-leaves',
    }).state;
    const attackerOid = oidOf(start, 'Departing Attacker');
    const declared = declareSolo(start, attackerOid);
    expect(declared.state.stack[0]).toEqual(
      expect.objectContaining({
        targets: [],
        triggerContext: {
          kind: 'controlledCreatureAttacksAlone',
          triggeringCreature: attackerOid,
        },
      }),
    );

    const passed = apply(declared, { type: 'passPriority', player: 0 });
    const answered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(passed.state, 1, 'Remove Attacker'),
      targets: [{ kind: 'permanent', oid: attackerOid }],
    });
    const resolved = settlePriority(answered);

    expect(resolved.state.objects[attackerOid]?.zone).toBe('graveyard');
    expect(eventsOfType(resolved.events, 'effectSkipped')).toEqual([]);
    expect(eventsOfType(resolved.events, 'continuousEffectAdded')).toEqual([]);
    expect(JSON.stringify(resolved.events)).not.toMatch(/target is no longer legal/iu);
  });

  it('replaySession restores the same non-target trigger context from choices alone', () => {
    const pilgrim = creature('Exalted Pilgrim', 2, 2, {
      cost: { W: 1 },
      abilities: [EXALTED],
    });
    const deck = (name: string) => ({
      name,
      cards: [...Array.from({ length: 24 }, () => pilgrim), ...Array.from({ length: 16 }, () => PLAINS)],
    });
    const setup = {
      seed: 'exalted/replay-session',
      decks: [deck('Pilgrims A'), deck('Pilgrims B')] as const,
      maximumTurns: 8,
    };
    const seats = [humanSeat('alpha'), humanSeat('beta')] as const;
    let session: GameSession = createSession(setup, seats);

    for (let guard = 0; guard < 2_000; guard += 1) {
      if (session.state.stack.some((entry) => entry.triggerContext !== null)) break;
      const decision = session.pending;
      if (decision === null) throw new Error('game ended before exalted triggered');
      let preferred = 0;
      if (decision.kind === 'mulligan') {
        preferred = decision.options.findIndex((action) => action.type === 'keepHand');
      } else if (decision.kind === 'priority') {
        preferred = decision.options.findIndex((action) => action.type === 'playLand');
        const hasCreature = session.state.battlefield.some(
          (oid) =>
            session.state.objects[oid]?.controller === decision.player &&
            session.state.objects[oid]?.card.kind === 'creature',
        );
        if (preferred < 0 && !hasCreature) {
          preferred = decision.options.findIndex((action) => action.type === 'castSpell');
        }
        if (preferred < 0) {
          preferred = decision.options.findIndex((action) => action.type === 'passPriority');
        }
      } else if (decision.kind === 'declareAttackers') {
        preferred = decision.options.findIndex(
          (action) => action.type === 'declareAttackers' && action.attackers.length === 1,
        );
      } else if (decision.kind === 'declareBlockers') {
        preferred = decision.options.findIndex(
          (action) => action.type === 'declareBlockers' && action.blocks.length === 0,
        );
      }
      session = choose(session, preferred < 0 ? 0 : preferred);
    }

    const entry = session.state.stack.find((candidate) => candidate.triggerContext !== null);
    if (entry === undefined) throw new Error('no exalted trigger appeared');
    expect(entry.targets).toEqual([]);
    const replayed = replaySession(setup, seats, session.choices);
    expect(replayed.state.stack).toEqual(session.state.stack);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));

    for (let guard = 0; session.state.stack.length > 0 && guard < 20; guard += 1) {
      const decision = session.pending;
      if (decision?.kind !== 'priority') throw new Error('exalted replay did not reach priority');
      const pass = decision.options.findIndex((action) => action.type === 'passPriority');
      if (pass < 0) throw new Error('exalted replay priority offered no pass');
      session = choose(session, pass);
    }
    const resolvedReplay = replaySession(setup, seats, session.choices);
    expect(stateFingerprint(resolvedReplay.state)).toBe(stateFingerprint(session.state));
    expect(eventsOfType(resolvedReplay.events, 'effectSkipped')).toEqual([]);
    expect(serializeEvents(resolvedReplay.events)).not.toMatch(/target is no longer legal/iu);
  });
});
