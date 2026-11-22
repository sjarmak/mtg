/** Stack-cost payment, control, and independent resolution probes for RTR #219. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import { beginTrace, legalActions, moveObject, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { instant, ISLAND } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const NIVMAGUS = parseCard({
  kind: 'creature',
  id: 'rtr-219-nivmagus-elemental-kernel',
  name: 'Nivmagus Elemental',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 219 },
  colors: ['U', 'R'],
  manaCost: { hybrid: { 'U/R': 1 } },
  subtypes: ['Elemental'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, exileControlledInstantOrSorcerySpell: true },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});
const SPELL = instant('Nivmagus Probe', [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }], {
  U: 1,
});

function castProbe(): { readonly result: ReduceResult; readonly nivmagus: string; readonly spell: string } {
  const opened = scenario({
    battlefield: [
      { card: NIVMAGUS, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
    hands: [[SPELL], []],
  });
  const spell = handOidOf(opened.state, 0, SPELL.name);
  const cast = legalActions(opened.state).find(
    (action) => action.type === 'castSpell' && action.oid === spell,
  );
  if (cast?.type !== 'castSpell') throw new Error('probe spell was not castable');
  return {
    result: apply({ state: opened.state, events: [...opened.events] }, cast),
    nivmagus: oidOf(opened.state, NIVMAGUS.name),
    spell,
  };
}

function activation(
  state: GameState,
  source: string,
  spell: string,
): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === source &&
      action.targets[0]?.kind === 'spell' &&
      action.targets[0].oid === spell,
  );
  if (found === undefined) throw new Error('Nivmagus offered no activation for its controlled spell');
  return found;
}

function settleAbility(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority' || current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Nivmagus ability did not settle');
}

describe('RTR Nivmagus Elemental in the kernel', () => {
  it('exiles the controlled spell while paying, then resolves two counters independently', () => {
    const run = castProbe();
    const paid = reduce(run.result.state, activation(run.result.state, run.nivmagus, run.spell));
    expect(paid.state.objects[run.spell]?.zone).toBe('exile');
    expect(paid.state.stack.some((entry) => entry.oid === run.spell)).toBe(false);
    expect(paid.state.objects[run.nivmagus]?.counters.plusOnePlusOne).toBe(0);

    const done = settleAbility(paid);
    expect(done.state.objects[run.nivmagus]?.counters.plusOnePlusOne).toBe(2);
    expect(done.state.players[0].life).toBe(20);
  });

  it('cannot consume an opponent spell or the same spell twice', () => {
    const run = castProbe();
    const opponentView = {
      ...run.result.state,
      objects: {
        ...run.result.state.objects,
        [run.spell]: { ...run.result.state.objects[run.spell]!, controller: 1 as const },
      },
      stack: run.result.state.stack.map((entry) =>
        entry.oid === run.spell ? { ...entry, controller: 1 as const } : entry,
      ),
    };
    expect(
      legalActions(opponentView).some(
        (action) =>
          action.type === 'activateAbility' &&
          action.oid === run.nivmagus &&
          action.targets[0]?.kind === 'spell' &&
          action.targets[0].oid === run.spell,
      ),
    ).toBe(false);

    const paid = reduce(run.result.state, activation(run.result.state, run.nivmagus, run.spell));
    expect(
      legalActions(paid.state).some(
        (action) => action.type === 'activateAbility' && action.oid === run.nivmagus,
      ),
    ).toBe(false);
  });

  it('pays the spell cost even when the source leaves before resolution', () => {
    const run = castProbe();
    const paid = reduce(run.result.state, activation(run.result.state, run.nivmagus, run.spell));
    const departed = moveObject(beginTrace(paid.state), run.nivmagus, 'graveyard');
    const done = settleAbility({ state: departed.state, events: [...paid.events, ...departed.events] });

    expect(done.state.objects[run.spell]?.zone).toBe('exile');
    expect(done.state.objects[run.nivmagus]).toMatchObject({ zone: 'graveyard' });
    expect(done.state.objects[run.nivmagus]?.counters.plusOnePlusOne).toBe(0);
  });
});
