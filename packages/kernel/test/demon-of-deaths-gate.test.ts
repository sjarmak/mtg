/** Native alternative-cost casting for M11 Demon of Death's Gate. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  actionKey,
  beginTrace,
  choose,
  chooseAction,
  copySpellOnStack,
  humanSeat,
  legalActions,
  objectFilter,
  pendingDecision,
  reduce,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
  type Action,
  type GameSession,
  type GameState,
} from '@mtg/kernel';
import { creature, SWAMP } from './cards';
import { recolor, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf, oidsOf } from './helpers';

const DEMON = parseCard({
  kind: 'creature',
  id: 'm11-92-demon-of-deaths-gate-kernel',
  name: "Demon of Death's Gate",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 92 },
  colors: ['B'],
  manaCost: { generic: 6, B: 3 },
  subtypes: ['Demon'],
  power: 9,
  toughness: 9,
  keywords: ['flying', 'trample'],
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: {
      count: 3,
      filter: { cardTypes: ['creature'], colors: ['B'] },
    },
  },
} as unknown as CardInput);

const ALTERNATIVE_INSTANT = parseCard({
  kind: 'instant',
  id: 'alternative-cost-copy-probe',
  name: 'Alternative Cost Copy Probe',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 92 },
  colors: ['B'],
  manaCost: { generic: 6, B: 3 },
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: {
      count: 3,
      filter: { cardTypes: ['creature'], colors: ['B'] },
    },
  },
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
} as unknown as CardInput);

const BLACK_ONE = creature('Black One', 1, 1, { cost: { B: 1 } });
const BLACK_TWO = creature('Black Two', 2, 2, { cost: { B: 1 } });
const BLACK_THREE = creature('Black Three', 3, 3, { cost: { B: 1 } });
const BLACK_FOUR = creature('Black Four', 4, 4, { cost: { B: 1 } });
const WHITE = creature('White Offering', 2, 2, { cost: { W: 1 } });
const ENEMY_BLACK = creature('Enemy Black', 5, 5, { cost: { B: 1 } });

function board(
  options: {
    readonly life?: number;
    readonly black?: number;
    readonly mana?: boolean;
    readonly includeWhite?: boolean;
  } = {},
): GameState {
  const black = [BLACK_ONE, BLACK_TWO, BLACK_THREE, BLACK_FOUR].slice(0, options.black ?? 3);
  return scenario({
    life: [options.life ?? 20, 20],
    battlefield: [
      ...black.map((card) => ({ card, controller: 0 as const })),
      ...(options.includeWhite === true ? [{ card: WHITE, controller: 0 as const }] : []),
      { card: ENEMY_BLACK, controller: 1 },
      ...(options.mana === true
        ? Array.from({ length: 9 }, () => ({ card: SWAMP, controller: 0 as const }))
        : []),
    ],
    hands: [[DEMON], []],
  }).state;
}

function casts(state: GameState): readonly Extract<Action, { type: 'castSpell' }>[] {
  const demon = handOidOf(state, 0, DEMON.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === demon,
  );
}

function chosenAlternative(state: GameState): Extract<Action, { type: 'castSpell' }> {
  const action = casts(state).find((candidate) => candidate.castingCost === 'alternative');
  if (action === undefined) throw new Error('Demon offered no alternative cast');
  return action;
}

function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('Demon board left nobody to ask');
  return {
    seats: [humanSeat('you'), humanSeat('them')],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

describe("Demon of Death's Gate casting", () => {
  it('offers one printed route and every distinct alternative payment, with explicit identities', () => {
    const state = board({ black: 4, mana: true });
    const options = casts(state);
    const mana = options.filter((action) => action.castingCost === 'mana');
    const alternatives = options.filter((action) => action.castingCost === 'alternative');

    expect(mana).toHaveLength(1);
    expect(mana[0]?.sacrifices).toBeUndefined();
    expect(alternatives).toHaveLength(4);
    expect(new Set(alternatives.map((action) => [...(action.sacrifices ?? [])].sort().join(','))).size).toBe(
      4,
    );
    expect(alternatives.every((action) => action.sacrifices?.length === 3)).toBe(true);
    expect(new Set(options.map(actionKey)).size).toBe(5);
  });

  it('uses current characteristics and control, and rejects duplicates or nonmatching payments', () => {
    const printed = board({ black: 2, includeWhite: true });
    expect(casts(printed)).toEqual([]);

    const white = oidOf(printed, WHITE.name);
    const current = withContinuous(printed, [
      recolor(objectFilter({ oids: [white] }), ['B'], [], { id: 'make-black', ts: 1 }),
    ]);
    const offered = chosenAlternative(current);
    expect(offered.sacrifices).toContain(white);

    const spell = handOidOf(current, 0, DEMON.name);
    const ownBlack = oidsOf(current, BLACK_ONE.name)[0];
    const enemy = oidOf(current, ENEMY_BLACK.name);
    if (ownBlack === undefined) throw new Error('black payment disappeared');
    expect(
      validateAction(current, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [],
        castingCost: 'alternative',
        sacrifices: [ownBlack, ownBlack, white],
      }),
    ).not.toBeNull();
    expect(
      validateAction(current, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [],
        castingCost: 'alternative',
        sacrifices: [ownBlack, white, enemy],
      }),
    ).not.toBeNull();
  });

  it('allows exactly six life, refuses five, and never charges mana on the alternative route', () => {
    expect(casts(board({ life: 5, black: 3 }))).toEqual([]);

    const state = board({ life: 6, black: 3, mana: true });
    const swamps = oidsOf(state, 'Swamp');
    const action = chosenAlternative(state);
    const cast = reduce(state, action);

    expect(cast.state.players[0].life).toBe(0);
    expect(swamps.every((oid) => cast.state.objects[oid]?.tapped === false)).toBe(true);
    expect((action.sacrifices ?? []).every((oid) => cast.state.objects[oid]?.zone === 'graveyard')).toBe(
      true,
    );
    expect(cast.events.filter((event) => event.type === 'manaProduced')).toEqual([]);
  });

  it('pays the whole cost before the spell reaches the stack, then leaves a response window', () => {
    const state = board({ black: 3 });
    const action = chosenAlternative(state);
    const cast = reduce(state, action);
    const spell = handOidOf(state, 0, DEMON.name);

    expect(cast.state.stack.map((entry) => entry.oid)).toEqual([spell]);
    expect(cast.state.players[0].life).toBe(14);
    expect((action.sacrifices ?? []).every((oid) => cast.state.objects[oid]?.zone === 'graveyard')).toBe(
      true,
    );
    expect(pendingDecision(cast.state)).toEqual(expect.objectContaining({ kind: 'priority', player: 0 }));
    const passed = reduce(cast.state, { type: 'passPriority', player: 0 });
    expect(pendingDecision(passed.state)).toEqual(expect.objectContaining({ kind: 'priority', player: 1 }));
    expect(passed.state.stack).toHaveLength(1);
  });

  it('refuses a malformed payment without changing the source position', () => {
    const state = board({ black: 3 });
    const before = stateFingerprint(state);
    const action = chosenAlternative(state);
    const malformed = { ...action, sacrifices: action.sacrifices?.slice(0, 2) ?? [] };

    expect(validateAction(state, malformed)).not.toBeNull();
    expect(() => reduce(state, malformed)).toThrow();
    expect(stateFingerprint(state)).toBe(before);
    expect(state.players[0].life).toBe(20);
    expect(state.stack).toEqual([]);
  });

  it('rejects an untyped casting-price tag at the hostile action boundary', () => {
    const state = board({ black: 3, mana: true });
    const mana = casts(state).find((candidate) => candidate.castingCost === 'mana');
    if (mana === undefined) throw new Error('Demon offered no printed route');
    const hostile = { ...mana, castingCost: 'free-from-hostile-json' } as unknown as Action;

    expect(validateAction(state, hostile)).toMatch(/casting-cost choice/);
    expect(() => reduce(state, hostile)).toThrow();
  });

  it('reduces the same selected payment byte-identically and resolves to a flying trampler', () => {
    const firstStart = board({ black: 3 });
    const secondStart = board({ black: 3 });
    const firstAction = chosenAlternative(firstStart);
    const secondAction = chosenAlternative(secondStart);
    const firstCast = reduce(firstStart, firstAction);
    const secondCast = reduce(secondStart, secondAction);

    expect(actionKey(firstAction)).toBe(actionKey(secondAction));
    expect(serializeEvents(firstCast.events)).toBe(serializeEvents(secondCast.events));
    expect(stateFingerprint(firstCast.state)).toBe(stateFingerprint(secondCast.state));

    const firstPass = reduce(firstCast.state, { type: 'passPriority', player: 0 });
    const resolved = reduce(firstPass.state, { type: 'passPriority', player: 1 });
    const demon = Object.values(resolved.state.objects).find(
      (object) => object.card.id === DEMON.id && object.zone === 'battlefield',
    );
    expect(demon?.card.keywords).toEqual(['flying', 'trample']);
  });

  it('records and replays a reversed sacrifice payment as the enumerated move', () => {
    const state = board({ black: 3 });
    const enumerated = chosenAlternative(state);
    const reversed = { ...enumerated, sacrifices: [...(enumerated.sacrifices ?? [])].reverse() };

    expect(actionKey(reversed)).toBe(actionKey(enumerated));
    const applied = chooseAction(sessionOn(state), reversed);
    expect(applied.choices).toHaveLength(1);
    expect(typeof applied.choices[0]).toBe('number');

    const replayed = choose(sessionOn(state), applied.choices[0] ?? -1);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(applied.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(applied.state));

    const forwardReduction = reduce(state, enumerated);
    const reversedReduction = reduce(state, reversed);
    expect(serializeEvents(reversedReduction.events)).toBe(serializeEvents(forwardReduction.events));
    expect(stateFingerprint(reversedReduction.state)).toBe(stateFingerprint(forwardReduction.state));
  });

  it('does not repay an alternative cost when a supported spell is copied on the stack', () => {
    const start = scenario({
      life: [20, 20],
      battlefield: [BLACK_ONE, BLACK_TWO, BLACK_THREE].map((card) => ({
        card,
        controller: 0 as const,
      })),
      hands: [[ALTERNATIVE_INSTANT], []],
    }).state;
    const action = legalActions(start).find(
      (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
        candidate.type === 'castSpell' && candidate.castingCost === 'alternative',
    );
    if (action === undefined) throw new Error('copy probe offered no alternative cast');
    const cast = reduce(start, action);
    const original = cast.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('copy probe did not reach the stack');

    const copied = copySpellOnStack(beginTrace(cast.state), original);

    expect(copied.state.players[0].life).toBe(14);
    expect((action.sacrifices ?? []).every((oid) => copied.state.objects[oid]?.zone === 'graveyard')).toBe(
      true,
    );
    expect(copied.state.stack).toHaveLength(2);
    expect(copied.events.filter((event) => event.type === 'lifeChanged')).toEqual([]);
    expect(copied.events.filter((event) => event.type === 'permanentSacrificed')).toEqual([]);
    expect(copied.events.filter((event) => event.type === 'manaPaid')).toEqual([]);
  });
});
