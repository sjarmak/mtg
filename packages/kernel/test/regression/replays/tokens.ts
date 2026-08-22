/**
 * Token-arrival defects the bank replays.
 *
 * Two entries, and they are the two halves of one bead (`mtg-4vf`). `793fe7e`
 * routed `createToken` through the shared arrival pass, which is the event
 * half: the CR 614 replacement pass and `permanentEntered` were skipped for
 * tokens because `createToken` appended to the battlefield itself. `2856157`
 * finished the placement half, so the same two helpers put a token where they
 * put everything else, and the state an arrival owes — a registered static —
 * arrives with it.
 *
 * `token-entry.test.ts` is the fuller treatment. What is here is the property
 * each fix produced, plus the one CR 111.3 keeps different: a token is created
 * on the battlefield rather than moved onto it, so it reports no zone change.
 */
import { expect } from 'vitest';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, powerOf, reduce, reduceAll, scenario, toughnessOf } from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from '../../cards';
import { replacement, withReplacements } from '../../continuous-helpers';
import { replay } from '../bank';

const CALL_THE_GUARD = sorcery(
  'Call the Guard',
  [
    {
      kind: 'createToken',
      count: 1,
      token: { name: 'Guard', power: 2, toughness: 2, colors: ['R'], subtypes: ['Soldier'], keywords: [] },
    },
  ],
  { generic: 1, R: 1 },
);

/** The same sorcery, making a token whose printed ability is a lord's. */
const CALL_THE_CAPTAIN = sorcery(
  'Call the Captain',
  [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Captain',
        power: 2,
        toughness: 2,
        colors: ['R'],
        subtypes: ['Soldier'],
        keywords: [],
        abilities: [
          {
            kind: 'static',
            scope: 'otherCreaturesYouControl',
            subtype: 'Soldier',
            modification: { kind: 'statBonus', power: 1, toughness: 1 },
          },
        ],
      },
    },
  ],
  { generic: 1, R: 1 },
);

/** The creature the Captain is a lord for, so the bonus has somewhere to land. */
const RECRUIT = creature('Vantian Recruit', 1, 1, { subtypes: ['Soldier'] });

function board(maker: typeof CALL_THE_GUARD, alsoOnBoard: readonly (typeof RECRUIT)[] = []): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      ...alsoOnBoard.map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[maker], []],
  }).state;
}

/** Casts the token sorcery from player 0's hand and resolves it. */
function castAndResolve(start: GameState): ReduceResult {
  const seat = start.players[0];
  if (seat === undefined) throw new Error('no seat 0');
  const oid = seat.hand[0];
  if (oid === undefined) throw new Error('nothing in hand to cast');
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets: [null] });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function tokenOid(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.token === true);
  if (found === undefined) throw new Error('no token on the battlefield');
  return found;
}

export const TOKEN_REPLAYS = [
  replay(
    '793fe7e',
    'a token arrives through the same pass every permanent arrives through: CR 614 replacements, then permanentEntered',
    () => {
      // The event half. The pre-fix `createToken` built its object and appended
      // it to the battlefield itself, so the arrival was invisible: no
      // replacement pass, no `permanentEntered`. Both are asserted here, and
      // the replacement is the one that cannot pass by accident, because the
      // effect that taps the token is stated by the position rather than by
      // anything the token or the sorcery carries.
      const entering = withReplacements(board(CALL_THE_GUARD), [
        replacement({ kind: 'enters', oid: null, controller: 0 }, { kind: 'entersTapped' }, { id: 'tide' }),
      ]);
      const result = castAndResolve(entering);
      const token = tokenOid(result.state);

      expect(eventsOfType(result.events, 'permanentEntered').map((event) => event.oid)).toContain(token);
      expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toContain('tide');
      expect(result.state.objects[token]?.tapped).toBe(true);

      // And the one difference CR 111.3 keeps: a token is created on the
      // battlefield rather than moved onto it, so it reports no zone change.
      // The fix routed the arrival through the shared path without collapsing
      // that distinction, and a replay that only demanded sameness would let a
      // future edit erase it.
      expect(eventsOfType(result.events, 'zoneChanged').filter((event) => event.oid === token)).toEqual([]);
      expect(eventsOfType(result.events, 'tokenCreated').map((event) => event.oid)).toEqual([token]);
    },
  ),
  replay(
    '2856157',
    'a token is placed by the helpers that place everything else, so the static ability it is printed with is registered on arrival',
    () => {
      // The placement half, and the part of an arrival that is state rather
      // than an event — which is exactly the part a passing event log does not
      // catch. `registerStatics` is the only thing that writes a continuous
      // record, and layer 7c reading the bonus back off the recruit is the
      // arrival being honored end to end.
      const start = board(CALL_THE_CAPTAIN, [RECRUIT]);
      const recruit = start.battlefield.find((oid) => start.objects[oid]?.card.name === 'Vantian Recruit');
      if (recruit === undefined) throw new Error('the recruit is not on the battlefield');
      const before = powerOf(start, recruit);

      const result = castAndResolve(start);
      const token = tokenOid(result.state);

      expect(result.state.continuous.filter((effect) => effect.sourceOid === token)).toHaveLength(1);
      expect(powerOf(result.state, recruit)).toBeGreaterThan(before);
      expect(toughnessOf(result.state, recruit)).toBeGreaterThan(toughnessOf(start, recruit));

      // Non-vacuity: the same board with a bodiless lord absent leaves the
      // recruit alone, so the assertion above is reading the token's static
      // rather than a bonus the fixture was born with.
      const plain = castAndResolve(board(CALL_THE_GUARD, [RECRUIT]));
      const untouched = plain.state.battlefield.find(
        (oid) => plain.state.objects[oid]?.card.name === 'Vantian Recruit',
      );
      if (untouched === undefined) throw new Error('the recruit vanished');
      expect(powerOf(plain.state, untouched)).toBe(before);
    },
  ),
];
