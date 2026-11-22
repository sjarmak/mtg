/** Shared player-target legality through Leyline of Sanctity's live hexproof. */
import { parseCard, type Card, type Effect } from '@mtg/dsl';
import {
  beginTrace,
  canPlayerBeTargetedBy,
  eventsOfType,
  legalActions,
  moveObject,
  onlyObject,
  pendingDecision,
  reduce,
  resolveTop,
  scenario,
  targetChoicesForEffects,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, withContinuous } from './continuous-helpers';
import { creature, instant, ISLAND } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-21-leyline-of-sanctity-kernel',
  name: 'Leyline of Sanctity',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 21 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  openingHandAction: { kind: 'beginOnBattlefield' },
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
});

const DRAIN = instant(
  'Player Hexproof Drain',
  [{ kind: 'loseLife', amount: 3, target: { kind: 'targetPlayer' } }],
  { U: 1 },
);

const ANY_HIT = instant(
  'Player Hexproof Any Hit',
  [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
  { U: 1 },
);

const FEAST = instant(
  'Player Hexproof Feast',
  [
    {
      kind: 'gainLife',
      amount: 2,
      target: { kind: 'targetPlayer', anyNumber: true },
    } as unknown as Effect,
  ],
  { U: 1 },
);

const ACTIVATOR = creature('Player Hexproof Activator', 1, 1, {
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, tapSelf: true },
      effects: [{ kind: 'loseLife', amount: 1, target: { kind: 'targetPlayer' } }],
    },
  ],
});

const ENTERS_TRIGGER = creature('Player Hexproof Trigger', 1, 1, {
  cost: { U: 1 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'loseLife', amount: 1, target: { kind: 'targetPlayer' } }],
    },
  ],
});

const BLANK = parseCard({
  kind: 'enchantment',
  id: 'player-hexproof-blank',
  name: 'Player Hexproof Blank',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 204 },
  manaCost: { generic: 1 },
  colors: [],
});

const TARGET_PLAYER: Effect = {
  kind: 'loseLife',
  amount: 1,
  target: { kind: 'targetPlayer' },
};

const TARGET_OPPONENT: Effect = {
  kind: 'loseLife',
  amount: 1,
  target: { kind: 'targetOpponent' },
};

const ANY_TARGET: Effect = {
  kind: 'dealDamage',
  amount: 1,
  target: { kind: 'anyTarget' },
};

function playerTargets(targets: readonly (Target | null)[]): readonly number[] {
  return targets.flatMap((target) => (target?.kind === 'player' ? [target.player] : []));
}

function leylineBoard(extra: readonly { readonly card: Card; readonly controller: 0 | 1 }[] = []) {
  return scenario({
    active: 1,
    battlefield: [{ card: LEYLINE, controller: 0 }, ...extra],
  });
}

function passUntilQuestion(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 16; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision === null || decision.kind !== 'priority') return walked;
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('player hexproof probe did not reach its next decision');
}

function spellActions(state: GameState, oid: ObjectId): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === oid,
  );
}

describe('player hexproof target spaces', () => {
  it('filters singular opponent, general player, and mixed any-target spaces at one boundary', () => {
    const start = leylineBoard([{ card: ACTIVATOR, controller: 1 }]);
    const source = oidOf(start.state, ACTIVATOR.name);

    expect(playerTargets(targetChoicesForEffects(start.state, [TARGET_PLAYER], 1, source)[0] ?? [])).toEqual([
      1,
    ]);
    expect(targetChoicesForEffects(start.state, [TARGET_OPPONENT], 1, source)[0]).toEqual([]);
    const anyTargets = targetChoicesForEffects(start.state, [ANY_TARGET], 1, source)[0] ?? [];
    expect(playerTargets(anyTargets)).toEqual([1]);
    expect(anyTargets.some((target) => target?.kind === 'permanent')).toBe(true);
  });

  it('rejects a hostile singular cast and offers the caster as the only player target', () => {
    const start = scenario({
      active: 1,
      battlefield: [
        { card: LEYLINE, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[], [DRAIN]],
    });
    const spell = handOidOf(start.state, 1, DRAIN.name);
    const options = spellActions(start.state, spell);

    expect(options.map((action) => action.targets[0])).toEqual([{ kind: 'player', player: 1 }]);
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 1,
        oid: spell,
        targets: [{ kind: 'player', player: 0 }],
      }),
    ).toContain('illegal target');
  });

  it('filters plural player candidates and rejects a hostile submitted member', () => {
    const start = scenario({
      active: 1,
      battlefield: [
        { card: LEYLINE, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[], [FEAST]],
    });
    const spell = handOidOf(start.state, 1, FEAST.name);
    const begin = legalActions(start.state).find(
      (action) => action.type === 'beginCastSpell' && action.oid === spell,
    );
    if (begin?.type !== 'beginCastSpell') throw new Error('plural spell was not offered');
    const decision = pendingDecision(reduce(start.state, begin).state);
    if (decision?.kind !== 'pluralTargets') throw new Error('plural player targets were not staged');
    const choices = decision.options
      .flatMap((action) =>
        action.type === 'choosePluralTarget'
          ? [action.target === null ? '' : playerTargets([action.target]).join(',')]
          : [],
      )
      .sort();

    expect(choices).toEqual(['', '1']);
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 1,
        oid: spell,
        targets: [null],
        multiTargets: { 0: [{ kind: 'player', player: 0 }] },
      }),
    ).not.toBeNull();
  });
});

describe('player hexproof across every ability source', () => {
  it('filters activated-ability options and rejects a hostile activation payload', () => {
    const start = leylineBoard([
      { card: ACTIVATOR, controller: 1 },
      { card: ISLAND, controller: 1 },
    ]);
    const source = oidOf(start.state, ACTIVATOR.name);
    const options = legalActions(start.state).filter(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' && action.oid === source,
    );

    expect(options.map((action) => action.targets[0])).toEqual([{ kind: 'player', player: 1 }]);
    const offered = options[0];
    if (offered === undefined) throw new Error('player hexproof probe found no activation');
    expect(
      validateAction(start.state, {
        ...offered,
        targets: [{ kind: 'player', player: 0 }],
      }),
    ).toContain('illegal target');
  });

  it('filters triggered-ability options and rejects a hostile trigger answer', () => {
    const start = scenario({
      active: 1,
      battlefield: [
        { card: LEYLINE, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[], [ENTERS_TRIGGER]],
    });
    const source = handOidOf(start.state, 1, ENTERS_TRIGGER.name);
    const cast = spellActions(start.state, source)[0];
    if (cast === undefined) throw new Error('player hexproof probe could not cast its trigger source');
    const asked = passUntilQuestion(apply(start, cast));
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('player hexproof probe lost trigger targets');

    const options = decision.options.filter(
      (option): option is Extract<Action, { type: 'chooseTriggerTargets' }> =>
        option.type === 'chooseTriggerTargets',
    );
    expect(options.map((option) => option.targets[0])).toEqual([{ kind: 'player', player: 1 }]);
    expect(
      validateAction(asked.state, {
        type: 'chooseTriggerTargets',
        player: 1,
        oid: decision.oid,
        targets: [{ kind: 'player', player: 0 }],
      }),
    ).toContain('illegal target');
  });
});

describe('player hexproof is live and layer-derived', () => {
  it('allows self-targeting and follows source control, copying, ability loss, and departure', () => {
    const start = leylineBoard([{ card: BLANK, controller: 1 }]);
    const leyline = oidOf(start.state, LEYLINE.name);
    const blank = oidOf(start.state, BLANK.name);

    expect(canPlayerBeTargetedBy(start.state, 0, 1)).toBe(false);
    expect(canPlayerBeTargetedBy(start.state, 0, 0)).toBe(true);

    const changed = withContinuous(start.state, [controlledBy(onlyObject(leyline), 1)]);
    expect(canPlayerBeTargetedBy(changed, 0, 1)).toBe(true);
    expect(canPlayerBeTargetedBy(changed, 1, 0)).toBe(false);

    const copied = withContinuous(start.state, [
      copies(onlyObject(blank), leyline),
      abilities(onlyObject(leyline), { removeAll: true }),
    ]);
    expect(canPlayerBeTargetedBy(copied, 0, 1)).toBe(true);
    expect(canPlayerBeTargetedBy(copied, 1, 0)).toBe(false);

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    expect(canPlayerBeTargetedBy(stripped, 1, 0)).toBe(true);

    const gone = moveObject(beginTrace(start.state), leyline, 'graveyard');
    expect(canPlayerBeTargetedBy(gone.state, 0, 1)).toBe(true);
  });

  it('rechecks at resolution when Leyline enters or leaves after targets were chosen', () => {
    const start = scenario({
      active: 1,
      battlefield: [{ card: ISLAND, controller: 1 }],
      hands: [[LEYLINE], [ANY_HIT]],
    });
    const leyline = handOidOf(start.state, 0, LEYLINE.name);
    const spell = handOidOf(start.state, 1, ANY_HIT.name);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 1,
      oid: spell,
      targets: [{ kind: 'player', player: 0 }],
    });
    const arrived = moveObject(beginTrace(cast.state), leyline, 'battlefield', { controller: 0 });

    const protectedResult = resolveTop(beginTrace(arrived.state));
    expect(protectedResult.state.players[0].life).toBe(20);
    expect(eventsOfType(protectedResult.events, 'spellFizzled')).toHaveLength(1);

    const gone = moveObject(arrived, leyline, 'graveyard');
    const unprotectedResult = resolveTop(beginTrace(gone.state));
    expect(unprotectedResult.state.players[0].life).toBe(17);
    expect(eventsOfType(unprotectedResult.events, 'spellFizzled')).toEqual([]);
  });

  it('removes only the newly hexproof player from a plural target slot at resolution', () => {
    const start = scenario({
      active: 1,
      battlefield: [{ card: ISLAND, controller: 1 }],
      hands: [[LEYLINE], [FEAST]],
    });
    const leyline = handOidOf(start.state, 0, LEYLINE.name);
    const spell = handOidOf(start.state, 1, FEAST.name);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 1,
      oid: spell,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'player', player: 0 },
          { kind: 'player', player: 1 },
        ],
      },
    });
    const arrived = moveObject(beginTrace(cast.state), leyline, 'battlefield', { controller: 0 });
    const result = resolveTop(beginTrace(arrived.state));

    expect(result.state.players[0].life).toBe(20);
    expect(result.state.players[1].life).toBe(22);
    expect(eventsOfType(result.events, 'spellFizzled')).toEqual([]);
  });
});
