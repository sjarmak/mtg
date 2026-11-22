/** Native resolution for RTR Search Warrant's one player target. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  playerOf,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, ISLAND, PLAINS } from './cards';
import { apply, handOidOf } from './helpers';

const SEARCH_WARRANT = parseCard({
  kind: 'sorcery',
  id: 'rtr-193-search-warrant-kernel',
  name: 'Search Warrant',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 193 },
  manaCost: { W: 1, U: 1 },
  colors: ['W', 'U'],
  effects: [
    { kind: 'revealHand', target: { kind: 'targetPlayer' } },
    {
      kind: 'gainLife',
      amount: 0,
      amountFrom: 'thatPlayersHandSize',
      target: { kind: 'noTarget' },
    },
  ],
});

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'rtr-search-warrant-hexproof',
  name: 'Search Warrant Hexproof',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 193 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
});

function castAt(
  hand: readonly ReturnType<typeof creature>[],
  graveyard: readonly ReturnType<typeof creature>[] = [],
): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
    hands: [[SEARCH_WARRANT], [...hand]],
    graveyards: [[], [...graveyard]],
  });
  return apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, SEARCH_WARRANT.name),
    targets: [{ kind: 'player', player: 1 }, null],
  });
}

function resolve(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Search Warrant probe lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Search Warrant probe did not empty the stack');
}

describe('RTR #193 Search Warrant', () => {
  it('reveals the chosen player whole and gains exactly their live hand size', () => {
    const cast = castAt([
      creature('Search Warrant Held One', 1, 1),
      creature('Search Warrant Held Two', 2, 2),
      creature('Search Warrant Held Three', 3, 3),
    ]);
    const expected = [...playerOf(cast.state, 1).hand];
    const done = resolve(cast);

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([
      { type: 'handRevealed', player: 1, oids: expected },
    ]);
    expect(playerOf(done.state, 0).life).toBe(23);
    expect(playerOf(done.state, 1).hand).toEqual(expected);
  });

  it('reveals an empty hand and gains zero life', () => {
    const done = resolve(castAt([]));

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([
      { type: 'handRevealed', player: 1, oids: [] },
    ]);
    expect(playerOf(done.state, 0).life).toBe(20);
  });

  it('reads the hand at resolution after it changed on the stack', () => {
    const cast = castAt(
      [creature('Search Warrant Live Held', 1, 1)],
      [creature('Search Warrant Live Moved', 2, 2)],
    );
    const moved = playerOf(cast.state, 1).graveyard[0];
    if (moved === undefined) throw new Error('Search Warrant live probe lost its moved card');
    const changed = moveObject(beginTrace(cast.state), moved, 'hand');
    const done = resolve({ state: changed.state, events: [...cast.events, ...changed.events] });

    expect(eventsOfType(done.events, 'handRevealed')[0]?.oids).toHaveLength(2);
    expect(playerOf(done.state, 0).life).toBe(22);
  });

  it('fizzles the reveal and linked gain when its sole player target becomes illegal', () => {
    const cast = castAt([LEYLINE, creature('Search Warrant Protected Card', 2, 2)]);
    const leylineOid = handOidOf(cast.state, 1, LEYLINE.name);
    const protectedTrace = moveObject(beginTrace(cast.state), leylineOid, 'battlefield', { controller: 1 });
    const done = resolve({ state: protectedTrace.state, events: [...cast.events, ...protectedTrace.events] });

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([]);
    expect(eventsOfType(done.events, 'lifeChanged')).toEqual([]);
    expect(eventsOfType(done.events, 'spellFizzled')).toHaveLength(1);
    expect(playerOf(done.state, 0).life).toBe(20);
  });
});
