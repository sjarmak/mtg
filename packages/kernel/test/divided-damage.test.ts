/** Native resolution and hostile submissions for divided damage. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import type {
  Action,
  GameSession,
  GameSetup,
  ObjectId,
  ReduceResult,
  Seat,
  StackEntry,
  Target,
  TriggerOnStack,
} from '@mtg/kernel';
import {
  beginTrace,
  choose,
  copySpellOnStack,
  createSession,
  eventsOfType,
  legalActions,
  humanSeat,
  moveObject,
  pendingDecision,
  playerOf,
  powerOf,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  stateFingerprint,
  topOfStack,
  triggerHasLegalTargets,
  validateAction,
} from '@mtg/kernel';
import { creature, lands, MOUNTAIN } from './cards';
import { damageToPlayer, replacement, withReplacements } from './continuous-helpers';
import { apply, damageOn, handOidOf, oidOf } from './helpers';

const FIREBALL = parseCard({
  kind: 'sorcery',
  id: 'm11-138-fireball-kernel',
  name: 'Fireball',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 138 },
  manaCost: { R: 1, hasX: true },
  colors: ['R'],
  targetCostIncrease: { genericPerTargetBeyondFirst: 1 },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'anyTarget', anyNumber: true },
      division: { kind: 'evenlyRoundedDown' },
    },
  ],
} as unknown as CardInput);

const INFERNO_TITAN = parseCard({
  kind: 'creature',
  id: 'm11-146-inferno-titan-kernel',
  name: 'Inferno Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 146 },
  manaCost: { generic: 4, R: 2 },
  colors: ['R'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          target: { kind: 'anyTarget', count: 3, minimum: 1 },
          division: { kind: 'asYouChoose' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { R: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 0,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const TARGET = creature('Divided Damage Target', 0, 8);

const ALTERNATIVE_DIVIDED_DAMAGE = parseCard({
  kind: 'sorcery',
  id: 'alternative-divided-damage',
  name: 'Alternative Divided Damage',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 3 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  alternativeCost: {
    payLife: 1,
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'dealDamage',
      amount: 3,
      target: { kind: 'anyTarget', count: 3, minimum: 1 },
      division: { kind: 'asYouChoose' },
    },
  ],
} as unknown as CardInput);

const COLLARED_TITAN = parseCard({
  ...INFERNO_TITAN,
  id: 'collared-inferno-titan',
  name: 'Collared Inferno Titan',
  set: { code: 'TST', collectorNumber: 1 },
  keywords: ['lifelink', 'deathtouch'],
} as CardInput);

const TWO_TARGET_BOLT = parseCard({
  kind: 'sorcery',
  id: 'two-target-bolt',
  name: 'Two Target Bolt',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { R: 1 },
  colors: ['R'],
  targetCostIncrease: { genericPerTargetBeyondFirst: 1 },
  effects: [
    { kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } },
    { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } },
  ],
} as CardInput);

const IMPOSSIBLE_DISTRIBUTOR = {
  ...INFERNO_TITAN,
  id: 'impossible-distributor',
  name: 'Impossible Distributor',
  set: { code: 'TST', collectorNumber: 3 },
  manaCost: {},
  colors: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [
        {
          kind: 'dealDamage',
          amount: 2,
          target: { kind: 'anyTarget', count: 3, minimum: 3 },
          division: { kind: 'asYouChoose' },
        },
      ],
    },
  ],
} as unknown as Card;

function passStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 60; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stack paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('stack did not settle');
}

function fireballBoard(landsOnBoard = 10): {
  readonly start: ReduceResult;
  readonly spell: ObjectId;
  readonly target: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: TARGET, controller: 1 },
      ...lands(MOUNTAIN, landsOnBoard).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[FIREBALL], []],
  });
  return {
    start,
    spell: handOidOf(start.state, 0, FIREBALL.name),
    target: oidOf(start.state, TARGET.name),
  };
}

function fireballAction(
  spell: ObjectId,
  x: number,
  targets: readonly Target[],
): Extract<Action, { type: 'castSpell' }> {
  return {
    type: 'castSpell',
    player: 0,
    oid: spell,
    targets: [null],
    x,
    multiTargets: { 0: targets },
  };
}

function enterTitan(): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: TARGET, controller: 1 },
      ...lands(MOUNTAIN, 6).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[INFERNO_TITAN], []],
  });
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, INFERNO_TITAN.name),
    targets: [],
  });
  return apply(apply(cast, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
}

describe('Fireball', () => {
  it('counts ordinary target slots when applying the per-target surcharge', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [[TWO_TARGET_BOLT], []],
    });
    const action = {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, TWO_TARGET_BOLT.name),
      targets: [
        { kind: 'player', player: 0 },
        { kind: 'player', player: 1 },
      ],
    } as const;

    expect(validateAction(start.state, action)).toContain('cannot pay');
    expect(legalActions(start.state)).not.toContainEqual(action);
  });

  it('charges one generic per target beyond the first after the target choice is final', () => {
    const threeMana = fireballBoard(3);
    const oneTarget = fireballAction(threeMana.spell, 2, [{ kind: 'player', player: 1 }]);
    const twoTargets = fireballAction(threeMana.spell, 2, [
      { kind: 'player', player: 1 },
      { kind: 'permanent', oid: threeMana.target },
    ]);

    expect(validateAction(threeMana.start.state, oneTarget)).toBeNull();
    expect(validateAction(threeMana.start.state, twoTargets)).toContain('cannot pay');
    expect(
      legalActions(threeMana.start.state).some(
        (action) =>
          action.type === 'castSpell' && action.x === 2 && (action.multiTargets?.[0]?.length ?? 0) === 2,
      ),
    ).toBe(false);
  });

  it('divides X evenly rounded down among its legal targets', () => {
    const { start, spell, target } = fireballBoard();
    const cast = reduce(
      start.state,
      fireballAction(spell, 5, [
        { kind: 'player', player: 1 },
        { kind: 'permanent', oid: target },
      ]),
    );
    const done = passStack(cast);

    expect(playerOf(done.state, 1).life).toBe(18);
    expect(damageOn(done.state, target)).toBe(2);
  });

  it('redivides over surviving targets and does not fizzle after partial invalidation', () => {
    const { start, spell, target } = fireballBoard();
    const cast = reduce(
      start.state,
      fireballAction(spell, 5, [
        { kind: 'player', player: 1 },
        { kind: 'permanent', oid: target },
      ]),
    );
    const removed = moveObject(beginTrace(cast.state), target, 'graveyard');
    const done = passStack({ state: removed.state, events: [...cast.events, ...removed.events] });

    expect(playerOf(done.state, 1).life).toBe(15);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('sends each divided damage instance through prevention independently', () => {
    const { start, spell, target } = fireballBoard();
    const shielded = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 'all' }, { id: 'player-shield' }),
    ]);
    const cast = reduce(
      shielded,
      fireballAction(spell, 5, [
        { kind: 'player', player: 1 },
        { kind: 'permanent', oid: target },
      ]),
    );
    const done = passStack(cast);

    expect(playerOf(done.state, 1).life).toBe(20);
    expect(damageOn(done.state, target)).toBe(2);
    expect(eventsOfType(done.events, 'damagePrevented')).toContainEqual({
      type: 'damagePrevented',
      sourceOid: spell,
      target: { kind: 'player', player: 1 },
      amount: 2,
    });
  });

  it('copies the announced X and the complete plural target choice', () => {
    const { start, spell, target } = fireballBoard();
    const cast = reduce(
      start.state,
      fireballAction(spell, 5, [
        { kind: 'player', player: 1 },
        { kind: 'permanent', oid: target },
      ]),
    );
    const copied = copySpellOnStack(beginTrace(cast.state), spell);

    expect(topOfStack(copied.state)).toMatchObject({
      x: 5,
      multiTargets: {
        0: [
          { kind: 'player', player: 1 },
          { kind: 'permanent', oid: target },
        ],
      },
    });
  });

  it('allows zero targets but rejects duplicate targets and unknown plural slots', () => {
    const { start, spell, target } = fireballBoard();
    expect(validateAction(start.state, fireballAction(spell, 1, []))).toBeNull();
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [null],
        x: 1,
      }),
    ).toBeNull();
    expect(
      validateAction(
        start.state,
        fireballAction(spell, 1, [
          { kind: 'permanent', oid: target },
          { kind: 'permanent', oid: target },
        ]),
      ),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...fireballAction(spell, 1, [{ kind: 'player', player: 1 }]),
        multiTargets: { 1: [{ kind: 'player', player: 1 }] },
      }),
    ).not.toBeNull();
  });

  it('stages every wide-board cast target instead of truncating target subsets', () => {
    const start = scenario({
      battlefield: [
        ...Array.from({ length: 13 }, () => ({ card: TARGET, controller: 1 as const })),
        ...lands(MOUNTAIN, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[FIREBALL], []],
    });
    const priority = pendingDecision(start.state);
    if (priority?.kind !== 'priority') throw new Error('Fireball did not receive priority');
    const starts = priority.options.filter((action) => action.type === 'beginCastSpell' && action.x === 3);
    expect(starts).toHaveLength(1);
    const staged = reduce(start.state, starts[0]!);
    const decision = pendingDecision(staged.state);
    if (decision?.kind !== 'pluralTargets') throw new Error('Fireball targets were not staged');
    const offered = decision.options.filter(
      (action) => action.type === 'choosePluralTarget' && action.target?.kind === 'permanent',
    );
    expect(offered).toHaveLength(13);
    expect(decision.options.length).toBeLessThan(512);
    expect(decision.complete).toBe(true);
  });

  it('retains the selected alternative price while plural targets are staged', () => {
    const start = scenario({
      battlefield: [
        { card: TARGET, controller: 0 },
        { card: TARGET, controller: 1 },
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[ALTERNATIVE_DIVIDED_DAMAGE], []],
    });
    const priority = pendingDecision(start.state);
    if (priority?.kind !== 'priority') throw new Error('alternative divided spell had no priority');
    const starts = priority.options.filter(
      (action): action is Extract<Action, { type: 'beginCastSpell' }> =>
        action.type === 'beginCastSpell' && action.oid === start.state.players[0].hand[0],
    );
    expect(starts.map((action) => action.castingCost).sort()).toEqual(['alternative', 'mana']);
    const alternative = starts.find((action) => action.castingCost === 'alternative');
    if (alternative === undefined) throw new Error('alternative divided spell lost its alternative route');
    const staged = reduce(start.state, alternative);

    expect(staged.state.pendingPluralTargets).toMatchObject({
      castingCost: 'alternative',
      sacrifices: alternative.sacrifices,
    });
  });

  it('replays the serialized plural target choice byte for byte from recorded indices', () => {
    const setup: GameSetup = {
      seed: 'm11/fireball/divided-replay',
      decks: [
        {
          name: 'Fireballs',
          cards: [
            ...Array.from({ length: 8 }, () => FIREBALL),
            ...Array.from({ length: 32 }, () => MOUNTAIN),
          ],
        },
        { name: 'Mountains', cards: Array.from({ length: 40 }, () => MOUNTAIN) },
      ],
    };
    const seats: readonly [Seat, Seat] = [humanSeat('A'), humanSeat('B')];
    let session: GameSession = createSession(setup, seats);
    for (let guard = 0; guard < 800; guard += 1) {
      const decision = session.pending;
      if (decision === null) throw new Error('Fireball replay rig stopped before the cast');
      let pick = decision.options.findIndex((action) => action.type === 'passPriority');
      if (decision.kind === 'mulligan') {
        pick = decision.options.findIndex((action) => action.type === 'keepHand');
      } else if (decision.kind === 'priority') {
        const land = decision.options.findIndex((action) => action.type === 'playLand');
        const divided = decision.options.findIndex(
          (action) => action.type === 'beginCastSpell' && action.x === 2,
        );
        pick = land >= 0 ? land : divided >= 0 ? divided : pick;
      } else if (decision.kind === 'pluralTargets') {
        const wantedPlayer = decision.selected.length;
        pick = decision.options.findIndex(
          (action) =>
            action.type === 'choosePluralTarget' &&
            (wantedPlayer < 2
              ? action.target?.kind === 'player' && action.target.player === wantedPlayer
              : action.target === null),
        );
      } else if (decision.kind === 'declareAttackers') {
        pick = decision.options.findIndex(
          (action) => action.type === 'declareAttackers' && action.attackers.length === 0,
        );
      } else if (decision.kind === 'declareBlockers') {
        pick = decision.options.findIndex(
          (action) => action.type === 'declareBlockers' && action.blocks.length === 0,
        );
      }
      if (pick < 0) pick = 0;
      session = choose(session, pick);
      if (session.state.stack.at(-1)?.multiTargets?.[0]?.length === 2) break;
    }
    expect(session.state.stack.at(-1)).toMatchObject({
      x: 2,
      multiTargets: {
        0: [
          { kind: 'player', player: 0 },
          { kind: 'player', player: 1 },
        ],
      },
    });
    const replayed = replaySession(setup, seats, session.choices);

    expect(replayed.choices).toEqual(session.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
  });
});

describe('Inferno Titan', () => {
  it('removes a trigger whose positive allocation cannot satisfy its target minimum', () => {
    const start = scenario({ battlefield: [{ card: IMPOSSIBLE_DISTRIBUTOR, controller: 0 }] });
    const source = oidOf(start.state, IMPOSSIBLE_DISTRIBUTOR.name);
    const ability = IMPOSSIBLE_DISTRIBUTOR.abilities?.[0];
    if (ability?.kind !== 'triggered') throw new Error('feasibility fixture lost its trigger');
    const entry: StackEntry = {
      oid: 'ab-impossible-distribution',
      controller: 0,
      targets: [],
      ability: { sourceOid: source, index: 0 },
      sourceCard: IMPOSSIBLE_DISTRIBUTOR,
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: { colors: [], subtypes: ['Giant'], keywords: [] },
    };
    const pending: TriggerOnStack = { entry, ability, source, index: 0 };

    expect(triggerHasLegalTargets(start.state, pending)).toBe(false);
  });

  it('offers positive allocations totaling three across one to three distinct any targets', () => {
    const entered = enterTitan();
    const decision = pendingDecision(entered.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Inferno Titan did not ask for targets');
    expect(decision.options).toHaveLength(1);
    const started = apply(entered, decision.options[0]!);
    const members = pendingDecision(started.state);
    if (members?.kind !== 'pluralTargets') throw new Error('member choice was not staged');
    const aimed = apply(
      started,
      members.options.find(
        (action) =>
          action.type === 'choosePluralTarget' &&
          action.target?.kind === 'player' &&
          action.target.player === 1,
      )!,
    );
    const finish = pendingDecision(aimed.state);
    if (finish?.kind !== 'pluralTargets') throw new Error('target list could not be finished');
    const allocating = apply(
      aimed,
      finish.options.find((action) => action.type === 'choosePluralTarget' && action.target === null)!,
    );
    const allocation = pendingDecision(allocating.state);
    if (allocation?.kind !== 'damageAllocation') throw new Error('damage allocation was not staged');
    expect(allocation.options).toEqual([
      { type: 'allocateDividedDamage', player: 0, oid: decision.oid, amount: 3 },
    ]);
    const completed = apply(allocating, allocation.options[0]!);
    expect(topOfStack(completed.state)).toMatchObject({
      multiTargets: { 0: [{ kind: 'player', player: 1 }] },
      damageAllocations: { 0: [3] },
    });
  });

  it('keeps every wide-board target reachable without a capped Cartesian product', () => {
    const targets = Array.from({ length: 13 }, () => ({ card: TARGET, controller: 1 as const }));
    const start = scenario({
      battlefield: [{ card: INFERNO_TITAN, controller: 0, summoningSick: false }, ...targets],
      active: 0,
      step: 'declareAttackers',
    });
    const titan = oidOf(start.state, INFERNO_TITAN.name);
    const declared = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: titan, defender: 1 }],
    });
    const initial = pendingDecision(declared.state);
    if (initial?.kind !== 'triggerTargets') throw new Error('trigger did not ask for its ordinary tuple');
    expect(initial.options).toHaveLength(1);
    expect(initial.complete).toBe(true);
    const staged = reduce(declared.state, initial.options[0]!);
    const decision = pendingDecision(staged.state);
    if (decision?.kind !== 'pluralTargets') throw new Error('wide target choice was not staged');
    const offered = new Set(
      decision.options.flatMap((action) =>
        action.type === 'choosePluralTarget' && action.target?.kind === 'permanent'
          ? [action.target.oid]
          : [],
      ),
    );
    expect([...offered]).toEqual(staged.state.battlefield);
    expect(decision.options.length).toBeLessThan(512);
    expect(decision.complete).toBe(true);
  });

  it('rejects premature completion, duplicates, and impossible staged shares', () => {
    const entered = enterTitan();
    const initial = pendingDecision(entered.state);
    if (initial?.kind !== 'triggerTargets') throw new Error('trigger did not ask for targets');
    const staged = reduce(entered.state, initial.options[0]!);
    expect(
      validateAction(staged.state, {
        type: 'choosePluralTarget',
        player: 0,
        oid: initial.oid,
        target: null,
      }),
    ).not.toBeNull();
    const members = pendingDecision(staged.state);
    if (members?.kind !== 'pluralTargets') throw new Error('member choice was not staged');
    const first = members.options.find(
      (action) => action.type === 'choosePluralTarget' && action.target?.kind === 'player',
    );
    if (first?.type !== 'choosePluralTarget' || first.target === null) throw new Error('no player target');
    const chosen = reduce(staged.state, first);
    expect(validateAction(chosen.state, first)).not.toBeNull();
    const finish = pendingDecision(chosen.state);
    if (finish?.kind !== 'pluralTargets') throw new Error('target list could not finish');
    const allocating = reduce(
      chosen.state,
      finish.options.find((action) => action.type === 'choosePluralTarget' && action.target === null)!,
    );
    expect(
      validateAction(allocating.state, {
        type: 'allocateDividedDamage',
        player: 0,
        oid: initial.oid,
        amount: 2,
      }),
    ).not.toBeNull();
  });

  it('keeps each chosen allocation paired with its target after another target becomes illegal', () => {
    const entered = enterTitan();
    const decision = pendingDecision(entered.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Inferno Titan did not ask for targets');
    const target = oidOf(entered.state, TARGET.name);
    const aimed = apply(entered, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'permanent', oid: target },
          { kind: 'player', player: 1 },
        ],
      },
      damageAllocations: { 0: [2, 1] },
    });
    const removed = moveObject(beginTrace(aimed.state), target, 'graveyard');
    const done = passStack({ state: removed.state, events: [...aimed.events, ...removed.events] });

    expect(playerOf(done.state, 1).life).toBe(19);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('removes the ability without damage when every allocated target becomes illegal', () => {
    const entered = enterTitan();
    const decision = pendingDecision(entered.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Inferno Titan did not ask for targets');
    const target = oidOf(entered.state, TARGET.name);
    const aimed = apply(entered, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [null],
      multiTargets: { 0: [{ kind: 'permanent', oid: target }] },
      damageAllocations: { 0: [3] },
    });
    const removed = moveObject(beginTrace(aimed.state), target, 'graveyard');
    const done = passStack({ state: removed.state, events: [...aimed.events, ...removed.events] });

    expect(done.state.stack).toEqual([]);
    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
  });

  it('fires on attack and retains the exact source after that source leaves', () => {
    const start = scenario({
      battlefield: [
        { card: INFERNO_TITAN, controller: 0, summoningSick: false },
        { card: TARGET, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const titan = oidOf(start.state, INFERNO_TITAN.name);
    const declared = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: titan, defender: 1 }],
    });

    expect(eventsOfType(declared.events, 'abilityTriggered')).toHaveLength(1);
    expect(topOfStack(declared.state)?.sourceCard?.id).toBe(INFERNO_TITAN.id);

    const decision = pendingDecision(declared.state);
    if (decision?.kind !== 'triggerTargets')
      throw new Error('attacking Inferno Titan did not ask for targets');
    const aimed = apply(declared, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [null],
      multiTargets: { 0: [{ kind: 'player', player: 1 }] },
      damageAllocations: { 0: [3] },
    });
    const gone = moveObject(beginTrace(aimed.state), titan, 'graveyard');
    const done = passStack({ state: gone.state, events: [...aimed.events, ...gone.events] });

    expect(playerOf(done.state, 1).life).toBe(17);
    expect(eventsOfType(done.events, 'damageDealt')).toContainEqual({
      type: 'damageDealt',
      sourceOid: titan,
      target: { kind: 'player', player: 1 },
      amount: 3,
      deathtouch: false,
      combat: false,
    });
  });

  it('retains lifelink and deathtouch after the divided-damage source leaves', () => {
    const start = scenario({
      battlefield: [
        { card: COLLARED_TITAN, controller: 0, summoningSick: false },
        { card: TARGET, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
      life: [10, 20],
    });
    const titan = oidOf(start.state, COLLARED_TITAN.name);
    const target = oidOf(start.state, TARGET.name);
    const declared = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: titan, defender: 1 }],
    });
    const decision = pendingDecision(declared.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('trigger did not ask for targets');
    const aimed = apply(declared, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [null],
      multiTargets: { 0: [{ kind: 'permanent', oid: target }] },
      damageAllocations: { 0: [3] },
    });
    const gone = moveObject(beginTrace(aimed.state), titan, 'graveyard');
    const done = passStack({ state: gone.state, events: [...aimed.events, ...gone.events] });

    expect(playerOf(done.state, 0).life).toBe(13);
    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'damageDealt')).toContainEqual({
      type: 'damageDealt',
      sourceOid: titan,
      target: { kind: 'permanent', oid: target },
      amount: 3,
      deathtouch: true,
      combat: false,
    });
  });

  it('pumps only itself for each red activation', () => {
    const start = scenario({
      battlefield: [
        { card: INFERNO_TITAN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
    });
    const titan = oidOf(start.state, INFERNO_TITAN.name);
    const activated = reduce(start.state, {
      type: 'activateAbility',
      player: 0,
      oid: titan,
      abilityIndex: 1,
      targets: [null],
      sacrifices: [],
    });
    const done = passStack(activated);

    expect(powerOf(done.state, titan)).toBe(7);
  });

  it('rejects zero targets, zero allocations, duplicate targets, and totals other than three', () => {
    const entered = enterTitan();
    const decision = pendingDecision(entered.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Inferno Titan did not ask for targets');
    const target = oidOf(entered.state, TARGET.name);
    const base = {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [null],
    } as const;
    const submissions = [
      { ...base, multiTargets: { 0: [] }, damageAllocations: { 0: [] } },
      {
        ...base,
        multiTargets: { 0: [{ kind: 'permanent' as const, oid: target }] },
        damageAllocations: { 0: [0] },
      },
      {
        ...base,
        multiTargets: {
          0: [
            { kind: 'permanent' as const, oid: target },
            { kind: 'permanent' as const, oid: target },
          ],
        },
        damageAllocations: { 0: [1, 2] },
      },
      {
        ...base,
        multiTargets: { 0: [{ kind: 'permanent' as const, oid: target }] },
        damageAllocations: { 0: [2] },
      },
    ];

    for (const action of submissions) expect(validateAction(entered.state, action)).not.toBeNull();
  });
});
