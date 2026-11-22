/** Time Reversal through casting, seeded shuffles, draws, and spell cleanup. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { beginTrace, copySpellOnStack, eventsOfType, playerOf, scenario } from '@mtg/kernel';
import { creature, ISLAND, lands } from './cards';
import { apply, handOidOf } from './helpers';

const TIME_REVERSAL: Card = parseCard({
  kind: 'sorcery',
  id: 'm11-075',
  name: 'Time Reversal',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 75 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  effects: [
    { kind: 'shuffleHandsAndGraveyardsIntoLibraries' },
    { kind: 'drawCards', count: 7, players: 'eachPlayer', target: { kind: 'noTarget' } },
    { kind: 'exileThisSpell' },
  ],
} as unknown as CardInput);

const CASTER_HAND = creature('Former Caster Hand', 1, 1);
const CASTER_GRAVE = creature('Former Caster Grave', 1, 1);
const OTHER_HAND = creature('Former Other Hand', 1, 1);
const OTHER_GRAVE = creature('Former Other Grave', 1, 1);
const CASTER_LIBRARY = Array.from({ length: 8 }, (_, index) =>
  creature(`Caster Library ${String(index)}`, 1, 1),
);
const OTHER_LIBRARY = Array.from({ length: 8 }, (_, index) =>
  creature(`Other Library ${String(index)}`, 1, 1),
);

function board(): ReduceResult {
  return scenario({
    seed: 'time-reversal/two-seats',
    battlefield: lands(ISLAND, 5).map((card) => ({ card, controller: 0 as const })),
    hands: [[TIME_REVERSAL, CASTER_HAND], [OTHER_HAND]],
    graveyards: [[CASTER_GRAVE], [OTHER_GRAVE]],
    libraries: [CASTER_LIBRARY, OTHER_LIBRARY],
  });
}

function cast(from: ReduceResult): ReduceResult {
  return apply(from, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, TIME_REVERSAL.name),
    targets: [null, null, null],
  });
}

function resolveTop(from: ReduceResult): ReduceResult {
  let current = apply(from, { type: 'passPriority', player: 0 });
  current = apply(current, { type: 'passPriority', player: 1 });
  return current;
}

describe('Time Reversal resolution', () => {
  it('resets both seats, draws seven, and exiles the resolving card reproducibly', () => {
    const firstCast = cast(board());
    const spellOid = firstCast.state.stack.at(-1)?.oid;
    if (spellOid === undefined) throw new Error('Time Reversal was not cast');
    const first = resolveTop(firstCast);
    const second = resolveTop(cast(board()));

    expect(first.state.players.map((seat) => seat.hand.length)).toEqual([7, 7]);
    expect(first.state.players.map((seat) => seat.graveyard.length)).toEqual([0, 0]);
    expect(first.state.players.map((seat) => seat.library.length)).toEqual([3, 3]);
    expect(eventsOfType(first.events, 'libraryShuffled').map((event) => event.player)).toEqual([0, 1]);
    expect(first.state.objects[spellOid]?.zone).toBe('exile');
    expect(first.state.exile).toContain(spellOid);
    expect(playerOf(first.state, 0).graveyard).not.toContain(spellOid);
    expect(first.state.players.map((seat) => seat.library)).toEqual(
      second.state.players.map((seat) => seat.library),
    );
    expect(first.state.players.map((seat) => seat.hand)).toEqual(
      second.state.players.map((seat) => seat.hand),
    );
  });

  it('lets a copied spell cease without exiling the original beneath it', () => {
    const original = cast(board());
    const spellOid = original.state.stack.at(-1)?.oid;
    if (spellOid === undefined) throw new Error('Time Reversal was not cast');
    const copiedTrace = copySpellOnStack(beginTrace(original.state), spellOid);
    const copied: ReduceResult = {
      state: copiedTrace.state,
      events: [...original.events, ...copiedTrace.events],
    };

    const afterCopy = resolveTop(copied);
    expect(afterCopy.state.stack.map((entry) => entry.oid)).toEqual([spellOid]);
    expect(afterCopy.state.objects[spellOid]?.zone).toBe('stack');
    expect(afterCopy.state.exile).not.toContain(spellOid);

    const afterOriginal = resolveTop(afterCopy);
    expect(afterOriginal.state.stack).toHaveLength(0);
    expect(afterOriginal.state.objects[spellOid]?.zone).toBe('exile');
  });
});
