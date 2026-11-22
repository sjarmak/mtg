/** Native resolution and hostile probes for RTR #197 Slaughter Games. */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { beginTrace, eventsOfType, pendingDecision, playerOf, scenario, validateAction } from '@mtg/kernel';
import type { ReduceResult } from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { creature, lands, MOUNTAIN, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const SLAUGHTER_GAMES = parseCard({
  kind: 'sorcery',
  id: 'rtr-197',
  name: 'Slaughter Games',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 197 },
  manaCost: { generic: 2, B: 1, R: 1 },
  colors: ['B', 'R'],
  cannotBeCountered: true,
  effects: [
    {
      kind: 'nameNonlandCardAndExileMatchingOpponentZones',
      target: { kind: 'targetOpponent' },
    } as unknown as Effect,
  ],
} as CardInput);

const MATCH = creature('Named Quarry', 2, 2);
const OTHER = creature('Other Quarry', 1, 3);

function board(): ReduceResult {
  return scenario({
    seed: 'rtr/slaughter-games',
    battlefield: lands(SWAMP, 2)
      .concat(lands(MOUNTAIN, 2))
      .map((card) => ({ card, controller: 0 as const })),
    hands: [[SLAUGHTER_GAMES], [MATCH, OTHER]],
    graveyards: [[], [MATCH, OTHER]],
    libraries: [[MATCH], [MATCH, OTHER, MATCH]],
  });
}

function reachName(from = board()): ReduceResult {
  let current = apply(from, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, SLAUGHTER_GAMES.name),
    targets: [{ kind: 'player', player: 1 }],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function names(result: ReduceResult, oids: readonly string[]): readonly string[] {
  return oids.map((oid) => result.state.objects[oid]?.card.name ?? '?');
}

describe('Slaughter Games resolution', () => {
  it('stays on the stack when an effect tries to counter it', () => {
    const start = board();
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, SLAUGHTER_GAMES.name),
      targets: [{ kind: 'player', player: 1 }],
    });
    const spell = cast.state.stack[0]?.oid;
    if (spell === undefined) throw new Error('Slaughter Games was not put on the stack');

    const attempted = counterStackEntry(beginTrace(cast.state), spell, 'test-counter');
    expect(attempted.state.stack.map((entry) => entry.oid)).toContain(spell);
    expect(eventsOfType(attempted.events, 'spellCountered')).toEqual([]);
  });

  it('chooses its target while casting, then its nonland name on resolution', () => {
    const current = reachName();
    expect(pendingDecision(current.state)).toMatchObject({ kind: 'cardName', player: 0 });
    expect(validateAction(current.state, { type: 'chooseCardName', player: 0, name: 'Mountain' })).toBe(
      'the chosen name must be a nonland card name',
    );
    expect(validateAction(current.state, { type: 'chooseCardName', player: 0, name: MATCH.name })).toBeNull();
  });

  it('exiles any chosen subset across only the target opponent zones, then shuffles', () => {
    let current = apply(reachName(), { type: 'chooseCardName', player: 0, name: MATCH.name });
    let decision = pendingDecision(current.state);
    if (decision?.kind !== 'namedZoneExile') throw new Error('named subset was not requested');
    expect(names(current, decision.cards)).toEqual([MATCH.name, MATCH.name, MATCH.name, MATCH.name]);

    current = apply(current, { type: 'chooseNamedZoneExile', player: 0, oid: decision.cards[0] ?? null });
    decision = pendingDecision(current.state);
    if (decision?.kind !== 'namedZoneExile') throw new Error('named subset did not continue');
    current = apply(current, { type: 'chooseNamedZoneExile', player: 0, oid: decision.cards[1] ?? null });
    current = apply(current, { type: 'chooseNamedZoneExile', player: 0, oid: null });

    expect(names(current, current.state.exile)).toEqual([MATCH.name, MATCH.name]);
    expect(names(current, playerOf(current.state, 1).hand)).toContain(MATCH.name);
    expect(names(current, playerOf(current.state, 1).library)).toContain(MATCH.name);
    expect(names(current, playerOf(current.state, 0).library)).toEqual([MATCH.name]);
    expect(eventsOfType(current.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);
  });

  it('permits choosing zero matching cards and still shuffles exactly once', () => {
    let current = apply(reachName(), { type: 'chooseCardName', player: 0, name: MATCH.name });
    current = apply(current, { type: 'chooseNamedZoneExile', player: 0, oid: null });
    expect(current.state.exile).toEqual([]);
    expect(eventsOfType(current.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);
  });

  it('refuses aiming the opponent-only effect at its controller', () => {
    const start = board();
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(start.state, 0, SLAUGHTER_GAMES.name),
        targets: [{ kind: 'player', player: 0 }],
      }),
    ).not.toBeNull();
  });
});
