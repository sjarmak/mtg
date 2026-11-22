/** Native optional targeting, temporary grants, and live token counts for M13 Ajani. */
import { describe, expect, it } from 'vitest';
import { parseCard, type AbilityInput, type Card } from '@mtg/dsl';
import {
  beginTrace,
  cleanupTurnEffects,
  counterCount,
  eventsOfType,
  hasKeyword,
  hasKeywordAbility,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  setLife,
  validateAction,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { apply, oidOf } from './helpers';

const CAT = {
  name: 'Cat',
  power: 2,
  toughness: 2,
  colors: ['W' as const],
  subtypes: ['Cat'],
  keywords: [],
};

const ABILITIES: readonly AbilityInput[] = [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 1,
    effects: [
      {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: 1,
        target: { kind: 'targetCreature', count: 1 },
      },
    ],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -3,
    effects: [
      {
        kind: 'grantKeywordUntilEndOfTurn',
        keyword: 'flying',
        additionalKeywords: ['doubleStrike'],
        target: { kind: 'targetCreature' },
      },
    ],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -8,
    effects: [{ kind: 'createToken', count: { kind: 'controllerLifeTotal' }, token: CAT }],
  },
];

const PLATINUM_ANGEL = parseCard({
  kind: 'creature',
  id: 'm13-ajani-probe-platinum-angel',
  name: 'Ajani Caller Probe Platinum Angel',
  rarity: 'mythic',
  set: { code: 'PRB', collectorNumber: 1 },
  colors: [],
  manaCost: { generic: 7 },
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});

function ajani(): Card {
  return planeswalker('Ajani, Caller of the Pride', 4, ABILITIES, { generic: 1, W: 2 });
}

function board(life = 20, loyalty = 8): ReduceResult {
  return scenario({
    life: [life, 20],
    battlefield: [
      { card: ajani(), controller: 0, loyalty },
      { card: PLATINUM_ANGEL, controller: 0 },
    ],
  });
}

function resolve(start: ReduceResult): ReduceResult {
  return apply(apply(start, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

function beginAbility(start: ReduceResult, abilityIndex: number): ReduceResult {
  const source = oidOf(start.state, 'Ajani, Caller of the Pride');
  const action = legalActions(start.state).find(
    (option) =>
      option.type === 'activateAbility' && option.oid === source && option.abilityIndex === abilityIndex,
  );
  if (action === undefined) throw new Error(`Ajani ability ${String(abilityIndex)} was not offered`);
  return reduce(start.state, action);
}

function finishOptionalTarget(start: ReduceResult, target?: string): ReduceResult {
  let current = start;
  if (target !== undefined) {
    const choose = pendingDecision(current.state)?.options.find(
      (option) =>
        option.type === 'choosePluralTarget' &&
        option.target?.kind === 'permanent' &&
        option.target.oid === target,
    );
    if (choose === undefined) throw new Error('optional creature target was not offered');
    current = reduce(current.state, choose);
  }
  if (current.state.pendingPluralTargets === undefined) return current;
  const finish = pendingDecision(current.state)?.options.find(
    (option) => option.type === 'choosePluralTarget' && option.target === null,
  );
  if (finish === undefined) throw new Error('optional target selection could not finish');
  return reduce(current.state, finish);
}

function cats(result: ReduceResult): number {
  return result.state.battlefield.filter((oid) => result.state.objects[oid]?.card.name === 'Cat').length;
}

describe('Ajani, Caller of the Pride', () => {
  it('chooses zero or one +1 target, never two, and a legal zero choice does not fizzle', () => {
    const ally = creature('Ajani Optional Ally', 2, 2);
    const rival = creature('Ajani Optional Rival', 2, 2);
    const start = scenario({
      battlefield: [
        { card: ajani(), controller: 0 },
        { card: ally, controller: 0 },
        { card: rival, controller: 1 },
      ],
    });
    const source = oidOf(start.state, 'Ajani, Caller of the Pride');
    const allyOid = oidOf(start.state, ally.name);
    const rivalOid = oidOf(start.state, rival.name);

    const noTarget = resolve(finishOptionalTarget(beginAbility(start, 0)));
    expect(counterCount(noTarget.state.objects[allyOid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(eventsOfType(noTarget.events, 'effectSkipped')).toEqual([]);

    const chosenStart = scenario({
      battlefield: [
        { card: ajani(), controller: 0 },
        { card: ally, controller: 0 },
        { card: rival, controller: 1 },
      ],
    });
    const chosenAlly = oidOf(chosenStart.state, ally.name);
    const chosen = resolve(finishOptionalTarget(beginAbility(chosenStart, 0), chosenAlly));
    expect(counterCount(chosen.state.objects[chosenAlly]!.counters, 'plusOnePlusOne')).toBe(1);

    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: source,
        abilityIndex: 0,
        targets: [null],
        sacrifices: [],
        multiTargets: {
          0: [
            { kind: 'permanent', oid: allyOid },
            { kind: 'permanent', oid: rivalOid },
          ],
        },
      } as Action),
    ).not.toBeNull();
  });

  it('does not let an optional target follow a permanent through a zone change', () => {
    const ally = creature('Ajani Incarnation Ally', 2, 2);
    const start = scenario({
      battlefield: [
        { card: ajani(), controller: 0 },
        { card: ally, controller: 0 },
      ],
    });
    const allyOid = oidOf(start.state, ally.name);
    const activated = finishOptionalTarget(beginAbility(start, 0), allyOid);
    const left = moveObject(beginTrace(activated.state), allyOid, 'hand');
    const returned = moveObject(left, allyOid, 'battlefield', { controller: 0 });
    const done = resolve({ state: returned.state, events: activated.events });
    expect(counterCount(done.state.objects[allyOid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(eventsOfType(done.events, 'effectSkipped')).toEqual([
      expect.objectContaining({ why: 'all chosen targets are no longer legal' }),
    ]);
  });

  it('grants flying and double strike to one creature until cleanup', () => {
    const ally = creature('Ajani Flying Ally', 2, 2);
    const start = scenario({
      battlefield: [
        { card: ajani(), controller: 0, loyalty: 4 },
        { card: ally, controller: 0 },
      ],
    });
    const allyOid = oidOf(start.state, ally.name);
    const source = oidOf(start.state, 'Ajani, Caller of the Pride');
    const activation = legalActions(start.state).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === source &&
        action.abilityIndex === 1 &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === allyOid,
    );
    if (activation === undefined) throw new Error('Ajani -3 was not offered');
    const done = resolve(reduce(start.state, activation));
    expect(hasKeyword(done.state, allyOid, 'flying')).toBe(true);
    expect(hasKeywordAbility(done.state, allyOid, 'doubleStrike')).toBe(true);
    const cleaned = cleanupTurnEffects(beginTrace(done.state)).state;
    expect(hasKeyword(cleaned, allyOid, 'flying')).toBe(false);
    expect(hasKeywordAbility(cleaned, allyOid, 'doubleStrike')).toBe(false);
  });

  it.each([
    { lifeAtResolution: 7, expected: 7 },
    { lifeAtResolution: 1, expected: 1 },
    { lifeAtResolution: 0, expected: 0 },
  ])('creates $expected Cats from life read at resolution', ({ lifeAtResolution, expected }) => {
    const activated = beginAbility(board(12), 2);
    const changed = setLife(beginTrace(activated.state), 0, lifeAtResolution);
    const done = resolve({ state: changed.state, events: activated.events });
    expect(cats(done)).toBe(expected);
  });
});
