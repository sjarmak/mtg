/** Exact graveyard-incarnation return behavior for Rancor. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ObjectId,
  type ReduceResult,
  type ZoneId,
} from '@mtg/kernel';
import { apply, oidOf } from './helpers';
import { abilities, controlledBy, onlyObject, withContinuous } from './continuous-helpers';

const RANCOR = parseCard({
  kind: 'enchantment',
  id: 'm13-185-rancor-kernel',
  name: 'Rancor',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 185 },
  manaCost: { G: 1 },
  colors: ['G'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromBattlefield',
      effects: [{ kind: 'returnDepartedSourceToOwnerHand' }],
    },
  ],
});

const VOID = parseCard({
  kind: 'enchantment',
  id: 'test-rancor-void',
  name: 'Rancor Probe Void',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [{ kind: 'staticPlayerRule', players: 'eachOpponent', rule: 'cardsToGraveyardAreExiled' }],
});

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Rancor test lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function depart(destination: Exclude<ZoneId, 'battlefield' | 'stack'> = 'graveyard'): {
  readonly current: ReduceResult;
  readonly rancor: ObjectId;
} {
  const opened = scenario({ battlefield: [{ card: RANCOR, controller: 0 }] });
  const rancor = oidOf(opened.state, RANCOR.name);
  const moved = settle(moveObject(beginTrace(opened.state), rancor, destination));
  return { current: { state: moved.state, events: moved.events }, rancor };
}

describe('Rancor', () => {
  it('returns only after a battlefield-to-graveyard departure', () => {
    const graveyard = depart();
    expect(graveyard.current.state.stack).toHaveLength(1);
    const resolved = pass(pass(graveyard.current));
    expect(resolved.state.objects[graveyard.rancor]?.zone).toBe('hand');

    for (const destination of ['hand', 'exile', 'library'] as const) {
      const other = depart(destination);
      expect(other.current.state.stack).toHaveLength(0);
      expect(other.current.state.objects[other.rancor]?.zone).toBe(destination);
    }
  });

  it("uses the Aura's owner for the return and its last controller for the trigger", () => {
    const opened = scenario({ battlefield: [{ card: RANCOR, controller: 0 }] });
    const rancor = oidOf(opened.state, RANCOR.name);
    const stolen = withContinuous(opened.state, [controlledBy(onlyObject(rancor), 1)]);
    const moved = settle(moveObject(beginTrace(stolen), rancor, 'graveyard'));
    expect(moved.state.stack[0]?.controller).toBe(1);

    const resolved = pass(pass({ state: moved.state, events: moved.events }));
    expect(resolved.state.players[0].hand).toContain(rancor);
    expect(resolved.state.players[1].hand).not.toContain(rancor);
  });

  it('suppresses a trigger when abilities were removed before departure but not after it fired', () => {
    const opened = scenario({ battlefield: [{ card: RANCOR, controller: 0 }] });
    const rancor = oidOf(opened.state, RANCOR.name);
    const stripped = withContinuous(opened.state, [abilities(onlyObject(rancor), { removeAll: true })]);
    const silent = settle(moveObject(beginTrace(stripped), rancor, 'graveyard'));
    expect(silent.state.stack).toHaveLength(0);

    const fired = depart();
    const strippedAfter = withContinuous(fired.current.state, [
      abilities(onlyObject(fired.rancor), { removeAll: true }),
    ]);
    const resolved = pass(pass({ state: strippedAfter, events: fired.current.events }));
    expect(resolved.state.objects[fired.rancor]?.zone).toBe('hand');
  });

  it('does not move a later graveyard incarnation when an old trigger resolves', () => {
    const fired = depart();
    const left = moveObject(beginTrace(fired.current.state), fired.rancor, 'hand');
    const returned = moveObject(left, fired.rancor, 'graveyard');
    const resolved = pass(pass({ state: returned.state, events: fired.current.events }));
    expect(resolved.state.objects[fired.rancor]?.zone).toBe('graveyard');
  });

  it('does not trigger when a graveyard move is replaced with exile', () => {
    const opened = scenario({
      battlefield: [
        { card: RANCOR, controller: 0 },
        { card: VOID, controller: 1 },
      ],
    });
    const rancor = oidOf(opened.state, RANCOR.name);
    const moved = settle(moveObject(beginTrace(opened.state), rancor, 'graveyard'));
    expect(moved.state.objects[rancor]?.zone).toBe('exile');
    expect(moved.state.stack).toHaveLength(0);
  });
});
