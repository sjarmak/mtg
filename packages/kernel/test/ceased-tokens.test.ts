/**
 * CR 704.5d reaches a token in every zone it can be in, not only a graveyard.
 *
 * `sba.ts`'s sweep is one predicate over `state.objects` rather than a walk of
 * the routes off the battlefield, and its docblock says why: a graveyard is not
 * the only zone a token can be moved to. Nothing checked the rest. Narrowing
 * the predicate to `object.zone !== 'graveyard'` left the whole repository
 * green while a bounced token sat in a hand forever, playable again next turn.
 * Each zone the docblock names is stated here instead.
 *
 * The hand is a route a card can take today: `returnToHand` is DSL vocabulary
 * and `effects.ts` moves the permanent, token or not, so that one is played
 * through a real spell. A library has no DSL route at all yet, so it goes
 * through `moveObject` directly, which is where every route ends anyway. Exile
 * is not a route but the terminal state, and the token that is already there is
 * the one case the sweep must skip: it has nowhere further to go, and moving it
 * again is a pass that changes nothing forever.
 */
import { describe, expect, it } from 'vitest';
import type { TokenSpec } from '@mtg/dsl';
import type { Action, ObjectId, ReduceResult, Trace, ZoneId } from '@mtg/kernel';
import {
  beginTrace,
  checkStateBasedActions,
  createToken,
  eventsOfType,
  getObject,
  moveObject,
  playerOf,
  reduce,
  scenario,
} from '@mtg/kernel';
import { instant, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

/** A Key: the small drop, with nothing on it to complicate a zone change. */
const KEY: TokenSpec = {
  name: 'Key',
  power: 1,
  toughness: 1,
  colors: [],
  subtypes: ['Key'],
  keywords: [],
  abilities: [],
};

const BRIGAND_CAMP = sorcery('Brigand Camp', [{ kind: 'createToken', count: 1, token: KEY }], {
  generic: 1,
  R: 1,
});

const STASIS_ARROW = instant('Stasis Arrow', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }]);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/** One token on an otherwise empty battlefield, before any check has run. */
function tokenOnBattlefield(): { readonly trace: Trace; readonly oid: ObjectId } {
  const start = scenario({ battlefield: [{ card: MOUNTAIN, controller: 0 }] });
  const made = createToken(beginTrace(start.state), 0, KEY);
  const oid = made.state.battlefield.at(-1);
  if (oid === undefined) throw new Error('the token was not created');
  return { trace: made, oid };
}

/** Every zone list a token could be found in, for one player. */
function zoneLists(trace: Trace): readonly ObjectId[] {
  const seat = playerOf(trace.state, 0);
  return [...trace.state.battlefield, ...seat.hand, ...seat.library, ...seat.graveyard];
}

describe('a token in a zone other than the battlefield', () => {
  const routes: readonly ZoneId[] = ['graveyard', 'hand', 'library'];

  for (const zone of routes) {
    it(`stops existing when it is put into a ${zone}`, () => {
      const { trace, oid } = tokenOnBattlefield();
      const moved = moveObject(trace, oid, zone);
      expect(getObject(moved.state, oid).zone, `the token never reached the ${zone}`).toBe(zone);

      const swept = checkStateBasedActions(moved);
      expect(getObject(swept.state, oid).zone).toBe('exile');
      expect(zoneLists(swept)).not.toContain(oid);
    });
  }

  /**
   * The bounce, played rather than driven: a token returned to its owner's hand
   * is in a hand for exactly as long as a card would be, and then it is gone.
   * `returnToHand` is the route `sba.ts`'s docblock names by name.
   */
  it('stops existing when a spell bounces it, rather than waiting in hand', () => {
    const start = scenario({
      battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[BRIGAND_CAMP, STASIS_ARROW], []],
    });
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Brigand Camp'),
      targets: [null],
    });
    let current: ReduceResult = { state: cast.state, events: [...cast.events] };
    for (const action of PASS) current = apply(current, action);

    const token = current.state.battlefield.find((oid) => current.state.objects[oid]?.token === true);
    if (token === undefined) throw new Error('the camp dropped no Key');

    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, 'Stasis Arrow'),
      targets: [{ kind: 'permanent', oid: token }],
    });
    for (const action of [...PASS, ...PASS]) current = apply(current, action);

    const moves = eventsOfType(current.events, 'zoneChanged').filter((event) => event.oid === token);
    expect(moves.map((event) => `${event.from}->${event.to}`)).toEqual(['battlefield->hand', 'hand->exile']);
    expect(playerOf(current.state, 0).hand).not.toContain(token);
    expect(current.state.objects[token]?.zone).toBe('exile');
  });

  /**
   * The token that is already gone is left alone. The sweep counts as a
   * state-based action performed, so a pass that moved an exiled token again
   * would report a change every pass and never reach the fixed point CR 704.3
   * asks for; `checkStateBasedActions` throws when that happens.
   */
  it('is left alone once it is in exile', () => {
    const { trace, oid } = tokenOnBattlefield();
    const swept = checkStateBasedActions(moveObject(trace, oid, 'graveyard'));
    expect(getObject(swept.state, oid).zone).toBe('exile');

    const again = checkStateBasedActions(swept);
    const moves = eventsOfType(again.events, 'zoneChanged').filter((event) => event.oid === oid);
    expect(moves.map((event) => `${event.from}->${event.to}`)).toEqual([
      'battlefield->graveyard',
      'graveyard->exile',
    ]);
  });
});
