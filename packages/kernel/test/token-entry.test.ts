/**
 * A token's arrival is an arrival (`mtg-4vf`).
 *
 * `createToken` used to build the object and append it to the battlefield
 * itself, which skipped everything `moveObject` does on entry: the CR 614
 * replacement pass, `registerStatics`, and `permanentEntered`. That cost
 * nothing while every token was a vanilla body nothing could react to, and it
 * stopped being free the moment an ability could trigger on an entry. These
 * assertions are about the event log and the replacement pipeline rather than
 * about the battlefield list, because the battlefield list was always right —
 * the arrival was what went missing.
 *
 * `mtg-bc2.132.7` is the moment it stopped being free: a token can carry
 * printed abilities now, so the last test below is a token reacting to its own
 * entry rather than the note it used to be about not being able to.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, powerOf, reduce, reduceAll, playerOf, scenario, toughnessOf } from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from './cards';
import { replacement, withReplacements } from './continuous-helpers';

const MAKE_TOKEN = sorcery(
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

/** The same sorcery, making a token that reads its own arrival. */
const MAKE_GREETER = sorcery(
  'Call the Herald',
  [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Herald',
        power: 1,
        toughness: 1,
        colors: ['R'],
        subtypes: ['Soldier'],
        keywords: [],
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
          },
        ],
      },
    },
  ],
  { generic: 1, R: 1 },
);

/**
 * The same sorcery again, making a token whose printed ability is a lord's:
 * "Other Soldier creatures you control get +1/+1."
 *
 * A static ability is the third thing an arrival owes and the only one that is
 * state rather than an event, so it is the one a passing event log would not
 * catch. CR 604.3 gives the effect exactly the token's stay on the battlefield,
 * and `registerStatics` is the only thing that writes the record.
 */
const MAKE_CAPTAIN = sorcery(
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

function board(maker: typeof MAKE_TOKEN = MAKE_TOKEN): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[maker], []],
  }).state;
}

/** Casts the token sorcery from player 0's hand and resolves it. */
function castAndResolve(start: GameState): ReduceResult {
  const oid = playerOf(start, 0).hand[0] ?? '';
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

describe('a token entering the battlefield', () => {
  it('emits permanentEntered, the event a triggered ability reads', () => {
    const result = castAndResolve(board());
    const token = tokenOid(result.state);

    const created = eventsOfType(result.events, 'tokenCreated');
    const entered = eventsOfType(result.events, 'permanentEntered');
    expect(created.map((event) => event.oid)).toEqual([token]);
    expect(entered.map((event) => event.oid)).toContain(token);
    expect(entered.find((event) => event.oid === token)?.controller).toBe(0);
  });

  it('announces the object before it announces the arrival', () => {
    const result = castAndResolve(board());
    const token = tokenOid(result.state);
    const order = result.events
      .filter(
        (event) =>
          (event.type === 'tokenCreated' || event.type === 'permanentEntered') && event.oid === token,
      )
      .map((event) => event.type);
    expect(order).toEqual(['tokenCreated', 'permanentEntered']);
  });

  /**
   * `mtg-bc2.132.2`'s second acceptance sentence, "a token created by
   * `createToken` fires ETB triggers", stated as the assertion it now is.
   *
   * Slice B left it unmet from both sides, and this test used to say so: a
   * token could not carry a trigger, because `TokenSpec` had no field to state
   * one in, and no other permanent could see it arrive, because every DSL v1
   * trigger condition is about its own source. `mtg-bc2.132.7` closed the first
   * half. The second is still open, and it is the same sentence it always was:
   * a condition about another permanent's arrival is new vocabulary.
   */
  it('fires a printed trigger off its own arrival', () => {
    const cast = castAndResolve(board(MAKE_GREETER));
    const token = tokenOid(cast.state);
    // The token arrived while the sorcery was resolving, so its trigger is
    // still on the stack; one more round of priority resolves it.
    const settled = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    const result: ReduceResult = {
      state: settled.state,
      events: [...cast.events, ...settled.events],
    };

    expect(result.state.objects[token]?.card.abilities).toHaveLength(1);
    expect(eventsOfType(result.events, 'permanentEntered').map((event) => event.oid)).toContain(token);
    // The trigger went on the stack off the arrival the tests above assert and
    // resolved through the same `resolveAbility` a printed card's trigger uses,
    // which is visible as the life it gained.
    expect(eventsOfType(result.events, 'lifeChanged').map((event) => event.player)).toContain(0);
    expect(playerOf(result.state, 0).life).toBe(22);
    expect(result.state.stack).toEqual([]);
  });

  it('registers its printed statics, so the board changes the moment it lands', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: RECRUIT, controller: 0 },
      ],
      hands: [[MAKE_CAPTAIN], []],
    }).state;
    const recruit = start.battlefield[2] ?? '';
    expect(powerOf(start, recruit)).toBe(1);

    const result = castAndResolve(start);
    const token = tokenOid(result.state);

    // The record lives in `state.continuous` under the token's own id, and
    // `registerStatics` is the only thing that puts one there; layer 7c reading
    // it back as the recruit's power is the arrival being honored end to end.
    expect(result.state.continuous.filter((effect) => effect.sourceOid === token)).toHaveLength(1);
    expect(powerOf(result.state, recruit)).toBe(2);
    expect(toughnessOf(result.state, recruit)).toBe(2);
  });

  it('creates a vanilla token with no abilities at all', () => {
    const result = castAndResolve(board());
    const token = tokenOid(result.state);

    expect(result.state.objects[token]?.card.abilities).toEqual([]);
    // Nothing is waiting on the stack: the arrival was seen and answered by
    // nobody, rather than being missed.
    expect(result.state.stack).toEqual([]);
  });

  it('runs the CR 614 pass, so a token enters tapped when something says it does', () => {
    const start = withReplacements(board(), [
      replacement({ kind: 'enters', oid: null, controller: 0 }, { kind: 'entersTapped' }, { id: 'tide' }),
    ]);
    const result = castAndResolve(start);
    const token = tokenOid(result.state);

    expect(result.state.objects[token]?.tapped).toBe(true);
    expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toContain('tide');
    expect(eventsOfType(result.events, 'permanentTapped').map((event) => event.oid)).toContain(token);
  });
});
