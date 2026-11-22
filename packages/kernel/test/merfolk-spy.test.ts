/** Native retained-player and deterministic hidden-hand proofs for M11 Merfolk Spy. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  nextBelow,
  pendingDecision,
  scenario,
  seatEvents,
  type ReduceResult,
  type StackEntry,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf, playCombat } from './helpers';

function merfolkSpy(): Card {
  return parseCard({
    kind: 'creature',
    id: 'm11-066-merfolk-spy-kernel',
    name: 'Merfolk Spy',
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 66 },
    manaCost: { U: 1 },
    colors: ['U'],
    subtypes: ['Merfolk', 'Rogue'],
    power: 1,
    toughness: 1,
    keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToPlayer',
        effects: [{ kind: 'revealRandomCardFromHand', target: { kind: 'triggeringPlayer' } }],
      },
    ],
  } as unknown as CardInput);
}

function hand(): readonly Card[] {
  return [creature('Hidden Alpha', 1, 1), creature('Hidden Beta', 2, 2), creature('Hidden Gamma', 3, 3)];
}

function setup(seed: string, defendingHand: readonly Card[] = hand()): ReduceResult {
  return scenario({
    seed,
    active: 0,
    step: 'declareAttackers',
    battlefield: [{ card: merfolkSpy(), controller: 0 }],
    hands: [[], defendingHand],
  });
}

function abilityEntries(result: ReduceResult): readonly StackEntry[] {
  return result.state.stack.filter((entry) => entry.ability !== null);
}

function advanceUntilTrigger(from: ReduceResult): ReduceResult {
  const spy = oidOf(from.state, 'Merfolk Spy');
  let current = apply(from, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: spy, defender: 1 }],
  });
  for (let guard = 0; guard < 80; guard += 1) {
    if (abilityEntries(current).length > 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'declareBlockers') {
      current = apply(current, { type: 'declareBlockers', player: decision.player, blocks: [] });
      continue;
    }
    if (decision?.kind === 'priority') {
      current = apply(current, { type: 'passPriority', player: decision.player });
      continue;
    }
    throw new Error(`combat did not put the trigger on the stack (${decision?.kind ?? 'no decision'})`);
  }
  throw new Error('combat did not put the trigger on the stack');
}

describe("Merfolk Spy's random hand reveal", () => {
  it('retains the damaged player without creating a CR 115 target', () => {
    const triggered = advanceUntilTrigger(setup('merfolk-spy/context'));
    const [entry] = abilityEntries(triggered);

    expect(entry?.triggerContext).toEqual({
      kind: 'selfDealsCombatDamageToPlayer',
      triggeringPlayer: 1,
    });
    expect(entry?.targets).toEqual([]);
  });

  it('reveals exactly the card selected by the seeded uniform draw and advances the RNG once', () => {
    const start = setup('merfolk-spy/random');
    const spy = oidOf(start.state, 'Merfolk Spy');
    const defendingHand = start.state.players[1].hand;
    const [pick, expectedRng] = nextBelow(start.state.rng, defendingHand.length);
    const expected = defendingHand[pick];
    if (expected === undefined) throw new Error('seeded pick escaped the hand');

    const done = playCombat(start, { attackers: [spy], blocks: [] });
    const reveals = eventsOfType(done.events, 'handRevealed');

    expect(reveals).toEqual([{ type: 'handRevealed', player: 1, oids: [expected] }]);
    expect(done.state.rng).toEqual(expectedRng);
    expect(done.state.players[1].hand).toEqual(defendingHand);
  });

  it('reveals nothing and consumes no random draw when the damaged player has no cards', () => {
    const start = setup('merfolk-spy/empty', []);
    const spy = oidOf(start.state, 'Merfolk Spy');
    const before = start.state.rng;

    const done = playCombat(start, { attackers: [spy], blocks: [] });

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([]);
    expect(done.state.rng).toEqual(before);
  });

  it('publishes only the selected hidden identity to both replay projections', () => {
    const start = setup('merfolk-spy/projection');
    const spy = oidOf(start.state, 'Merfolk Spy');
    const done = playCombat(start, { attackers: [spy], blocks: [] });
    const reveal = eventsOfType(done.events, 'handRevealed')[0];
    if (reveal === undefined) throw new Error('random reveal did not happen');

    for (const viewer of [0, 1] as const) {
      expect(
        eventsOfType(seatEvents(done.events, viewer, `viewer-${String(viewer)}`), 'handRevealed'),
      ).toEqual([reveal]);
    }
    expect(reveal.oids).toHaveLength(1);
    expect(start.state.players[1].hand).toContain(reveal.oids[0]);
  });

  it('does not trigger when combat damage lands on a blocker', () => {
    const blocker = creature('Merfolk Catcher', 0, 3);
    const start = scenario({
      seed: 'merfolk-spy/blocked',
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: merfolkSpy(), controller: 0 },
        { card: blocker, controller: 1 },
      ],
      hands: [[], hand()],
    });
    const spy = oidOf(start.state, 'Merfolk Spy');
    const catcher = oidOf(start.state, blocker.name);

    const done = playCombat(start, {
      attackers: [spy],
      blocks: [{ blocker: catcher, attacker: spy }],
    });

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([]);
    expect(eventsOfType(done.events, 'abilityTriggered').filter((event) => event.source === spy)).toEqual([]);
  });
});
