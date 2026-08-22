/**
 * A permanent spell resolves onto the battlefield, and a death trigger fires
 * from a death (CR 608.3, CR 603.2).
 *
 * This file exists because of a report from a played game: a 4/4 creature whose
 * only printed ability was "when this dies, create a token" was cast, and the
 * next thing on screen was the token, with the creature in a graveyard. Read
 * literally that is a resolution putting a permanent spell in the wrong zone, or
 * a state-based action killing it on arrival, or `selfDies` raised off an
 * arrival — three separate kernel faults, any of which would misfire every death
 * trigger in a set built on them.
 *
 * The kernel does none of the three, and this is the pin that says so. What was
 * actually happening is one layer out and is not a rules question at all: the
 * opponent answered the creature with removal at their own priority, the player
 * held no instant so nothing stopped for them (`autopass.ts`'s `canRespond`,
 * `mtg-hmy`), and the cast, the removal, the death and the token all landed
 * inside a single press. `the exchange is a sequence, not a resolution` below is
 * that whole run written out as events, which is the evidence the report was
 * about pacing rather than about CR 608, and `mtg-302` is where the pacing is
 * argued.
 *
 * Names here are invented rather than borrowed from any set: a fixture is where
 * card names belong, and a test that needed one had better not reach for a real
 * card's (see the public-boundary rules in AGENTS.md).
 */
import { describe, expect, it } from 'vitest';
import type { TokenSpec } from '@mtg/dsl';
import type { Action, GameSession, GameSetup, ObjectId, ReduceResult, Seat } from '@mtg/kernel';
import {
  advance,
  botSeat,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  eventsOfType,
  getObject,
  humanSeat,
  playerOf,
  reduce,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { creature, instant, lands, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

/** The body the death trigger leaves behind. */
const REVENANT: TokenSpec = {
  name: 'Cinder Revenant',
  power: 3,
  toughness: 3,
  colors: ['B'],
  subtypes: ['Spirit'],
  keywords: ['menace'],
  abilities: [],
};

/** A four-mana 4/4 whose only ability is a death trigger. */
const HOLLOW_WARDEN = creature('Hollow Warden', 4, 4, {
  cost: { generic: 2, B: 2 },
  subtypes: ['Horror'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'createToken', count: 1, token: REVENANT }],
    },
  ],
});

const UNMAKE = instant(
  'Unmake the Vessel',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  {
    B: 2,
  },
);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/** Six untapped Swamps a side and the warden in player 0's hand. */
function board(...alsoInHand: readonly (typeof UNMAKE)[]): ReduceResult {
  return scenario({
    battlefield: [
      ...lands(SWAMP, 6).map((card) => ({ card, controller: 0 as const })),
      ...lands(SWAMP, 6).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[HOLLOW_WARDEN], [...alsoInHand]],
  });
}

/** Passes whichever priority is owed, `rounds` times, so the stack empties. */
function settleByPassing(from: ReduceResult, rounds: number): ReduceResult {
  let current = from;
  for (let round = 0; round < rounds; round += 1) {
    const priority = current.state.turn.priority;
    if (priority === null) return current;
    current = apply(current, { type: 'passPriority', player: priority });
  }
  return current;
}

/** Casts the warden from player 0's hand and lets both players pass it through. */
function castWarden(start: ReduceResult): { readonly result: ReduceResult; readonly oid: ObjectId } {
  const oid = handOidOf(start.state, 0, HOLLOW_WARDEN.name);
  const cast = reduce(start.state, { type: 'castSpell', player: 0, oid, targets: [] });
  let current: ReduceResult = { state: cast.state, events: [...cast.events] };
  for (const action of PASS) current = apply(current, action);
  return { result: current, oid };
}

describe('a creature spell resolving', () => {
  /**
   * CR 608.3. The one assertion the whole report turned on, and it holds: the
   * spell leaves the stack for the battlefield, not for a graveyard.
   */
  it('puts the permanent on the battlefield', () => {
    const { result, oid } = castWarden(board());

    expect(getObject(result.state, oid).zone).toBe('battlefield');
    expect(result.state.battlefield).toContain(oid);
    expect(playerOf(result.state, 0).graveyard).not.toContain(oid);
    expect(result.state.stack).toEqual([]);
  });

  /**
   * The state-based action pass runs on the board this arrival made (CR 704),
   * and finds nothing to do: a 4/4 with no damage marked and no continuous
   * effect over it is not doomed, so nothing destroys it on the way in.
   */
  it('survives the state-based actions that follow the arrival', () => {
    const { result, oid } = castWarden(board());
    const object = getObject(result.state, oid);

    expect(object.damage).toBe(0);
    expect(eventsOfType(result.events, 'permanentDestroyed')).toEqual([]);
    // A creature that entered this turn is summoning sick and still alive; the
    // flag is the arrival's, and it is not a death of any kind.
    expect(object.summoningSick).toBe(true);
  });

  /**
   * `selfDies` is derived from a battlefield-to-graveyard zone change and from
   * nothing else, so an arrival raises no death trigger and mints no token. The
   * report's token appearing "immediately" cannot come from this path.
   */
  it('raises no death trigger and creates no token', () => {
    const { result } = castWarden(board());

    expect(eventsOfType(result.events, 'abilityTriggered')).toEqual([]);
    expect(eventsOfType(result.events, 'tokenCreated')).toEqual([]);
    expect(result.state.battlefield.filter((id) => result.state.objects[id]?.token === true)).toEqual([]);
  });
});

describe('the death trigger', () => {
  /** It takes a real death, and then it fires exactly once (CR 603.2). */
  it('fires once when removal actually kills the creature', () => {
    const { result, oid } = castWarden(board(UNMAKE));
    // The arrival hands priority back to the active player, so the answer is
    // cast at the opponent's own window rather than into the resolution.
    let current = apply(result, { type: 'passPriority', player: 0 });
    current = apply(current, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(current.state, 1, UNMAKE.name),
      targets: [{ kind: 'permanent', oid }],
    });
    current = settleByPassing(current, 6);

    const triggered = eventsOfType(current.events, 'abilityTriggered');
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.condition).toBe('selfDies');
    expect(getObject(current.state, oid).zone).toBe('graveyard');
    expect(eventsOfType(current.events, 'tokenCreated').map((event) => event.name)).toEqual([REVENANT.name]);
  });
});

describe('the exchange the report was actually about', () => {
  /**
   * A whole game, a human seat with the lab's own auto-pass settings, and a bot
   * holding removal. The point is the *order* of the events inside one press:
   * the warden reaches the battlefield first, the opponent casts a spell at it
   * after that, and only then does it reach a graveyard. Nothing here asserts
   * how the surface paces those events — that is a `SessionOptions` question and
   * a filed bead — but the sequence is what tells a pacing complaint apart from
   * a rules bug, and it is the kernel's to state.
   */
  it('is a sequence, not a resolution', () => {
    const deck = [...Array.from({ length: 8 }, () => HOLLOW_WARDEN), ...lands(SWAMP, 32)];
    const answer = [...Array.from({ length: 8 }, () => UNMAKE), ...lands(SWAMP, 32)];
    const setup: GameSetup = {
      seed: 'cast-resolution/exchange',
      decks: [
        { name: 'wardens', cards: deck },
        { name: 'answers', cards: answer },
      ],
    };
    const seats: readonly [Seat, Seat] = [humanSeat('You'), botSeat(simpleAgent('Bot'))];
    const options = { autoPass: DEFAULT_AUTO_PASS };

    let session: GameSession = createSession(setup, seats, options);
    let exchange: readonly { readonly kind: string; readonly oid: string }[] = [];
    for (let step = 0; step < 2000 && exchange.length === 0; step += 1) {
      if (session.result !== null) break;
      const decision = session.pending;
      if (decision === null) {
        const next = advance(session, options);
        if (next === session) break;
        session = next;
        continue;
      }
      let pick = decision.options.length - 1;
      for (const [index, option] of decision.options.entries()) {
        if (option.type === 'castSpell' || option.type === 'playLand') {
          pick = index;
          break;
        }
      }
      const before = session.events.length;
      session = choose(session, pick, options);
      const window = session.events.slice(before);
      const cast = window.find(
        (event) =>
          event.type === 'spellCast' &&
          event.player === 0 &&
          session.state.objects[event.oid]?.card.name === HOLLOW_WARDEN.name,
      );
      if (cast === undefined || cast.type !== 'spellCast') continue;
      const warden = cast.oid;
      exchange = window.flatMap((event) => {
        if (event.type === 'zoneChanged' && event.oid === warden) {
          return [{ kind: `${event.from}->${event.to}`, oid: String(event.oid) }];
        }
        if (event.type === 'spellCast' && event.player === 1) {
          return [{ kind: 'opponent casts', oid: String(event.oid) }];
        }
        return [];
      });
    }

    // The warden was cast, resolved onto the battlefield, and only then did an
    // opposing spell take it off. A resolution into the graveyard would show
    // `stack->graveyard` and no opposing cast at all.
    expect(exchange.map((entry) => entry.kind).slice(0, 3)).toEqual([
      'hand->stack',
      'stack->battlefield',
      'opponent casts',
    ]);
    expect(exchange.map((entry) => entry.kind)).toContain('battlefield->graveyard');
  });
});
