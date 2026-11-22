/**
 * The dense board the redesign is argued against.
 *
 * `mtg-aqxi`. The spec that opened this lane says the layout is to be judged at
 * a stated density and never on an almost-empty battlefield, and it states the
 * density card by card: the opponent on 20 life with six lands, three creatures,
 * one of them tapped, one of them under a counter, and two things on the stack;
 * the viewer on 18 with six lands, four creatures, one tapped, one under
 * counters, six cards in hand; both graveyards holding something; a main phase
 * with priority visible. That paragraph is this file.
 *
 * It is built through `scenario`, so the position is one the kernel could have
 * reached rather than a drawing of one — `@mtg/kernel`'s own builder walks the
 * board forward through the real turn machinery and refuses to fabricate a
 * state the rules do not allow. The two counters it cannot state are written on
 * afterwards with the kernel's own `setCounterCount`, because `ScenarioPermanent`
 * carries `loyalty` and nothing else; the stack is not written at all, it is
 * *cast*, by driving the opponent's seat through real `castSpell` options until
 * two spells are waiting and priority has come back around.
 *
 * The cards are `@mtg/dsl`'s example set, which is committed. A fixture that
 * read `public/set.json` would be a fixture about whichever set the last
 * `npm run play` staged, and `public/` is gitignored, so the same command would
 * capture a different board on a clean checkout than on this machine.
 */
import { exampleCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { choose, humanSeat, pendingDecision, scenario, setCounterCount } from '@mtg/kernel';
import type { GameObject, GameSession, GameState, ObjectId } from '@mtg/kernel';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-thornhide-guardian'),
] as const;

const TRICKS = [
  exampleCard('slc-radiant-charge'),
  exampleCard('slc-lightning-lash'),
  exampleCard('slc-frostbind-current'),
] as const;

const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
  exampleCard('slc-forest'),
] as const;

function nth<T>(list: readonly T[], index: number): T {
  const found = list[index % list.length];
  if (found === undefined) throw new Error('fixtures: an example card list was empty');
  return found;
}

/** The seat the shots are taken from, and the seat across from it. */
export const VIEWER = 0;
const OPPONENT = 1;

export const FIXTURE_NAMES: readonly [string, string] = ['You', 'Opponent'];

interface Side {
  readonly controller: 0 | 1;
  readonly creatures: number;
  /** Which creature, counted from zero, is tapped. */
  readonly tappedCreature: number;
}

function permanents(side: Side): readonly {
  readonly card: Card;
  readonly controller: 0 | 1;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
}[] {
  const creatures = Array.from({ length: side.creatures }, (_unused, index) => ({
    card: nth(SPELLS, index + side.controller),
    controller: side.controller,
    tapped: index === side.tappedCreature,
    summoningSick: false,
  }));
  // Six lands, two of them spent, which is what a board looks like in the
  // middle of a main phase rather than at the top of an untap step.
  const lands = Array.from({ length: 6 }, (_unused, index) => ({
    card: nth(LANDS, index + side.controller),
    controller: side.controller,
    tapped: index < 2,
    summoningSick: false,
  }));
  return [...creatures, ...lands];
}

/**
 * Where the `+1/+1` counters go, applied after the build for the reason the
 * docblock gives: the scenario builder states loyalty and nothing else.
 *
 * The permanent is found by walking the battlefield rather than by trusting an
 * id the builder chose, because object ids are assigned in construction order
 * and a card added to either list above would silently move the counters onto
 * something else.
 */
function withCounters(state: GameState, controller: 0 | 1, ordinal: number, count: number): GameState {
  const creatures = state.battlefield.filter((oid) => {
    const object = state.objects[oid];
    return object !== undefined && object.controller === controller && object.card.kind === 'creature';
  });
  const target: ObjectId | undefined = creatures[ordinal];
  if (target === undefined) throw new Error('fixtures: the dense board has no creature to put counters on');
  const object: GameObject | undefined = state.objects[target];
  if (object === undefined)
    throw new Error('fixtures: the battlefield names an object the state does not hold');
  return {
    ...state,
    objects: {
      ...state.objects,
      [target]: { ...object, counters: setCounterCount(object.counters, 'plusOnePlusOne', count) },
    },
  };
}

function sessionOf(state: GameState, events: GameSession['events']): GameSession {
  return {
    seats: [humanSeat(FIXTURE_NAMES[0]), humanSeat(FIXTURE_NAMES[1])],
    state,
    events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The stated density, on a main phase, with the stack empty.
 *
 * `active` is the opponent, which is what makes the two-spell variant below
 * reachable: a spell is cast by the player who holds priority, and the fixture
 * that wants two of the opponent's spells waiting has to be on a turn where the
 * opponent gets to cast them.
 */
export function denseBoard(): GameSession {
  const built = scenario({
    seed: 'ui/fixtures/dense',
    life: [18, 20],
    battlefield: [
      ...permanents({ controller: VIEWER, creatures: 4, tappedCreature: 2 }),
      ...permanents({ controller: OPPONENT, creatures: 3, tappedCreature: 1 }),
    ],
    hands: [
      [nth(SPELLS, 0), nth(TRICKS, 0), nth(LANDS, 1), nth(SPELLS, 3), nth(TRICKS, 2), nth(SPELLS, 1)],
      [nth(TRICKS, 1), nth(SPELLS, 2), nth(LANDS, 3), nth(TRICKS, 0)],
    ],
    graveyards: [
      [nth(SPELLS, 4), nth(TRICKS, 1)],
      [nth(TRICKS, 2), nth(SPELLS, 0), nth(LANDS, 0)],
    ],
    active: OPPONENT,
    turn: 7,
  });
  const withOurs = withCounters(built.state, VIEWER, 1, 2);
  const state = withCounters(withOurs, OPPONENT, 1, 1);
  return sessionOf(state, built.events);
}

/**
 * The same board with two of the opponent's spells on the stack and the
 * question back in front of the viewer.
 *
 * Driven rather than declared. Each step reads the pending decision's own
 * options — the enumeration every surface on this route dispatches an index
 * into — takes a `castSpell` while the opponent holds priority, and passes
 * otherwise. So the stack holds what the rules would have put there, in the
 * order the rules would have put it, and the reticles the seam strip numbers
 * are numbering a real resolution order.
 *
 * It stops when the viewer is asked something with two entries waiting, and
 * throws rather than returning a thinner board if the walk cannot get there:
 * a screenshot of a one-spell stack captioned as a two-spell stack is worse
 * than no screenshot.
 */
export function stackedBoard(): GameSession {
  let session = denseBoard();
  for (let step = 0; step < 12; step += 1) {
    const decision = session.pending;
    if (decision === null) break;
    if (session.state.stack.length >= 2 && decision.player === VIEWER) return session;
    const options = decision.options;
    const cast = options.findIndex(
      (option) =>
        option.type === 'castSpell' && decision.player === OPPONENT && session.state.stack.length < 2,
    );
    const pass = options.findIndex((option) => option.type === 'passPriority');
    const index = cast >= 0 ? cast : pass;
    if (index < 0) break;
    session = choose(session, index);
  }
  const held = session.state.stack.length;
  throw new Error(`fixtures: the dense board settled with ${String(held)} spells on the stack, not two`);
}
