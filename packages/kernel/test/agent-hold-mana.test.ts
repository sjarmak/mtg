/**
 * Whether the kernel's own bot keeps the mana a counterspell in its hand needs.
 *
 * It did not (`mtg-c86f`). `castValue` prices the act of casting and nothing
 * else, so on its own main phase the agent spent every land it had on the
 * biggest thing in hand, and the counterspell it was holding sat there while
 * the opponent untapped and resolved a spell into an empty board.
 *
 * A counterspell is the one card in the vocabulary where that is the difference
 * between castable and uncastable rather than between well and badly timed.
 * "Counter target spell" chooses its target off the stack
 * (`target-choices.ts`), so with an empty stack there is no legal target, CR
 * 601.2c cannot be satisfied, and `castOptions` never enumerates the cast at
 * all — the agent could not have spent the mana on it while it had any, and by
 * the time the window opened the mana was gone. The consequence was not a bot
 * that plays counterspells badly. It was a set-design constraint: a card the
 * reference agent structurally cannot cast is unplayable by the only player
 * every balance number is measured with, which is why the flagship's blue lane
 * shipped held-tap Auras instead.
 *
 * The spine of this file is the first case: a position the old agent lost the
 * counterspell in, played forward by the real driver rather than scored one
 * decision at a time, so what it asserts is a game and not an arithmetic.
 * Everything after it is a release valve — the two conditions that stop the
 * agent holding mana forever, and the proof that a hold which buys nothing is
 * still spent on the following turn.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { GameEvent, GameState } from '@mtg/kernel';
import { eventsOfType, playOut, scenario, serializeEvents, simpleAgent } from '@mtg/kernel';
import { creature, instant, ISLAND, lands, MOUNTAIN } from './cards';

const COUNTER = 'Test Counter';
const DRAKE = 'Test Drake';
const SENTRY = 'Test Sentry';
const BEAR = 'Test Bear';
const PINGER = 'Test Beacon';

/** `{1}{U}: Counter target spell.` */
const counter = (): Card => instant(COUNTER, [{ kind: 'counterSpell' }], { generic: 1, U: 1 });

/** `{2}{U}: 2/2.` Three mana on three Islands is the whole of the conflict. */
const drake = (): Card => creature(DRAKE, 2, 2, { cost: { generic: 2, U: 1 } });

/** The body the hold policy requires before it will hold anything. */
const sentry = (): Card => creature(SENTRY, 1, 3, { cost: { generic: 1, U: 1 } });

/** What the opponent casts into the window. */
const bear = (): Card => creature(BEAR, 2, 2, { cost: { generic: 1, R: 1 } });

/**
 * `{2}: Test Beacon deals 1 damage to target creature.` No tap: repeatable.
 *
 * Two mana rather than one so that activating it actually breaks the reserve:
 * off three Islands a one-mana activation leaves the counterspell payable and
 * the test would assert nothing.
 */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 2 }, tapSelf: false },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
};

interface Position {
  /** Blue's own creature, which `holdWindowOpen` requires before it will hold. */
  readonly body: boolean;
  /** Cards in blue's hand beyond the counterspell. */
  readonly hand?: readonly Card[];
  /** Cards in red's hand. Empty means there is nothing left to counter. */
  readonly opposing?: readonly Card[];
  /** Blue's lands. Mountains stand in for "cannot pay {U}". */
  readonly lands?: readonly Card[];
  /**
   * A permanent of blue's with a mana-costed activated ability, and a creature
   * of red's for it to point at — the ability arm only outranks passing once
   * there is something across the table to shoot (`agent-bad-aim.test.ts`).
   */
  readonly beacon?: boolean;
}

/**
 * Blue on its own precombat main with three Islands, a counterspell and a
 * three-drop, against red holding a two-drop and two Mountains.
 *
 * Three Islands is the number that makes this a decision: the Drake costs all
 * three and the counterspell costs two, so exactly one of them happens this
 * turn cycle. With four the old agent already worked and the test would assert
 * nothing.
 *
 * Turn 2 rather than turn 1 so red has had a turn and blue's board is a
 * position rather than an opening, and `maximumTurns: 4` so the run covers
 * blue's turn, red's turn with the window in it, and blue's next turn — the
 * three turns the whole policy happens in.
 */
function position(spec: Position): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const blueLands = spec.lands ?? lands(ISLAND, 3);
  const start = scenario({
    seed: 'hold-open',
    active: 0,
    turn: 2,
    battlefield: [
      ...(spec.body ? [{ card: sentry(), controller: 0 as const }] : []),
      ...((spec.beacon ?? false)
        ? [
            {
              card: creature(PINGER, 0, 3, { cost: { generic: 2 }, abilities: [PING] }),
              controller: 0 as const,
            },
          ]
        : []),
      ...((spec.beacon ?? false) ? [{ card: creature(BEAR, 2, 2), controller: 1 as const }] : []),
      ...blueLands.map((card) => ({ card, controller: 0 as const })),
      ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[counter(), ...(spec.hand ?? [drake()])], [...(spec.opposing ?? [bear()])]],
    libraries: [lands(ISLAND, 10), lands(MOUNTAIN, 10)],
    maximumTurns: 4,
  });
  const run = playOut(start.state, [simpleAgent('blue'), simpleAgent('red')]);
  return { state: run.state, events: run.events };
}

/** Every spell cast in the run, named, in the order the log recorded them. */
function castNames(played: {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}): readonly string[] {
  return eventsOfType(played.events, 'spellCast').map(
    (event) => played.state.objects[event.oid]?.card.name ?? '?',
  );
}

describe('the kernel bot holds mana for a counterspell it can cast', () => {
  it('counters the opposing spell instead of tapping out on its own turn', () => {
    const played = position({ body: true });
    expect(eventsOfType(played.events, 'spellCountered')).toHaveLength(1);
    expect(castNames(played)).toContain(COUNTER);
  });

  it('declines the three-drop on the turn it holds, which is what the hold costs', () => {
    // The Bear resolving would be the old behavior; the Bear being cast first
    // and the Drake last is the new one, and the order is the whole assertion.
    expect(castNames(position({ body: true }))).toStrictEqual([BEAR, COUNTER, DRAKE]);
  });

  it('spends the held mana on the next turn rather than holding it forever', () => {
    // The release valve: once the counterspell is gone the reserve is gone with
    // it, so the spell the hold declined is cast on blue's following turn.
    const played = position({ body: true });
    expect(castNames(played)).toContain(DRAKE);
  });

  it('plays the same game twice from one seed', () => {
    expect(serializeEvents(position({ body: true }).events)).toBe(
      serializeEvents(position({ body: true }).events),
    );
  });
});

describe('the two conditions that stop the bot holding forever', () => {
  it('develops instead of holding while it controls no creature', () => {
    // A seat with an empty battlefield has a next turn worth more than any
    // window, and it is the position an unconditional hold starves: hold, cast
    // nothing, hold again, still no board.
    const played = position({ body: false });
    expect(castNames(played)).toContain(DRAKE);
    expect(eventsOfType(played.events, 'spellCountered')).toHaveLength(0);
  });

  it('spends its mana when the opponent has no card left to cast', () => {
    // Nothing is coming, so the reservation buys nothing. CR 108.3: the number
    // of cards in a hand is free information, and the number is all this reads.
    const played = position({ body: true, opposing: [] });
    expect(castNames(played)).toStrictEqual([DRAKE]);
  });
});

describe('what the reservation is measured in', () => {
  it('reserves nothing for a counterspell the battlefield cannot pay for', () => {
    // Three Mountains and a {1}{U} counterspell: keeping them standing buys a
    // cast that cannot happen, so the reserve is empty and the generic-costed
    // spell is cast. `handReserve` in `mana.ts` turns the same card down one
    // layer lower for the same reason.
    const played = position({
      body: true,
      lands: lands(MOUNTAIN, 3),
      hand: [creature(DRAKE, 2, 2, { cost: { generic: 3 } })],
    });
    expect(castNames(played)).toContain(DRAKE);
    expect(castNames(played)).not.toContain(COUNTER);
  });

  it('does not hold against the counterspell itself', () => {
    // Two counterspells in hand: reserving for the second must not refuse the
    // first, or a seat with two answers casts neither.
    const played = position({ body: true, hand: [counter()] });
    expect(eventsOfType(played.events, 'spellCountered')).toHaveLength(1);
  });
});

describe('the activation arm of the same reservation', () => {
  it('declines an activated ability that would spend the reserve', () => {
    // An activation is mana off the table exactly as a cast is, and the
    // activation arm exists to spend *leftover* mana. Unguarded it would hand
    // the reserve to a pinger the moment the cast arm declined to spend it.
    //
    // Ordering rather than a count, because activating *after* the window is
    // exactly right: once the counterspell has been cast the reserve is gone
    // with it and the beacon is the best use of what is left. What must not
    // happen is an activation before the window ever opens.
    const played = position({ body: true, beacon: true, hand: [] });
    const kinds = played.events.map((event) => event.type);
    expect(kinds).toContain('spellCountered');
    expect(kinds.indexOf('abilityActivated')).toBeGreaterThan(kinds.indexOf('spellCountered'));
  });
});
