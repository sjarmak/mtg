/** Native each-upkeep, seeded reveal, land-play, and free-cast proofs for M11 Wild Evocation. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  eventsOfType,
  legalActions,
  moveObject,
  nextBelow,
  onlyObject,
  pendingDecision,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  seatEvents,
  serializeEvents,
  stateFingerprint,
  validateAction,
  type GameState,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { creature, instant, ISLAND, MOUNTAIN, sorcery } from './cards';
import { controlledBy, withContinuous } from './continuous-helpers';

const WILD_EVOCATION = parseCard({
  kind: 'enchantment',
  id: 'm11-160-wild-evocation-kernel',
  name: 'Wild Evocation',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 160 },
  manaCost: { generic: 5, R: 1 },
  colors: ['R'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      effects: [
        {
          kind: 'playRandomHandCardWithoutPayingManaCost',
          target: { kind: 'triggeringPlayer' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const EVOKED_BLAST = sorcery(
  'Evoked Blast',
  [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
  { generic: 11, R: 1 },
);
const EVOKED_FLING = parseCard({
  kind: 'instant',
  id: 'wild-evocation-additional-cost-probe',
  name: 'Evoked Fling',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 160 },
  colors: ['R'],
  manaCost: { generic: 9, R: 1 },
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'paidSacrificePower' },
      target: { kind: 'anyTarget' },
    },
  ],
} as unknown as CardInput);
const EVOCATION_COUNTER = instant('Evocation Counter', [{ kind: 'counterSpell' }], { U: 2 });
const FODDER = creature('Evocation Fodder', 2, 2);
const EVOKED_FEAST = parseCard({
  kind: 'sorcery',
  id: 'wild-evocation-plural-target-probe',
  name: 'Evoked Feast',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 161 },
  colors: ['G'],
  manaCost: { generic: 8, G: 1 },
  effects: [
    {
      kind: 'gainLife',
      amount: 6,
      target: { kind: 'targetPlayer', anyNumber: true },
    },
  ],
} as unknown as CardInput);

function upkeepTrigger(state: GameState, active: 0 | 1): Trace {
  const event = { type: 'stepBegan', turn: state.turn.number, step: 'upkeep', active } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  const triggers = collectTriggers(trace, 0);
  expect(triggers).toHaveLength(1);
  expect(triggers[0]).toMatchObject({
    condition: 'beginningOfEachPlayersUpkeep',
    controller: 0,
    triggeringPlayer: active,
  });
  return putTriggersOnStack(beginTrace(state), triggers);
}

function position(hand: readonly Card[], active: 0 | 1 = 1): ReduceResult {
  const hands: readonly [readonly Card[], readonly Card[]] = active === 0 ? [hand, []] : [[], hand];
  const opened = scenario({
    seed: 'wild-evocation/kernel',
    active,
    step: 'precombatMain',
    battlefield: [{ card: WILD_EVOCATION, controller: 0 }],
    hands,
  });
  return {
    ...opened,
    state: { ...opened.state, turn: { ...opened.state.turn, step: 'upkeep' } },
  };
}

describe('Wild Evocation in the kernel', () => {
  it("fires on either player's upkeep and uses that upkeep player's hand", () => {
    const onController = resolveTop(upkeepTrigger(position([MOUNTAIN], 0).state, 0));
    const onOpponent = resolveTop(upkeepTrigger(position([MOUNTAIN], 1).state, 1));

    expect(eventsOfType(onController.events, 'handRevealed')[0]?.player).toBe(0);
    expect(eventsOfType(onOpponent.events, 'handRevealed')[0]?.player).toBe(1);
  });

  it('collects one retained trigger for every source copy', () => {
    const start = scenario({
      seed: 'wild-evocation/copies',
      active: 1,
      battlefield: [
        { card: WILD_EVOCATION, controller: 0 },
        { card: WILD_EVOCATION, controller: 0 },
      ],
      hands: [[], [MOUNTAIN]],
    });
    const step = { type: 'stepBegan', turn: start.state.turn.number, step: 'upkeep', active: 1 } as const;
    const triggers = collectTriggers({ state: start.state, events: [step], eventStates: [start.state] }, 0);

    expect(triggers).toHaveLength(2);
    expect(new Set(triggers.map((trigger) => trigger.sourceOid))).toEqual(new Set(start.state.battlefield));
    expect(triggers.every((trigger) => trigger.triggeringPlayer === 1)).toBe(true);
  });

  it('uses current source control for the trigger while preserving source ownership', () => {
    const start = position([MOUNTAIN], 0);
    const source = start.state.battlefield[0];
    if (source === undefined) throw new Error('Wild Evocation source disappeared');
    const changed = withContinuous(start.state, [controlledBy(onlyObject(source), 1)]);
    const step = { type: 'stepBegan', turn: changed.turn.number, step: 'upkeep', active: 0 } as const;
    const triggers = collectTriggers({ state: changed, events: [step], eventStates: [changed] }, 0);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ controller: 1, triggeringPlayer: 0, sourceOid: source });
    expect(changed.objects[source]?.owner).toBe(0);
    const done = resolveTop(putTriggersOnStack(beginTrace(changed), triggers));
    expect(eventsOfType(done.events, 'handRevealed')[0]?.player).toBe(0);
  });

  it('reveals the seeded card and puts a selected land onto the battlefield', () => {
    const start = position([MOUNTAIN]);
    const land = start.state.players[1].hand[0];
    if (land === undefined) throw new Error('land fixture did not reach the hand');
    const [pick, expectedRng] = nextBelow(start.state.rng, 1);
    expect(pick).toBe(0);

    const done = resolveTop(upkeepTrigger(start.state, 1));

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([
      { type: 'handRevealed', player: 1, oids: [land] },
    ]);
    expect(done.state.rng).toEqual(expectedRng);
    expect(done.state.objects[land]?.zone).toBe('battlefield');
    expect(done.state.stack).toEqual([]);
  });

  it('publishes only the selected hand identity to both replay projections', () => {
    const start = position([MOUNTAIN, ISLAND]);
    const done = resolveTop(upkeepTrigger(start.state, 1));
    const reveal = eventsOfType(done.events, 'handRevealed')[0];
    if (reveal === undefined) throw new Error('Wild Evocation did not reveal its selected card');

    expect(reveal.oids).toHaveLength(1);
    expect(start.state.players[1].hand).toContain(reveal.oids[0]);
    for (const viewer of [0, 1] as const) {
      expect(eventsOfType(seatEvents(done.events, viewer, `wild-${String(viewer)}`), 'handRevealed')).toEqual(
        [reveal],
      );
    }
  });

  it('offers an otherwise unaffordable nonland through the ordinary cast action pipeline', () => {
    const enormous = creature('Evoked Colossus', 9, 9, { cost: { generic: 12 } });
    const paused = resolveTop(upkeepTrigger(position([enormous]).state, 1));
    const decision = pendingDecision(paused.state);

    expect(decision?.kind).toBe('freeCast');
    const cast = decision?.options.find((action) => action.type === 'castSpell');
    expect(cast).toMatchObject({ player: 1, castingCost: 'withoutMana', targets: [] });
    if (cast?.type !== 'castSpell') throw new Error('free cast action was not offered');

    const casted = reduce(paused.state, cast);
    expect(eventsOfType(casted.events, 'spellCast')).toHaveLength(1);
    expect(casted.state.stack.at(-1)?.controller).toBe(1);
    expect(casted.state.players[1].pool).toEqual(paused.state.players[1].pool);
  });

  it('retains the free-cast price through a staged plural target choice', () => {
    const paused = resolveTop(upkeepTrigger(position([EVOKED_FEAST]).state, 1));
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'freeCast') throw new Error('plural spell was not offered for free');
    const begin = decision.options.find((action) => action.type === 'beginCastSpell');
    if (begin?.type !== 'beginCastSpell') throw new Error('plural free cast did not enter staging');

    expect(begin).toMatchObject({ castingCost: 'withoutMana', targets: [null] });
    expect(validateAction(paused.state, begin)).toBeNull();
    expect(validateAction(paused.state, { ...begin, castingCost: 'mana' })).toMatch(
      /must use the cast-without-mana choice/u,
    );
    const begun = reduce(paused.state, begin);
    expect(begun.state.pendingPluralTargets).toMatchObject({
      origin: 'cast',
      castingCost: 'withoutMana',
    });

    const targets = pendingDecision(begun.state);
    if (targets?.kind !== 'pluralTargets') throw new Error('plural target choice was not staged');
    const chooseOpponent = targets.options.find(
      (action) =>
        action.type === 'choosePluralTarget' &&
        action.target?.kind === 'player' &&
        action.target.player === 0,
    );
    if (chooseOpponent?.type !== 'choosePluralTarget') throw new Error('opponent target was not offered');
    const selected = reduce(begun.state, chooseOpponent);
    const finish = pendingDecision(selected.state);
    if (finish?.kind !== 'pluralTargets') throw new Error('plural target choice could not finish');
    const done = finish.options.find(
      (action) => action.type === 'choosePluralTarget' && action.target === null,
    );
    if (done?.type !== 'choosePluralTarget') throw new Error('finish target choice was not offered');
    const casted = reduce(selected.state, done);

    expect(casted.state.pendingFreeCast).toBeUndefined();
    expect(casted.state.stack.at(-1)).toMatchObject({
      controller: 1,
      targets: [null],
      multiTargets: { 0: [{ kind: 'player', player: 0 }] },
    });
    expect(casted.state.players[1].pool).toEqual(paused.state.players[1].pool);
  });

  it('bypasses sorcery timing while preserving target choice and a response window', () => {
    const natural = scenario({
      seed: 'wild-evocation/natural-upkeep',
      active: 0,
      step: 'upkeep',
      battlefield: [{ card: WILD_EVOCATION, controller: 0 }],
      hands: [[], [EVOKED_BLAST]],
    });
    expect(natural.state.turn).toMatchObject({ active: 1, step: 'upkeep' });
    expect(natural.state.stack).toHaveLength(1);
    const paused = resolveTop(beginTrace(natural.state));
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'freeCast') throw new Error('targeted sorcery did not pause for its cast');
    const targetPlayers = decision.options.flatMap((action) =>
      action.type === 'castSpell' && action.targets[0]?.kind === 'player' ? [action.targets[0].player] : [],
    );
    expect(new Set(targetPlayers)).toEqual(new Set([0, 1]));
    const cast = decision.options.find(
      (action) =>
        action.type === 'castSpell' && action.targets[0]?.kind === 'player' && action.targets[0].player === 0,
    );
    if (cast?.type !== 'castSpell') throw new Error('opposing player target was not offered');

    const casted = reduce(paused.state, cast);
    expect(pendingDecision(casted.state)).toMatchObject({ kind: 'priority', player: 1 });
    expect(casted.state.stack.at(-1)?.targets).toEqual([{ kind: 'player', player: 0 }]);
  });

  it('pays ordinary additional costs and declines to cast when they cannot be paid', () => {
    const noPayment = resolveTop(upkeepTrigger(position([EVOKED_FLING]).state, 1));
    expect(noPayment.state.turn.awaiting).toBeNull();
    expect(noPayment.state.players[1].hand).toHaveLength(1);

    const supplied = scenario({
      seed: 'wild-evocation/additional',
      active: 1,
      battlefield: [
        { card: WILD_EVOCATION, controller: 0 },
        { card: FODDER, controller: 1 },
      ],
      hands: [[], [EVOKED_FLING]],
    });
    const paused = resolveTop(upkeepTrigger(supplied.state, 1));
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'freeCast') throw new Error('payable additional cost was not offered');
    const cast = decision.options.find(
      (action) => action.type === 'castSpell' && action.sacrifices?.length === 1,
    );
    if (cast?.type !== 'castSpell') throw new Error('additional sacrifice route was not offered');
    const fodder = cast.sacrifices?.[0];
    if (fodder === undefined) throw new Error('additional sacrifice lost its object');

    const casted = reduce(paused.state, cast);
    expect(casted.state.objects[fodder]?.zone).toBe('graveyard');
    expect(eventsOfType(casted.events, 'manaPaid')[0]?.cost.generic).toBe(0);
  });

  it('obeys absolute casting prohibitions even though it overrides timing and mana', () => {
    const start = position([EVOKED_BLAST]);
    const source = start.state.battlefield[0];
    if (source === undefined) throw new Error('Wild Evocation source disappeared');
    const prohibited: GameState = {
      ...start.state,
      turnPlayerRules: [{ rule: 'cantCastSpells', sourceOid: source, player: 1 }],
    };

    const done = resolveTop(upkeepTrigger(prohibited, 1));

    expect(done.state.turn.awaiting).toBeNull();
    expect(done.state.players[1].hand).toHaveLength(1);
  });

  it('forces X to zero and rejects hostile free-cast declarations outside the pending card', () => {
    const xSpell = sorcery(
      'Evoked X Spell',
      [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
      { R: 1, hasX: true },
    );
    const paused = resolveTop(upkeepTrigger(position([xSpell]).state, 1));
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'freeCast') throw new Error('X spell was not offered');
    const action = decision.options.find((candidate) => candidate.type === 'castSpell');
    if (action?.type !== 'castSpell') throw new Error('X spell had no declaration');
    expect(action.x).toBe(0);
    expect(validateAction(paused.state, { ...action, x: 1 })).toMatch(/X must be 0/u);

    const ordinary = position([EVOKED_BLAST]);
    const oid = ordinary.state.players[1].hand[0];
    if (oid === undefined) throw new Error('hostile spell disappeared');
    expect(
      validateAction(ordinary.state, {
        type: 'castSpell',
        player: 1,
        oid,
        targets: [{ kind: 'player', player: 0 }],
        castingCost: 'withoutMana',
      }),
    ).toMatch(/not awaiting/u);
  });

  it('does not pause when the revealed spell has no legal targets', () => {
    const removal = instant('Lonely Removal', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    ]);
    const start = position([removal]);
    const oid = start.state.players[1].hand[0];
    if (oid === undefined) throw new Error('spell fixture did not reach the hand');
    const done = resolveTop(upkeepTrigger(start.state, 1));

    expect(eventsOfType(done.events, 'handRevealed')[0]?.oids).toEqual([oid]);
    expect(done.state.objects[oid]?.zone).toBe('hand');
    expect(done.state.turn.awaiting).toBeNull();
  });

  it('does nothing and consumes no RNG when the upkeep player has an empty hand', () => {
    const start = position([]);
    const before = start.state.rng;
    const done = resolveTop(upkeepTrigger(start.state, 1));

    expect(eventsOfType(done.events, 'handRevealed')).toEqual([]);
    expect(done.state.rng).toEqual(before);
    expect(done.state.turn.awaiting).toBeNull();
  });

  it('resolves from the retained ability after the enchantment source leaves', () => {
    const start = position([MOUNTAIN]);
    const source = start.state.battlefield[0];
    if (source === undefined) throw new Error('Wild Evocation source disappeared');
    const stacked = upkeepTrigger(start.state, 1);
    const removed = moveObject(stacked, source, 'graveyard');
    const done = resolveTop(removed);

    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(done.state.players[1].hand).toEqual([]);
    expect(eventsOfType(done.events, 'handRevealed')).toHaveLength(1);
  });

  it('lets the opposing player respond and counter the freely cast spell', () => {
    const enormous = creature('Countered Evocation', 9, 9, { cost: { generic: 12 } });
    const start = scenario({
      seed: 'wild-evocation/counter',
      active: 1,
      battlefield: [
        { card: WILD_EVOCATION, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[EVOCATION_COUNTER], [enormous]],
    });
    const paused = resolveTop(upkeepTrigger(start.state, 1));
    const free = pendingDecision(paused.state)?.options.find((action) => action.type === 'castSpell');
    if (free?.type !== 'castSpell') throw new Error('creature free cast was not offered');
    const casted = reduce(paused.state, free);
    const spell = casted.state.stack.at(-1)?.oid;
    if (spell === undefined) throw new Error('free spell did not reach the stack');
    const passed = reduce(casted.state, { type: 'passPriority', player: 1 });
    const counter = legalActions(passed.state).find(
      (action) => action.type === 'castSpell' && action.targets[0]?.kind === 'spell',
    );
    if (counter?.type !== 'castSpell') throw new Error('counterspell response was not offered');
    let current = reduce(passed.state, counter);
    current = reduce(current.state, { type: 'passPriority', player: 0 });
    current = reduce(current.state, { type: 'passPriority', player: 1 });

    expect(current.state.objects[spell]?.zone).toBe('graveyard');
    expect(eventsOfType(current.events, 'spellCountered')).toHaveLength(1);
  });

  it('is seeded and replay-deterministic across reveal and cast choice', () => {
    const run = (): ReduceResult => {
      const paused = resolveTop(upkeepTrigger(position([EVOKED_BLAST]).state, 1));
      const decision = pendingDecision(paused.state);
      const cast = decision?.options.find((action) => action.type === 'castSpell');
      if (cast?.type !== 'castSpell') throw new Error('determinism probe found no cast');
      const reduced = reduce(paused.state, cast);
      return { state: reduced.state, events: [...paused.events, ...reduced.events] };
    };
    const first = run();
    const second = run();

    expect(serializeEvents(first.events)).toBe(serializeEvents(second.events));
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });
});
