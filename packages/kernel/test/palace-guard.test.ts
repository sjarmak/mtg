/** Palace Guard's unlimited block capacity and reverse damage assignment order. */
import { describe, expect, it } from 'vitest';
import type { Action, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  assignBlockerDamage,
  asksInSteps,
  beginTrace,
  chooseAction,
  createRegenerationShield,
  destroyPermanent,
  humanSeat,
  pendingDecision,
  reduce,
  satisfyMustBeBlocked,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature } from './cards';
import { damageOn, oidOf } from './helpers';

const PALACE_GUARD = creature('Palace Guard', 1, 4, {
  cost: { generic: 2, W: 1 },
  subtypes: ['Human', 'Soldier'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'canBlockAnyNumber' },
    },
  ],
});

const ordinaryGuard = (name: string) => creature(name, 1, 4);

function blockDecisionBoard(blocker: ReturnType<typeof creature>): {
  readonly state: GameState;
  readonly attackers: readonly [ObjectId, ObjectId];
  readonly blocker: ObjectId;
} {
  const start = scenario({
    seed: 'kernel/palace-guard',
    battlefield: [
      { card: creature('First Attacker', 2, 2), controller: 0 },
      { card: creature('Second Attacker', 2, 2), controller: 0 },
      { card: blocker, controller: 1 },
    ],
    active: 0,
    turn: 4,
    step: 'declareAttackers',
  });
  const first = oidOf(start.state, 'First Attacker');
  const second = oidOf(start.state, 'Second Attacker');
  const blockerOid = oidOf(start.state, blocker.name);
  let state = reduce(start.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: [
      { oid: first, defender: 1 },
      { oid: second, defender: 1 },
    ],
  }).state;
  for (let guard = 0; guard < 10; guard += 1) {
    const decision = pendingDecision(state);
    if (decision?.kind === 'declareBlockers')
      return { state, attackers: [first, second], blocker: blockerOid };
    if (decision?.kind !== 'priority') throw new Error('the board never reached blockers');
    state = reduce(state, { type: 'passPriority', player: decision.player }).state;
  }
  throw new Error('the board never reached blockers');
}

function blockSpellings(state: GameState): readonly string[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'declareBlockers') throw new Error('the board is not asking for blockers');
  return decision.options
    .filter(
      (option): option is Extract<Action, { type: 'declareBlockers' }> => option.type === 'declareBlockers',
    )
    .map((option) =>
      option.blocks
        .map((block) => `${block.blocker}>${block.attacker}`)
        .sort()
        .join('|'),
    )
    .sort();
}

describe('unlimited block capacity', () => {
  it('offers every subset for Palace Guard, while an ordinary creature still chooses at most one attacker', () => {
    const palace = blockDecisionBoard(PALACE_GUARD);
    const ordinary = blockDecisionBoard(ordinaryGuard('Ordinary Guard'));

    expect(blockSpellings(palace.state)).toEqual([
      '',
      `${palace.blocker}>${palace.attackers[0]}`,
      `${palace.blocker}>${palace.attackers[0]}|${palace.blocker}>${palace.attackers[1]}`,
      `${palace.blocker}>${palace.attackers[1]}`,
    ]);
    expect(blockSpellings(ordinary.state)).toHaveLength(3);
  });

  it('accepts two distinct Palace Guard assignments and rejects both a duplicate pair and an ordinary repeat', () => {
    const palace = blockDecisionBoard(PALACE_GUARD);
    const both = palace.attackers.map((attacker) => ({ blocker: palace.blocker, attacker }));
    expect(validateAction(palace.state, { type: 'declareBlockers', player: 1, blocks: both })).toBeNull();
    expect(
      validateAction(palace.state, {
        type: 'declareBlockers',
        player: 1,
        blocks: [both[0]!, both[0]!],
      }),
    ).toMatch(/already blocks|twice/);

    const ordinary = blockDecisionBoard(ordinaryGuard('Capacity One Guard'));
    expect(
      validateAction(ordinary.state, {
        type: 'declareBlockers',
        player: 1,
        blocks: ordinary.attackers.map((attacker) => ({ blocker: ordinary.blocker, attacker })),
      }),
    ).toMatch(/cannot block twice/);
  });

  it('reaches a subset containing only the tenth attacker without exceeding the option cap', () => {
    const attackers = Array.from({ length: 10 }, (_, index) => creature(`Wide Attacker ${index + 1}`, 2, 2));
    const start = scenario({
      seed: 'kernel/palace-guard/capped-declaration',
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: PALACE_GUARD, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    const attackerOids = attackers.map((card) => oidOf(start.state, card.name));
    const wanted = attackerOids.at(-1);
    if (wanted === undefined) throw new Error('the wide board has no last attacker');
    const palace = oidOf(start.state, PALACE_GUARD.name);
    let state = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: attackerOids.map((oid) => ({ oid, defender: 1 })),
    }).state;
    let declarationStarted = false;
    for (let guard = 0; guard < 20; guard += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind === 'priority') {
        if (declarationStarted) break;
        state = reduce(state, { type: 'passPriority', player: decision.player }).state;
        continue;
      }
      if (decision?.kind !== 'declareBlockers') break;
      declarationStarted = true;
      expect(decision.options.length).toBeLessThanOrEqual(512);
      const compatible = decision.options.filter(
        (option): option is Extract<Action, { type: 'declareBlockers' }> =>
          option.type === 'declareBlockers' &&
          option.blocks.every((block) => block.blocker === palace && block.attacker === wanted),
      );
      const chosen = compatible.sort((left, right) => right.blocks.length - left.blocks.length)[0];
      if (chosen === undefined) throw new Error('the tenth-attacker-only subset became unreachable');
      state = reduce(state, chosen).state;
    }
    expect(state.combat.blocks).toEqual([{ attacker: wanted, blockers: [palace] }]);
  });

  it('uses one unlimited blocker to satisfy two must-be-blocked attackers', () => {
    const lure = (name: string) =>
      creature(name, 2, 2, {
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'mustBeBlockedIfAble' },
          },
        ],
      });
    const firstCard = lure('First Lure');
    const secondCard = lure('Second Lure');
    const start = scenario({
      seed: 'kernel/palace-guard/must-block-capacity',
      battlefield: [
        { card: firstCard, controller: 0 },
        { card: secondCard, controller: 0 },
        { card: PALACE_GUARD, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    const first = oidOf(start.state, firstCard.name);
    const second = oidOf(start.state, secondCard.name);
    const palace = oidOf(start.state, PALACE_GUARD.name);
    let state = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [
        { oid: first, defender: 1 },
        { oid: second, defender: 1 },
      ],
    }).state;
    for (let guard = 0; guard < 10; guard += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind === 'declareBlockers') break;
      if (decision?.kind !== 'priority') throw new Error('the lure board never reached blockers');
      state = reduce(state, { type: 'passPriority', player: decision.player }).state;
    }
    const one = [{ blocker: palace, attacker: first }];
    const both = [...one, { blocker: palace, attacker: second }];
    expect(validateAction(state, { type: 'declareBlockers', player: 1, blocks: one })).not.toBeNull();
    expect(validateAction(state, { type: 'declareBlockers', player: 1, blocks: both })).toBeNull();
    expect(satisfyMustBeBlocked(state, [])).toEqual(both);
  });
});

describe('a blocker facing several attackers', () => {
  it('asks its controller for the reverse damage assignment order', () => {
    const board = blockDecisionBoard(PALACE_GUARD);
    const declared = reduce(board.state, {
      type: 'declareBlockers',
      player: 1,
      blocks: board.attackers.map((attacker) => ({ blocker: board.blocker, attacker })),
    });

    const decision = pendingDecision(declared.state);
    expect(decision?.kind).toBe('orderAttackers');
    if (decision?.kind !== 'orderAttackers') return;
    expect(decision.player).toBe(1);
    expect(decision.blocks).toEqual([{ blocker: board.blocker, attackers: board.attackers }]);
  });

  it('spends one power budget in the chosen order instead of dealing full power to every attacker', () => {
    const divider = creature('Wide Divider', 3, 8, {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'canBlockAnyNumber' },
        },
      ],
    });
    const board = blockDecisionBoard(divider);
    let state = reduce(board.state, {
      type: 'declareBlockers',
      player: 1,
      blocks: board.attackers.map((attacker) => ({ blocker: board.blocker, attacker })),
    }).state;
    const order: Action = {
      type: 'orderAttackers',
      player: 1,
      orders: [{ blocker: board.blocker, attackers: board.attackers }],
    };
    state = reduce(state, order).state;
    for (let guard = 0; guard < 30 && state.turn.step !== 'endCombat'; guard += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind !== 'priority') throw new Error(`unexpected decision ${decision?.kind ?? 'none'}`);
      state = reduce(state, { type: 'passPriority', player: decision.player }).state;
    }

    expect(state.objects[board.attackers[0]]?.zone).toBe('graveyard');
    expect(damageOn(state, board.attackers[1])).toBe(1);
  });

  it('stops assigning blocker damage to an attacker regeneration removed from combat', () => {
    const divider = creature('Regeneration Divider', 3, 8, {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'canBlockAnyNumber' },
        },
      ],
    });
    const board = blockDecisionBoard(divider);
    let state = reduce(board.state, {
      type: 'declareBlockers',
      player: 1,
      blocks: board.attackers.map((attacker) => ({ blocker: board.blocker, attacker })),
    }).state;
    state = reduce(state, {
      type: 'orderAttackers',
      player: 1,
      orders: [{ blocker: board.blocker, attackers: board.attackers }],
    }).state;

    const shielded = createRegenerationShield(beginTrace(state), board.attackers[0], 0);
    const regenerated = destroyPermanent(shielded, board.attackers[0], 'lethalDamage').state;

    expect(regenerated.combat.attacks.map((attack) => attack.oid)).toEqual([board.attackers[1]]);
    expect(regenerated.combat.attackerOrders).toBeUndefined();
    expect(assignBlockerDamage(regenerated, board.blocker, 3)).toEqual([
      { recipient: board.attackers[1], amount: 3 },
    ]);
  });

  it('counts damage assigned by an earlier attacker before a later trampler assigns its damage', () => {
    const tramplers = [
      creature('First Trampler', 3, 3, { keywords: ['trample'] }),
      creature('Second Trampler', 3, 3, { keywords: ['trample'] }),
    ];
    const guard = creature('Shared Blocker', 2, 2, {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'canBlockAnyNumber' },
        },
      ],
    });
    const start = scenario({
      seed: 'kernel/palace-guard/simultaneous-assignment',
      battlefield: [
        ...tramplers.map((card) => ({ card, controller: 0 as const })),
        { card: guard, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    const attackers = tramplers.map((card) => oidOf(start.state, card.name));
    const blocker = oidOf(start.state, guard.name);
    let state = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: attackers.map((oid) => ({ oid, defender: 1 })),
    }).state;
    for (let guardCount = 0; guardCount < 10; guardCount += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind === 'declareBlockers') break;
      if (decision?.kind !== 'priority') throw new Error('the trample board never reached blockers');
      state = reduce(state, { type: 'passPriority', player: decision.player }).state;
    }
    state = reduce(state, {
      type: 'declareBlockers',
      player: 1,
      blocks: attackers.map((attacker) => ({ blocker, attacker })),
    }).state;
    state = reduce(state, {
      type: 'orderAttackers',
      player: 1,
      orders: [{ blocker, attackers }],
    }).state;
    for (let guardCount = 0; guardCount < 30 && state.turn.step !== 'endCombat'; guardCount += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind !== 'priority') throw new Error(`unexpected decision ${decision?.kind ?? 'none'}`);
      state = reduce(state, { type: 'passPriority', player: decision.player }).state;
    }

    expect(state.players[1].life).toBe(16);
  });

  it('accepts a complete reverse order when a capped decision asks for it one position at a time', () => {
    const attackers = Array.from({ length: 6 }, (_, index) =>
      creature(`Ordered Attacker ${index + 1}`, 1, 1),
    );
    const start = scenario({
      seed: 'kernel/palace-guard/capped-reverse-order',
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: PALACE_GUARD, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    const attackerOids = attackers.map((card) => oidOf(start.state, card.name));
    const blocker = oidOf(start.state, PALACE_GUARD.name);
    let state = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: attackerOids.map((oid) => ({ oid, defender: 1 })),
    }).state;
    for (let guard = 0; guard < 10; guard += 1) {
      const decision = pendingDecision(state);
      if (decision?.kind === 'declareBlockers') break;
      if (decision?.kind !== 'priority') throw new Error('the capped order board never reached blockers');
      state = reduce(state, { type: 'passPriority', player: decision.player }).state;
    }
    state = reduce(state, {
      type: 'declareBlockers',
      player: 1,
      blocks: attackerOids.map((attacker) => ({ blocker, attacker })),
    }).state;
    const decision = pendingDecision(state);
    if (decision?.kind !== 'orderAttackers') throw new Error('the capped order board asked no reverse order');
    const wanted: Action = {
      type: 'orderAttackers',
      player: 1,
      orders: [{ blocker, attackers: [...attackerOids].reverse() }],
    };
    const session: GameSession = {
      seats: [humanSeat('active'), humanSeat('defender')],
      state,
      events: [],
      result: null,
      pending: decision,
      choices: [],
      decisions: 0,
      beat: null,
      committed: null,
    };

    expect(asksInSteps(decision)).toBe(true);
    expect(validateAction(state, wanted)).toBeNull();
    const applied = chooseAction(session, wanted);
    expect(applied.choices[0]).toEqual(wanted);
    expect(applied.state.combat.attackerOrders?.[0]?.attackers).toEqual([...attackerOids].reverse());
  });
});
