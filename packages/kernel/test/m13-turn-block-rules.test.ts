/** Played-game evidence for M13's blocker-relative CR 509.1c rules. */
import type { AbilityInput, Effect } from '@mtg/dsl';
import {
  canBlock,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const BLOCKS: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [
    {
      kind: 'blocksThisTurnIfAble',
      target: { kind: 'targetCreature' },
    } as unknown as Effect,
  ],
};

const COURTLY = creature('Courtly Provocateur', 1, 1, { abilities: [BLOCKS] });
const BEAR = creature('Runeclaw Bear', 2, 2);
const OGRE = creature('Test Ogre', 3, 3);
const DRAKE = creature('Test Drake', 2, 2, { keywords: ['flying'] });
const MENACE = creature('Test Menace', 3, 3, { keywords: ['menace'] });
const FLYING_MENACE = creature('Test Flying Menace', 3, 3, { keywords: ['flying', 'menace'] });
const RED_FLYER_ONE = creature('Test Red Flyer One', 2, 2, {
  cost: { R: 1 },
  keywords: ['flying'],
});
const RED_FLYER_TWO = creature('Test Red Flyer Two', 2, 2, {
  cost: { R: 1 },
  keywords: ['flying'],
});
const RED_BLOCKER = creature('Test Red Blocker', 2, 2, { cost: { R: 1 } });
const PROTECTED = creature('Test Protected', 2, 2, {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
});
const GROUND_MAGNET = creature('Ground Magnet', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});
const GROUND_MAGNET_TWO = creature('Second Ground Magnet', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});
const SKY_MAGNET = creature('Sky Magnet', 2, 2, {
  keywords: ['flying'],
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});
const UNBLOCKABLE_MAGNET = creature('Test Unblockable Magnet', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantBeBlocked' } },
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});
const MANY_BLOCKER = creature('Test Many Blocker', 2, 4, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'canBlockAnyNumber' } }],
});
const RELUCTANT_BLOCKER = creature('Test Reluctant Blocker', 2, 2, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttackOrBlockAlone' },
    },
  ],
});

function advanceTo(current: ReduceResult, step: GameState['turn']['step']): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 80; guard += 1) {
    if (walked.state.turn.step === step) return walked;
    const decision = pendingDecision(walked.state);
    if (decision?.kind === 'priority') {
      walked = apply(walked, { type: 'passPriority', player: decision.player });
      continue;
    }
    if (decision?.kind === 'declareAttackers') {
      walked = apply(walked, { type: 'declareAttackers', player: decision.player, attackers: [] });
      continue;
    }
    if (decision?.kind === 'declareBlockers') {
      walked = apply(walked, { type: 'declareBlockers', player: decision.player, blocks: [] });
      continue;
    }
    throw new Error(`advanceTo: stopped on ${String(decision?.kind ?? 'nothing')} before ${step}`);
  }
  throw new Error(`advanceTo: never reached ${step}`);
}

function activateAt(
  current: ReduceResult,
  player: 0 | 1,
  sourceName: string,
  target: ObjectId,
): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 4; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('activateAt: nobody has priority');
    if (decision.player === player) break;
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  walked = apply(walked, {
    type: 'activateAbility',
    player,
    oid: oidOf(walked.state, sourceName),
    abilityIndex: 0,
    targets: [{ kind: 'permanent', oid: target }],
    sacrifices: [],
  });
  for (let guard = 0; guard < 10; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('activateAt: the stack stalled');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('activateAt: the stack did not empty');
}

function toDeclareBlockers(state: GameState, attackers: readonly ObjectId[]): GameState {
  let current = reduce(state, {
    type: 'declareAttackers',
    player: state.turn.active,
    attackers: attackers.map((oid) => ({ oid, defender: state.turn.active === 0 ? 1 : 0 })),
  });
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.state.turn.step === 'declareBlockers') return current.state;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('toDeclareBlockers: combat stalled');
    current = reduce(current.state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('toDeclareBlockers: did not reach blockers');
}

type CombatRule = GameState['turnCombatRules'][number];

function rule(rule: CombatRule['rule'], sourceOid: ObjectId, subject: ObjectId): CombatRule {
  return { rule, sourceOid, subject } as CombatRule;
}

function withRules(state: GameState, ...rules: readonly CombatRule[]): GameState {
  return { ...state, turnCombatRules: [...state.turnCombatRules, ...rules] };
}

function validateBlocks(state: GameState, blocks: Extract<Action, { type: 'declareBlockers' }>['blocks']) {
  return validateAction(state, { type: 'declareBlockers', player: state.turn.active === 0 ? 1 : 0, blocks });
}

describe('blocksThisTurnIfAble', () => {
  it('keeps a wide set of attacker-relative requirements interactive', { timeout: 1_000 }, () => {
    const attackers = Array.from({ length: 18 }, (_, index) =>
      creature(`Test Magnet ${String(index)}`, 2, 2, {
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'mustBeBlockedIfAble' },
          },
        ],
      }),
    );
    const start = scenario({
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const blocking = toDeclareBlockers(
      start.state,
      attackers.map((card) => oidOf(start.state, card.name)),
    );

    expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
  });

  it('discards a wide set of impossible blocker requirements promptly', { timeout: 1_000 }, () => {
    const blockers = Array.from({ length: 18 }, (_, index) =>
      creature(`Test Ground Blocker ${String(index)}`, 2, 2),
    );
    const start = scenario({
      battlefield: [
        { card: DRAKE, controller: 0 },
        ...blockers.map((card) => ({ card, controller: 1 as const })),
      ],
      step: 'declareAttackers',
    });
    const imposed = withRules(
      start.state,
      ...blockers.map((card) => {
        const oid = oidOf(start.state, card.name);
        return rule('blocksThisTurnIfAble', oid, oid);
      }),
    );
    const blocking = toDeclareBlockers(imposed, [oidOf(imposed, DRAKE.name)]);

    expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
  });

  it('discards a wide set of impossible menace requirements promptly', { timeout: 1_000 }, () => {
    const attackers = Array.from({ length: 18 }, (_, index) =>
      creature(`Test Menace Magnet ${String(index)}`, 2, 2, {
        keywords: ['menace'],
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'mustBeBlockedIfAble' },
          },
        ],
      }),
    );
    const start = scenario({
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const blocking = toDeclareBlockers(
      start.state,
      attackers.map((card) => oidOf(start.state, card.name)),
    );

    expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
  });

  it('does not combine cohort-only menace alternatives exponentially', { timeout: 1_000 }, () => {
    const menaceAttackers = Array.from({ length: 18 }, (_, index) =>
      creature(`Test Cohort Menace ${String(index)}`, 2, 2, { keywords: ['flying', 'menace'] }),
    );
    const start = scenario({
      battlefield: [
        { card: PROTECTED, controller: 0 },
        { card: UNBLOCKABLE_MAGNET, controller: 0 },
        ...menaceAttackers.map((card) => ({ card, controller: 0 as const })),
        { card: RELUCTANT_BLOCKER, controller: 1 },
        { card: RED_FLYER_ONE, controller: 1 },
        { card: RED_FLYER_TWO, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const reluctant = oidOf(start.state, RELUCTANT_BLOCKER.name);
    const imposed = withRules(start.state, rule('blocksThisTurnIfAble', reluctant, reluctant));
    const blocking = toDeclareBlockers(imposed, [
      oidOf(imposed, PROTECTED.name),
      oidOf(imposed, UNBLOCKABLE_MAGNET.name),
      ...menaceAttackers.map((card) => oidOf(imposed, card.name)),
    ]);

    expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
    expect(validateBlocks(blocking, [])).not.toBeNull();
  });

  it('removes the stay-home answer after Courtly resolves through the real stack', () => {
    const start = scenario({
      battlefield: [
        { card: COURTLY, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
      ],
    });
    const ogre = oidOf(start.state, OGRE.name);
    const bear = oidOf(start.state, BEAR.name);
    const compelled = activateAt(start, 0, COURTLY.name, ogre);
    expect(compelled.state.turnCombatRules).toContainEqual({
      rule: 'blocksThisTurnIfAble',
      sourceOid: oidOf(compelled.state, COURTLY.name),
      subject: ogre,
    });

    const combat = advanceTo(compelled, 'declareAttackers');
    const blocking = toDeclareBlockers(combat.state, [bear]);
    expect(validateBlocks(blocking, [])).not.toBeNull();
    expect(validateBlocks(blocking, [{ blocker: ogre, attacker: bear }])).toBeNull();
  });

  it('does not manufacture a block through tapped status, evasion, or protection', () => {
    const boards = [
      {
        attacker: DRAKE,
        blocker: OGRE,
        blockerOptions: {},
      },
      {
        attacker: PROTECTED,
        blocker: RED_BLOCKER,
        blockerOptions: {},
      },
      {
        attacker: BEAR,
        blocker: OGRE,
        blockerOptions: { tapped: true },
      },
    ] as const;
    for (const entry of boards) {
      const start = scenario({
        battlefield: [
          { card: entry.attacker, controller: 0 },
          { card: entry.blocker, controller: 1, ...entry.blockerOptions },
        ],
        step: 'declareAttackers',
      });
      const attacker = oidOf(start.state, entry.attacker.name);
      const blocker = oidOf(start.state, entry.blocker.name);
      const imposed = withRules(start.state, rule('blocksThisTurnIfAble', blocker, blocker));
      const blocking = toDeclareBlockers(imposed, [attacker]);
      expect(canBlock(blocking, blocker, attacker)).toBe(false);
      if (pendingDecision(blocking)?.kind === 'declareBlockers') {
        expect(validateBlocks(blocking, [])).toBeNull();
      }
    }
  });

  it('requires a menace partner only when the whole legal block can be completed', () => {
    for (const partnerPresent of [false, true]) {
      const battlefield = [
        { card: MENACE, controller: 0 as const },
        { card: OGRE, controller: 1 as const },
        ...(partnerPresent ? [{ card: BEAR, controller: 1 as const }] : []),
      ];
      const start = scenario({ battlefield, step: 'declareAttackers' });
      const attacker = oidOf(start.state, MENACE.name);
      const compelled = oidOf(start.state, OGRE.name);
      const imposed = withRules(start.state, rule('blocksThisTurnIfAble', compelled, compelled));
      const blocking = toDeclareBlockers(imposed, [attacker]);
      expect(validateBlocks(blocking, []) === null).toBe(!partnerPresent);
      if (partnerPresent) {
        expect(
          validateBlocks(blocking, [
            { blocker: compelled, attacker },
            { blocker: oidOf(blocking, BEAR.name), attacker },
          ]),
        ).toBeNull();
      }
    }
  });

  it('requires the attainable one of several competing menace requirements', () => {
    const attackers = Array.from({ length: 3 }, (_, index) =>
      creature(`Test Competing Menace ${String(index)}`, 3, 3, {
        keywords: ['menace'],
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'mustBeBlockedIfAble' },
          },
        ],
      }),
    );
    const start = scenario({
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: BEAR, controller: 1 },
        { card: OGRE, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const attackerOids = attackers.map((card) => oidOf(start.state, card.name));
    const blocking = toDeclareBlockers(start.state, attackerOids);
    const first = attackerOids[0];
    if (first === undefined) throw new Error('the competing menace board has no attacker');

    expect(validateBlocks(blocking, [])).not.toBeNull();
    expect(
      validateBlocks(blocking, [
        { blocker: oidOf(blocking, BEAR.name), attacker: first },
        { blocker: oidOf(blocking, OGRE.name), attacker: first },
      ]),
    ).toBeNull();
  });

  it(
    'solves a wide symmetric set of partially satisfiable menace requirements promptly',
    {
      timeout: 1_000,
    },
    () => {
      const attackers = Array.from({ length: 10 }, (_, index) =>
        creature(`Test Symmetric Menace ${String(index)}`, 3, 3, {
          keywords: ['menace'],
          abilities: [
            {
              kind: 'static',
              scope: 'self',
              subtype: null,
              modification: { kind: 'mustBeBlockedIfAble' },
            },
          ],
        }),
      );
      const blockers = Array.from({ length: 10 }, (_, index) =>
        creature(`Test Symmetric Blocker ${String(index)}`, 2, 2),
      );
      const start = scenario({
        battlefield: [
          ...attackers.map((card) => ({ card, controller: 0 as const })),
          ...blockers.map((card) => ({ card, controller: 1 as const })),
        ],
        step: 'declareAttackers',
      });
      const blocking = toDeclareBlockers(
        start.state,
        attackers.map((card) => oidOf(start.state, card.name)),
      );

      expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
    },
  );

  it('prunes menace requirements that compete for one shared blocker', { timeout: 1_000 }, () => {
    const keywords = [
      'vigilance',
      'haste',
      'trample',
      'deathtouch',
      'lifelink',
      'reach',
      'firstStrike',
      'flying',
    ] as const;
    const attackers = keywords.map((keyword, index) =>
      creature(`Test Adversarial Menace ${String(index)}`, 3, 3, {
        keywords: ['menace', keyword],
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'mustBeBlockedIfAble' },
          },
        ],
      }),
    );
    const shared = creature('Test Shared Blocker', 2, 2, { keywords: ['flying'] });
    const blockers = keywords.map((keyword, index) =>
      creature(`Test Restricted Blocker ${String(index)}`, 2, 2, {
        keywords: keyword === 'flying' ? ['flying'] : [],
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'blockOnlyCreaturesWithKeyword', keyword },
          },
        ],
      }),
    );
    const start = scenario({
      battlefield: [
        ...attackers.map((card) => ({ card, controller: 0 as const })),
        { card: shared, controller: 1 },
        ...blockers.map((card) => ({ card, controller: 1 as const })),
      ],
      step: 'declareAttackers',
    });
    const attackerOids = attackers.map((card) => oidOf(start.state, card.name));
    const blocking = toDeclareBlockers(start.state, attackerOids);
    const first = attackerOids[0];
    const firstBlocker = blockers[0];
    if (first === undefined || firstBlocker === undefined) throw new Error('adversarial board is empty');

    expect(pendingDecision(blocking)?.kind).toBe('declareBlockers');
    expect(validateBlocks(blocking, [])).not.toBeNull();
    expect(
      validateBlocks(blocking, [
        { blocker: oidOf(blocking, shared.name), attacker: first },
        { blocker: oidOf(blocking, firstBlocker.name), attacker: first },
      ]),
    ).toBeNull();
  });

  it('maximizes blocker-relative and attacker-relative requirements together', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: SKY_MAGNET, controller: 0 },
        { card: DRAKE, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const ground = oidOf(start.state, GROUND_MAGNET.name);
    const sky = oidOf(start.state, SKY_MAGNET.name);
    const flexible = oidOf(start.state, DRAKE.name);
    const groundOnly = oidOf(start.state, BEAR.name);
    const imposed = withRules(start.state, rule('blocksThisTurnIfAble', flexible, flexible));
    const blocking = toDeclareBlockers(imposed, [ground, sky]);

    expect(
      validateBlocks(blocking, [
        { blocker: flexible, attacker: ground },
        { blocker: groundOnly, attacker: ground },
      ]),
    ).not.toBeNull();
    expect(
      validateBlocks(blocking, [
        { blocker: flexible, attacker: sky },
        { blocker: groundOnly, attacker: ground },
      ]),
    ).toBeNull();
  });

  it('lets one compelled unlimited blocker cover multiple attacker requirements', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: GROUND_MAGNET_TWO, controller: 0 },
        { card: MANY_BLOCKER, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const ground = oidOf(start.state, GROUND_MAGNET.name);
    const second = oidOf(start.state, GROUND_MAGNET_TWO.name);
    const blocker = oidOf(start.state, MANY_BLOCKER.name);
    const imposed = withRules(start.state, rule('blocksThisTurnIfAble', blocker, blocker));
    const blocking = toDeclareBlockers(imposed, [ground, second]);

    expect(
      validateBlocks(blocking, [
        { blocker, attacker: ground },
        { blocker, attacker: second },
      ]),
    ).toBeNull();
    expect(validateBlocks(blocking, [{ blocker, attacker: ground }])).not.toBeNull();
  });

  it('compels a restricted blocker only alongside a legal cohort partner', () => {
    for (const partnerPresent of [false, true]) {
      const start = scenario({
        battlefield: [
          { card: OGRE, controller: 0 },
          { card: RELUCTANT_BLOCKER, controller: 1 },
          ...(partnerPresent ? [{ card: BEAR, controller: 1 as const }] : []),
        ],
        step: 'declareAttackers',
      });
      const attacker = oidOf(start.state, OGRE.name);
      const reluctant = oidOf(start.state, RELUCTANT_BLOCKER.name);
      const imposed = withRules(start.state, rule('blocksThisTurnIfAble', reluctant, reluctant));
      const blocking = toDeclareBlockers(imposed, [attacker]);

      expect(validateBlocks(blocking, []) === null).toBe(!partnerPresent);
      if (partnerPresent) {
        expect(
          validateBlocks(blocking, [
            { blocker: reluctant, attacker },
            { blocker: oidOf(blocking, BEAR.name), attacker },
          ]),
        ).toBeNull();
      }
    }
  });

  it('retains an unrequired menace group that is the only legal cohort completion', () => {
    const start = scenario({
      battlefield: [
        { card: PROTECTED, controller: 0 },
        { card: FLYING_MENACE, controller: 0 },
        { card: RELUCTANT_BLOCKER, controller: 1 },
        { card: RED_FLYER_ONE, controller: 1 },
        { card: RED_FLYER_TWO, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const protectedAttacker = oidOf(start.state, PROTECTED.name);
    const menace = oidOf(start.state, FLYING_MENACE.name);
    const reluctant = oidOf(start.state, RELUCTANT_BLOCKER.name);
    const helperOne = oidOf(start.state, RED_FLYER_ONE.name);
    const helperTwo = oidOf(start.state, RED_FLYER_TWO.name);
    const imposed = withRules(start.state, rule('blocksThisTurnIfAble', reluctant, reluctant));
    const blocking = toDeclareBlockers(imposed, [protectedAttacker, menace]);

    expect(validateBlocks(blocking, [])).not.toBeNull();
    expect(
      validateBlocks(blocking, [
        { blocker: reluctant, attacker: protectedAttacker },
        { blocker: helperOne, attacker: menace },
        { blocker: helperTwo, attacker: menace },
      ]),
    ).toBeNull();
  });

  it('lets a restriction defeat the requirement on the same creature', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, BEAR.name);
    const blocker = oidOf(start.state, OGRE.name);
    const imposed = withRules(
      start.state,
      rule('blocksThisTurnIfAble', blocker, blocker),
      rule('cantBlockThisTurn', blocker, blocker),
    );
    const blocking = toDeclareBlockers(imposed, [attacker]);
    expect(canBlock(blocking, blocker, attacker)).toBe(false);
    expect(pendingDecision(blocking)?.kind).not.toBe('declareBlockers');
  });
});
