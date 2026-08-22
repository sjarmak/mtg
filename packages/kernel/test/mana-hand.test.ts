/**
 * Auto-tapping against the rest of the payer's hand.
 *
 * The rule under test is the playtester's, in her words: "if I have 3 swamps and a
 * forest and I want to cast a colorless 3 drop and a 1 drop that costs green,
 * when I play the three drop it should tap the swamps not the forest."
 *
 * Three properties hold it up, and each is asserted rather than described: the
 * lands a payment spends are the ones the hand needs least, the choice among
 * genuine equals is stable rather than seeded, and no plan is moved by the
 * other seat's hand.
 */
import { describe, expect, it } from 'vitest';
import type { GameSession, GameState, ObjectId, PlayerAgent } from '@mtg/kernel';
import {
  choose,
  createSession,
  humanSeat,
  planPayment,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import { mana } from '@mtg/dsl';
import { creature, FOREST, lands, SWAMP } from './cards';
import { apply, handOidOf, oidsOf } from './helpers';

const threeDrop = creature('Colorless Three Drop', 3, 3, { cost: { generic: 3 } });
const greenOneDrop = creature('Green One Drop', 1, 1, { cost: { G: 1 } });
const doubleGreen = creature('Double Green', 2, 2, { cost: { G: 2 } });
const greenSevenDrop = creature('Green Seven Drop', 7, 7, { cost: { generic: 6, G: 1 } });

/** Three Swamps and a Forest, with whatever is stated in each seat's hand. */
function board(
  seed: string,
  hands: readonly [readonly ReturnType<typeof creature>[], readonly ReturnType<typeof creature>[]],
) {
  return scenario({
    seed,
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
    hands: [[...hands[0]], [...hands[1]]],
  });
}

const SEEDS = Array.from({ length: 20 }, (_, index) => `tap/${String(index)}`);

function forestTapped(state: GameState, taps: readonly ObjectId[]): boolean {
  const forests = oidsOf(state, 'Forest');
  return taps.some((oid) => forests.includes(oid));
}

describe("the playtester's example", () => {
  it('taps the three Swamps for a colorless three drop and leaves the Forest', () => {
    const start = board('swamps-not-forest', [[threeDrop, greenOneDrop], []]);
    const casting = handOidOf(start.state, 0, 'Colorless Three Drop');
    const plan = planPayment(start.state, 0, mana({ generic: 3 }), casting);

    expect(plan?.taps).toHaveLength(3);
    expect([...(plan?.taps ?? [])].sort()).toEqual([...oidsOf(start.state, 'Swamp')].sort());

    // The plan is what the reduction does, not a second opinion about it: cast
    // the three drop for real and the Forest is still standing, which is the
    // whole point — the green one drop is still castable.
    const cast = apply(start, { type: 'castSpell', player: 0, oid: casting, targets: [] });
    const forest = oidsOf(cast.state, 'Forest')[0];
    expect(cast.state.objects[forest ?? '']?.tapped).toBe(false);
    expect(planPayment(cast.state, 0, mana({ G: 1 }))).not.toBeNull();
  });

  it('spends the Forest freely when nothing in hand wants green', () => {
    // Non-vacuity for the test above: the Forest is spared because of the card
    // in hand and not because a Forest is special. Twenty seeds because the
    // reserve model is the only thing deciding this — take the green card out
    // of hand and the Forest is spent at every one of them.
    const withGreen = SEEDS.map((seed) => board(seed, [[threeDrop, greenOneDrop], []]));
    const withoutGreen = SEEDS.map((seed) => board(seed, [[threeDrop], []]));
    const plan = (start: ReturnType<typeof board>): readonly ObjectId[] =>
      planPayment(start.state, 0, mana({ generic: 3 }), handOidOf(start.state, 0, 'Colorless Three Drop'))
        ?.taps ?? [];

    expect(withGreen.filter((start) => forestTapped(start.state, plan(start)))).toHaveLength(0);
    expect(withoutGreen.filter((start) => forestTapped(start.state, plan(start))).length).toBeGreaterThan(0);
  });
});

describe('what the hand reserves', () => {
  it('reserves nothing for a card the lands could not pay for anyway', () => {
    // A `GG` card behind a single Forest, and a seven drop behind four lands.
    // Sparing the Forest buys neither cast, so it is spent like any other land.
    const doubled = SEEDS.map((seed) => board(seed, [[threeDrop, doubleGreen], []]));
    const seven = SEEDS.map((seed) => board(seed, [[threeDrop, greenSevenDrop], []]));
    const plan = (start: ReturnType<typeof board>): readonly ObjectId[] =>
      planPayment(start.state, 0, mana({ generic: 3 }), handOidOf(start.state, 0, 'Colorless Three Drop'))
        ?.taps ?? [];

    expect(doubled.filter((start) => forestTapped(start.state, plan(start))).length).toBeGreaterThan(0);
    expect(seven.filter((start) => forestTapped(start.state, plan(start))).length).toBeGreaterThan(0);
  });

  it('never lets a preference make a payable cost unpayable', () => {
    // Every land is wanted by something in hand, and the cost needs all four.
    // Preference loses to payability, so the plan is still a plan.
    const start = board('payability-wins', [
      [greenOneDrop, creature('Black One Drop', 1, 1, { cost: { B: 1 } })],
      [],
    ]);
    const plan = planPayment(start.state, 0, mana({ generic: 3, G: 1 }));

    expect(plan?.taps).toHaveLength(4);
    expect([...(plan?.taps ?? [])].sort()).toEqual([...start.state.battlefield].sort());
  });

  it('does not count the card being cast as a reason to save a land for it', () => {
    // The green one drop is the card being paid for. Its own pip is the cost,
    // not a reservation, so the Forest pays it rather than being saved from it.
    const start = board('casting-itself', [[greenOneDrop], []]);
    const casting = handOidOf(start.state, 0, 'Green One Drop');
    const plan = planPayment(start.state, 0, mana({ G: 1 }), casting);

    expect(plan?.taps).toEqual([oidsOf(start.state, 'Forest')[0]]);
    expect(plan?.produces).toEqual(['G']);
  });
});

describe('hidden information', () => {
  it('is never moved by the other seat’s hand', () => {
    // The green one drop is in the opponent's hand this time. A planner that
    // read it would spare the Forest on all twenty seeds; this one spends it,
    // because the only hand it can reach is the payer's own.
    const opponentHolds = SEEDS.map((seed) => board(seed, [[threeDrop], [greenOneDrop]]));
    const spent = opponentHolds.filter((start) =>
      forestTapped(
        start.state,
        planPayment(start.state, 0, mana({ generic: 3 }), handOidOf(start.state, 0, 'Colorless Three Drop'))
          ?.taps ?? [],
      ),
    );

    expect(spent.length).toBeGreaterThan(0);
  });
});

describe('the tiebreak is stable', () => {
  const fourSwamps = (seed: string): ReturnType<typeof scenario> =>
    scenario({
      seed,
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
    });
  const tapsAt = (seed: string): readonly ObjectId[] =>
    planPayment(fourSwamps(seed).state, 0, mana({ generic: 2 }))?.taps ?? [];

  it('takes the first two of four identical Swamps, at every seed', () => {
    // The playtester asked for a random tiebreak here and then took the stable one
    // on the evidence: the seeded version's only observable effect across the
    // suite was swapping two identical Plains inside a pinned replay fixture.
    // So the assertion is the strong one — same pair, whatever the seed — and
    // it is what makes "why did it tap that one" a question with an answer.
    const start = fourSwamps('tiebreak/a');
    const swamps = oidsOf(start.state, 'Swamp');
    expect(planPayment(start.state, 0, mana({ generic: 2 }))?.taps).toEqual(swamps.slice(0, 2));

    const distinct = new Set(SEEDS.map((seed) => tapsAt(seed).join(',')));
    expect(distinct.size).toBe(1);
  });
});

describe('a played game still replays', () => {
  const deck = {
    name: 'Golgari',
    cards: [
      ...lands(SWAMP, 8),
      ...lands(FOREST, 8),
      ...Array.from({ length: 8 }, () => greenOneDrop),
      ...Array.from({ length: 8 }, () => threeDrop),
      ...Array.from({ length: 8 }, () => doubleGreen),
    ],
  };
  const setup = { seed: 'mana-hand/replay', decks: [deck, deck] as const, maximumTurns: 30 };
  const seats = () => [humanSeat('one'), humanSeat('two')] as const;

  /**
   * Plays both seats by hand, taking whatever the bot would have taken. Two
   * human seats rather than two bots because a bot seat decides for itself and
   * records no choice, and it is the recorded integers `replaySession` spends.
   */
  function playOut(session: GameSession, agent: PlayerAgent): GameSession {
    let current = session;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const decision = current.pending;
      if (decision === null) return current;
      const wanted = JSON.stringify(
        agent.decide({ state: current.state, player: decision.player, decision }),
      );
      const index = decision.options.findIndex((option) => JSON.stringify(option) === wanted);
      if (index < 0) throw new Error(`the bot chose a move the enumeration does not offer: ${wanted}`);
      current = choose(current, index);
    }
    throw new Error('the session never stopped asking');
  }

  it('reproduces its fingerprint and every tap through replaySession', () => {
    const played = playOut(createSession(setup, seats()), simpleAgent('mirror'));
    const replayed = replaySession(setup, seats(), played.choices);

    expect(played.choices.length).toBeGreaterThan(100);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));

    // The taps by name rather than by fingerprint alone: the payment planner is
    // the thing that changed, so the assertion says which lands were tapped and
    // in what order rather than trusting a hash to have noticed.
    const tapped = (session: GameSession): readonly string[] =>
      session.events.flatMap((event) =>
        event.type === 'manaProduced' ? [`${event.sourceOid}:${event.color}`] : [],
      );
    expect(tapped(replayed)).toEqual(tapped(played));
    expect(tapped(played).length).toBeGreaterThan(10);
  });
});
