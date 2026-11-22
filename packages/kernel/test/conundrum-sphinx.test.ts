/** Conundrum Sphinx through APNAP name choices and the linked top-card branch. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, Effect } from '@mtg/dsl';
import type { PlayerId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const CHOOSE_AND_REVEAL: Effect = {
  kind: 'eachPlayerNamesCardThenRevealsTop',
};

const ATTACK_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [CHOOSE_AND_REVEAL],
};

const BASE_SPHINX = creature('Conundrum Sphinx', 4, 4, {
  keywords: ['flying'],
});
const SPHINX = { ...BASE_SPHINX, abilities: [ATTACK_TRIGGER] } as Card;
const MATCH = creature('Foresee the Answer', 2, 2);
const MISS = creature('Unexpected Result', 3, 3);
const CASTER_BOTTOM = creature('Caster Bottom', 1, 1);
const OPPONENT_BOTTOM = creature('Opponent Bottom', 1, 1);

function attacked(
  libraries: readonly [readonly Card[], readonly Card[]] = [
    [MISS, OPPONENT_BOTTOM],
    [MATCH, CASTER_BOTTOM],
  ],
): ReduceResult {
  const start = scenario({
    seed: 'm11/conundrum-sphinx',
    active: 1,
    turn: 5,
    step: 'declareAttackers',
    battlefield: [{ card: SPHINX, controller: 1 }],
    libraries,
  });
  let current = apply(start, {
    type: 'declareAttackers',
    player: 1,
    attackers: [{ oid: oidOf(start.state, SPHINX.name), defender: 0 }],
  });
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'cardName') return current;
    if (decision?.kind !== 'priority') {
      throw new Error(`Conundrum Sphinx stopped on ${decision?.kind ?? 'nothing'} before naming`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Conundrum Sphinx did not reach its card-name choice');
}

function chooseName(current: ReduceResult, player: PlayerId, name: string): ReduceResult {
  return apply(current, { type: 'chooseCardName', player, name });
}

function namesIn(current: ReduceResult, player: PlayerId, zone: 'hand' | 'library'): readonly string[] {
  return current.state.players[player][zone].map((oid) => current.state.objects[oid]?.card.name ?? '');
}

describe('Conundrum Sphinx resolution', () => {
  it('collects names in APNAP order before revealing or moving either top card', () => {
    let current = attacked();
    const first = pendingDecision(current.state);
    expect(first).toEqual(expect.objectContaining({ kind: 'cardName', player: 1, chosen: [], options: [] }));

    current = chooseName(current, 1, 'foresee the answer');
    expect(eventsOfType(current.events, 'libraryTopRevealed')).toEqual([]);
    expect(namesIn(current, 0, 'library')).toEqual([MISS.name, OPPONENT_BOTTOM.name]);
    expect(namesIn(current, 1, 'library')).toEqual([MATCH.name, CASTER_BOTTOM.name]);
    expect(pendingDecision(current.state)).toEqual(
      expect.objectContaining({
        kind: 'cardName',
        player: 0,
        chosen: [{ player: 1, name: 'foresee the answer' }],
        options: [],
      }),
    );

    current = chooseName(current, 0, 'A Card That Is Not Here');

    expect(
      eventsOfType(current.events, 'libraryTopRevealed').map((event) => ({
        player: event.player,
        names: event.oids.map((oid) => current.state.objects[oid]?.card.name),
      })),
    ).toEqual([
      { player: 1, names: [MATCH.name] },
      { player: 0, names: [MISS.name] },
    ]);
    expect(namesIn(current, 1, 'hand')).toContain(MATCH.name);
    expect(namesIn(current, 1, 'library')).toEqual([CASTER_BOTTOM.name]);
    expect(namesIn(current, 0, 'hand')).not.toContain(MISS.name);
    expect(namesIn(current, 0, 'library')).toEqual([OPPONENT_BOTTOM.name, MISS.name]);
  });

  it('refuses an empty or wrong-seat answer without changing the position', () => {
    const current = attacked();
    expect(
      validateAction(current.state, {
        type: 'chooseCardName',
        player: 1,
        name: '   ',
      }),
    ).toContain('empty');
    expect(
      validateAction(current.state, {
        type: 'chooseCardName',
        player: 0,
        name: MATCH.name,
      }),
    ).toContain('player 1');
  });

  it('resolves safely when both libraries are empty', () => {
    let current = attacked([[], []]);
    current = chooseName(current, 1, MATCH.name);
    current = chooseName(current, 0, MISS.name);

    expect(eventsOfType(current.events, 'libraryTopRevealed')).toEqual([]);
    expect(namesIn(current, 0, 'library')).toEqual([]);
    expect(namesIn(current, 1, 'library')).toEqual([]);
    expect(current.state.players.map((player) => player.lost)).toEqual([false, false]);
    expect(current.state.players.map((player) => player.attemptedDrawFromEmptyLibrary)).toEqual([
      false,
      false,
    ]);
  });
});
