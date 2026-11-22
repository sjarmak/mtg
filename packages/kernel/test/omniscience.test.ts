/** Native ordinary-priority free casting for M13 Omniscience. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  onlyObject,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, withContinuous } from './continuous-helpers';
import { creature, enchantment, instant, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const OMNISCIENCE = parseCard({
  kind: 'enchantment',
  id: 'm13-63-omniscience-kernel',
  name: 'Omniscience',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 63 },
  manaCost: { generic: 7, U: 3 },
  colors: ['U'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsFromHandWithoutPayingManaCost',
    },
  ],
} as CardInput);

const COLOSSUS = creature('Knowledge Colossus', 9, 9, { cost: { generic: 12 } });
const RIVAL_SPELL = instant(
  'Rival Insight',
  [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
  { generic: 12 },
);
const SORCERY = sorcery('Knowledge Study', [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }], {
  generic: 12,
});
const X_BURST = sorcery(
  'Knowledge Burst',
  [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
  { R: 1, hasX: true },
);
const OFFERING = parseCard({
  kind: 'instant',
  id: 'omniscience-additional-cost-probe',
  name: 'Knowledge Offering',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 63 },
  colors: ['B'],
  manaCost: { generic: 9, B: 1 },
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'drawCards',
      count: 2,
      target: { kind: 'noTarget' },
    },
  ],
} as unknown as CardInput);
const FODDER = creature('Knowledge Fodder', 2, 2);
const BLANK = enchantment('Knowledge Blank');

function castActions(state: GameState): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell',
  );
}

function start(
  hand = [COLOSSUS],
  battlefield: readonly { readonly card: ReturnType<typeof parseCard>; readonly controller: 0 | 1 }[] = [],
): ReduceResult {
  return scenario({
    seed: 'omniscience/kernel',
    active: 0,
    step: 'precombatMain',
    battlefield: [{ card: OMNISCIENCE, controller: 0 }, ...battlefield],
    hands: [hand, [RIVAL_SPELL]],
  });
}

function freeCastOf(state: GameState, name: string): Extract<Action, { type: 'castSpell' }> | undefined {
  const oid = handOidOf(state, 0, name);
  return castActions(state).find((action) => action.oid === oid && action.castingCost === 'withoutMana');
}

describe('Omniscience in the kernel', () => {
  it('offers an otherwise unaffordable spell through ordinary priority and retains priority after casting it', () => {
    const opened = start();
    const cast = freeCastOf(opened.state, COLOSSUS.name);
    expect(cast).toMatchObject({ player: 0, targets: [], castingCost: 'withoutMana' });
    if (cast === undefined) throw new Error('Omniscience did not offer the free cast');
    expect(opened.state.pendingFreeCast).toBeUndefined();
    expect(validateAction(opened.state, cast)).toBeNull();

    const casted = reduce(opened.state, cast);

    expect(casted.state.pendingFreeCast).toBeUndefined();
    expect(casted.state.stack.at(-1)).toMatchObject({ controller: 0, oid: cast.oid });
    expect(casted.state.turn).toMatchObject({ priority: 0, awaiting: null });
  });

  it('forces X to zero and preserves mandatory additional costs', () => {
    const noFodder = start([OFFERING]);
    expect(freeCastOf(noFodder.state, OFFERING.name)).toBeUndefined();

    const supplied = start([X_BURST, OFFERING], [{ card: FODDER, controller: 0 }]);
    const xCast = freeCastOf(supplied.state, X_BURST.name);
    expect(xCast?.x).toBe(0);
    if (xCast === undefined) throw new Error('Omniscience did not offer the X spell');
    expect(validateAction(supplied.state, { ...xCast, x: 1 })).toMatch(/X must be 0/u);

    const offering = freeCastOf(supplied.state, OFFERING.name);
    expect(offering?.sacrifices).toHaveLength(1);
    if (offering === undefined) throw new Error('Omniscience did not preserve the additional cost');
    const fodder = offering.sacrifices?.[0];
    if (fodder === undefined) throw new Error('the additional cost did not name its payment');
    const casted = reduce(supplied.state, offering);
    expect(casted.state.objects[fodder]?.zone).toBe('graveyard');
  });

  it('does not grant the opponent permission or override timing and absolute prohibitions', () => {
    const opened = start([SORCERY]);
    const opponentTurn = scenario({
      seed: 'omniscience/timing',
      active: 1,
      step: 'precombatMain',
      battlefield: [{ card: OMNISCIENCE, controller: 0 }],
      hands: [[SORCERY], [RIVAL_SPELL]],
    });
    const controllerPriority = apply(opponentTurn, { type: 'passPriority', player: 1 });
    expect(freeCastOf(controllerPriority.state, SORCERY.name)).toBeUndefined();
    expect(
      validateAction(controllerPriority.state, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(controllerPriority.state, 0, SORCERY.name),
        targets: [null],
        castingCost: 'withoutMana',
      }),
    ).toContain('wrong timing');

    const opponentPriority = apply(opened, { type: 'passPriority', player: 0 });
    const rivalOid = handOidOf(opponentPriority.state, 1, RIVAL_SPELL.name);
    expect(castActions(opponentPriority.state).some((action) => action.oid === rivalOid)).toBe(false);
    expect(
      validateAction(opponentPriority.state, {
        type: 'castSpell',
        player: 1,
        oid: rivalOid,
        targets: [null],
        castingCost: 'withoutMana',
      }),
    ).toMatch(/without paying|permission/u);

    const source = oidOf(opened.state, OMNISCIENCE.name);
    const prohibited: GameState = {
      ...opened.state,
      turnPlayerRules: [{ rule: 'cantCastSpells', sourceOid: source, player: 0 }],
    };
    expect(freeCastOf(prohibited, SORCERY.name)).toBeUndefined();
    expect(
      validateAction(prohibited, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(prohibited, 0, SORCERY.name),
        targets: [null],
        castingCost: 'withoutMana',
      }),
    ).toContain("can't cast spells");
  });

  it('cannot hijack an interrupted effect cast to cast a different permitted hand card', () => {
    const opened = start([COLOSSUS, SORCERY]);
    const selected = handOidOf(opened.state, 0, COLOSSUS.name);
    const other = handOidOf(opened.state, 0, SORCERY.name);
    const source = oidOf(opened.state, OMNISCIENCE.name);
    const pending: GameState = {
      ...opened.state,
      turn: {
        ...opened.state.turn,
        priority: null,
        awaiting: 'freeCast',
        awaitingPlayer: 0,
      },
      pendingFreeCast: {
        player: 0,
        oid: selected,
        from: 'hand',
        sourceOid: source,
        controller: 0,
        remaining: [],
        x: null,
        objectToGraveyard: null,
        tally: { exiled: 0, exiledPermanents: 0, damage: 0, lifeLost: 0 },
        deferredTriggers: [],
      },
    };

    expect(pendingDecision(pending)).toMatchObject({ kind: 'freeCast', oid: selected });
    expect(
      validateAction(pending, {
        type: 'castSpell',
        player: 0,
        oid: other,
        targets: [null],
        castingCost: 'withoutMana',
      }),
    ).toContain('only spell this decision may cast');
  });

  it('follows current control, copying, ability loss, and source departure', () => {
    const opened = start([COLOSSUS], [{ card: BLANK, controller: 0 }]);
    const source = oidOf(opened.state, OMNISCIENCE.name);
    const blank = oidOf(opened.state, BLANK.name);
    expect(freeCastOf(opened.state, COLOSSUS.name)).toBeDefined();

    const stolen = withContinuous(opened.state, [controlledBy(onlyObject(source), 1)]);
    expect(freeCastOf(stolen, COLOSSUS.name)).toBeUndefined();
    const stolenControllerPriority = apply({ ...opened, state: stolen }, { type: 'passPriority', player: 0 });
    const rival = handOidOf(stolenControllerPriority.state, 1, RIVAL_SPELL.name);
    expect(
      castActions(stolenControllerPriority.state).some(
        (action) => action.oid === rival && action.castingCost === 'withoutMana',
      ),
    ).toBe(true);

    const copied = withContinuous(opened.state, [
      copies(onlyObject(blank), source),
      abilities(onlyObject(source), { removeAll: true }),
    ]);
    expect(freeCastOf(copied, COLOSSUS.name)).toBeDefined();

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    expect(freeCastOf(stripped, COLOSSUS.name)).toBeUndefined();

    const gone = moveObject(beginTrace(opened.state), source, 'graveyard');
    expect(freeCastOf(gone.state, COLOSSUS.name)).toBeUndefined();
    const hostile = {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(gone.state, 0, COLOSSUS.name),
      targets: [],
      castingCost: 'withoutMana',
    } as const;
    expect(validateAction(gone.state, hostile)).toMatch(/without paying|permission/u);
  });
});
