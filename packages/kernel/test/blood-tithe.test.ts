import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import { pendingDecision, reduce, reduceAll, scenario, type ReduceResult } from '@mtg/kernel';
import { sorcery, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const BLOOD_TITHE = sorcery(
  'Blood Tithe',
  [
    { kind: 'loseLife', amount: 3, players: 'eachOpponent', target: { kind: 'noTarget' } },
    { kind: 'gainLife', amount: { kind: 'lifeLostThisResolution' }, target: { kind: 'noTarget' } },
  ],
  { generic: 3, B: 1 },
);

function linkedAfterPause(pause: Effect): Card {
  return sorcery(
    `Paused Tithe ${pause.kind}`,
    [
      { kind: 'loseLife', amount: 2, players: 'eachOpponent', target: { kind: 'noTarget' } },
      pause,
      { kind: 'gainLife', amount: { kind: 'lifeLostThisResolution' }, target: { kind: 'noTarget' } },
    ],
    { generic: 3, B: 1 },
  );
}

function cast(start: ReduceResult, spell: Card): ReduceResult {
  const castResult = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, spell.name),
    targets: spell.effects.map(() => null),
  });
  const resolved = reduceAll(castResult.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...castResult.events, ...resolved.events] };
}

function position(spell: Card): ReduceResult {
  return scenario({
    battlefield: Array.from({ length: 4 }, () => ({ card: SWAMP, controller: 0 as const })),
    hands: [[spell], []],
    libraries: [
      [SWAMP, SWAMP],
      [SWAMP, SWAMP],
    ],
  });
}

describe('life lost earlier in one resolution', () => {
  it('runs Blood Tithe through casting and native resolution', () => {
    const done = cast(position(BLOOD_TITHE), BLOOD_TITHE);
    expect(done.state.players[0].life).toBe(23);
    expect(done.state.players[1].life).toBe(17);
  });

  it('banks the actual loss across a scry pause', () => {
    const spell = linkedAfterPause({ kind: 'scry', count: 1 });
    let current = cast(position(spell), spell);
    expect(current.state.players[0].life).toBe(20);
    expect(current.state.players[1].life).toBe(18);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'scry') throw new Error('scry was not pending');
    const choice = decision.options[0];
    if (choice === undefined) throw new Error('scry offered no choice');
    current = apply(current, choice);
    expect(current.state.players[0].life).toBe(22);
    expect(current.state.players[1].life).toBe(18);
  });

  it('does not mistake damage for a LoseLife result', () => {
    const spell = sorcery(
      'Damage Is Not Tithe',
      [
        { kind: 'dealDamage', amount: 2, target: { kind: 'targetOpponent' } },
        { kind: 'gainLife', amount: { kind: 'lifeLostThisResolution' }, target: { kind: 'noTarget' } },
      ],
      { generic: 3, B: 1 },
    );
    const start = position(spell);
    const castResult = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, spell.name),
      targets: [{ kind: 'player', player: 1 }, null],
    });
    const done = reduceAll(castResult.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(done.state.players[0].life).toBe(20);
    expect(done.state.players[1].life).toBe(18);
  });
});
