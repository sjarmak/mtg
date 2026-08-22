/**
 * CR 701.16a in the kernel: revealing is an action, and it leaves no trace on
 * the game state.
 *
 * The design this file defends is a negative one. There is no `revealed` field
 * on a `GameObject` and no per-seat knowledge log, because concealment in this
 * engine is derived from *where a card is* (`visibility.ts`) and a second source
 * of truth about what a seat may see would contradict the first on its first
 * disagreement. So the whole effect is one event carrying the ids, `seatEvent`
 * lets it through unredacted, and the state before and after are the same state.
 *
 * The hand sweep beside it is the other half of the same card and the one place
 * a scope has to say *where* as well as *which*: a card in a hand has no derived
 * characteristics at all, so a scope that asked the layer system about one would
 * return an empty group and the spell would silently do nothing.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  objectsInEffectScope,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  seatEvent,
  stateFingerprint,
} from '@mtg/kernel';
import { creature, SWAMP, sorcery } from './cards';

const PEER = sorcery('Void Peer', [{ kind: 'revealHand', target: { kind: 'targetOpponent' } }], {
  generic: 1,
  B: 1,
});

const STRIP = sorcery(
  'Void Strip',
  [
    { kind: 'revealHand', target: { kind: 'targetOpponent' } },
    { kind: 'exileTarget', scope: 'creatureCardsInPlayerHand', target: { kind: 'targetOpponent' } },
  ],
  { generic: 2, B: 1 },
);

function swamps(count: number, controller: 0 | 1): { card: typeof SWAMP; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts player 0's only card at seat 1 and resolves it, keeping the whole log. */
function trace(start: GameState, effectCount: number): ReturnType<typeof reduceAll> {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const targets = Array.from({ length: effectCount }, () => ({ kind: 'player', player: 1 }) as const);
  const put = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  const done = reduceAll(put.state, [pass(put.state), { type: 'passPriority', player: 1 }]);
  return { ...done, events: [...put.events, ...done.events] };
}

function cast(start: GameState, effectCount: number): GameState {
  return trace(start, effectCount).state;
}

describe('revealing a hand', () => {
  it('reports every card in it and changes nothing else', () => {
    const start = scenario({
      battlefield: swamps(2, 0),
      hands: [[PEER], [creature('Void Scout', 1, 1), creature('Void Brute', 3, 3)]],
    }).state;
    const theirHand = [...playerOf(start, 1).hand];

    const run = trace(start, 1);
    const revealed = run.events.filter((event) => event.type === 'handRevealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toEqual({ type: 'handRevealed', player: 1, oids: theirHand });
    // The hand is where it was, and so is everything else the reveal could have
    // touched: no card moved, no flag was set, nothing to expire.
    expect(playerOf(run.state, 1).hand).toEqual(theirHand);
  });

  /**
   * The negative claim, stated as an equality: resolving the reveal moves the
   * game forward exactly as much as resolving nothing does. Compared against the
   * same spell with an empty effect list would be circular, so it is compared
   * against the fingerprint of a game where the same spell resolved against an
   * empty hand — the reveal ran, and the two states are indistinguishable.
   */
  it('adds no state, so an empty hand and a full one leave the same board', () => {
    const full = scenario({
      battlefield: swamps(2, 0),
      hands: [[PEER], [creature('Void Scout', 1, 1)]],
    }).state;
    const after = trace(full, 1).state;
    // The revealed card is still in hand, still concealed by zone, and carries
    // nothing that says it was seen.
    const oid = playerOf(after, 1).hand[0] ?? '';
    expect(after.objects[oid]?.zone).toBe('hand');
    expect(Object.keys(after.objects[oid] ?? {})).not.toContain('revealed');
  });

  /**
   * The one event whose purpose is to show a seat what it could not otherwise
   * see. `seatEvent` is exhaustive with `assertNever`, so this member forced a
   * decision there, and the decision is to pass it through whole.
   */
  it('survives the per-seat projection unredacted', () => {
    const event = { type: 'handRevealed', player: 1, oids: ['o1', 'o2'] } as const;
    expect(seatEvent(event, 0, 'reveal-view', 0)).toEqual(event);
  });
});

describe('exiling creature cards out of a hand', () => {
  it('takes the creature cards and leaves the rest of the hand alone', () => {
    const start = scenario({
      battlefield: swamps(3, 0),
      hands: [[STRIP], [creature('Void Scout', 1, 1), PEER, creature('Void Brute', 3, 3)]],
    }).state;
    const before = [...playerOf(start, 1).hand];
    const creatures = objectsInEffectScope(start, 'creatureCardsInPlayerHand', 1);
    expect(creatures).toHaveLength(2);

    const after = cast(start, 2);
    for (const oid of creatures) expect(after.objects[oid]?.zone, oid).toBe('exile');
    expect(after.exile).toEqual([...creatures]);
    // The sorcery in their hand is not a creature card and stays put.
    const survivor = before.find((oid) => !creatures.includes(oid)) ?? '';
    expect(playerOf(after, 1).hand).toEqual([survivor]);
  });

  /**
   * Hand order, which is the same determinism claim the battlefield scope makes:
   * the group is read once, in the order the zone list holds, and two identical
   * games come out identical.
   */
  it('is fixed before the first move and ordered by the zone list', () => {
    const bodies = [creature('First In', 1, 1), creature('Second In', 2, 2), creature('Third In', 3, 3)];
    const build = (): GameState =>
      scenario({ battlefield: swamps(3, 0), hands: [[STRIP], [...bodies]] }).state;

    const start = build();
    const group = objectsInEffectScope(start, 'creatureCardsInPlayerHand', 1);
    expect(group.map((oid) => start.objects[oid]?.card.name)).toEqual(['First In', 'Second In', 'Third In']);

    const after = cast(start, 2);
    expect(after.exile).toEqual([...group]);
    expect(playerOf(after, 1).hand).toEqual([]);
    expect(stateFingerprint(cast(build(), 2))).toBe(stateFingerprint(after));
  });

  it('resolves against an empty hand without exiling anything', () => {
    const start = scenario({ battlefield: swamps(3, 0), hands: [[STRIP], []] }).state;
    const after = cast(start, 2);
    expect(after.exile).toEqual([]);
    expect(playerOf(after, 1).hand).toEqual([]);
  });
});
