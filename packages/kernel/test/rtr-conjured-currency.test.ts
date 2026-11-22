/** Native source-and-target exchange probes for RTR #35. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  advanceToStep,
  beginTrace,
  controllerOf,
  eventsOfType,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { artifact, ISLAND } from './cards';
import { apply, oidOf } from './helpers';

const CURRENCY = parseCard({
  kind: 'enchantment',
  id: 'rtr-33-conjured-currency-kernel',
  name: 'Conjured Currency',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 33 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      optional: true,
      effects: [
        {
          kind: 'exchangeControl',
          exchangeSource: true,
          target: { kind: 'targetPermanentYouNeitherOwnNorControl' },
        },
      ],
    },
  ],
});

function upkeep(): ReduceResult {
  const start = scenario({
    active: 1,
    battlefield: [
      { card: CURRENCY, controller: 0 },
      { card: artifact('Opposing Relic'), controller: 1 },
      { card: ISLAND, controller: 1 },
      { card: artifact('Controlled Relic'), controller: 0 },
      { card: artifact('Owned but Stolen Relic'), controller: 1 },
    ],
  });
  const stolen = oidOf(start.state, 'Owned but Stolen Relic');
  const withOwner = {
    ...start.state,
    objects: { ...start.state.objects, [stolen]: { ...start.state.objects[stolen]!, owner: 0 as const } },
  };
  return advanceToStep({ state: withOwner, events: start.events }, 'upkeep');
}

function aim(from: ReduceResult, name = 'Opposing Relic'): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Currency target was not requested');
  return apply(from, {
    type: 'chooseTriggerTargets',
    player: decision.player,
    oid: decision.oid,
    targets: [{ kind: 'permanent', oid: oidOf(from.state, name) }],
  });
}

function passToOptional(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Currency never reached its optional resolution');
}

function answer(from: ReduceResult, accept: boolean): ReduceResult {
  const offered = passToOptional(from);
  const decision = pendingDecision(offered.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('Currency optional was not offered');
  return apply(offered, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

describe('Conjured Currency targets', () => {
  it('offers permanents the chooser neither owns nor controls, including lands', () => {
    const started = upkeep();
    const decision = pendingDecision(started.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Currency target was not requested');
    const names = decision.options.map((action) =>
      action.type === 'chooseTriggerTargets' && action.targets[0]?.kind === 'permanent'
        ? started.state.objects[action.targets[0].oid]?.card.name
        : undefined,
    );
    expect(names).toEqual(['Opposing Relic', 'Island']);
  });
});

describe('Conjured Currency resolution', () => {
  it('exchanges the current controllers of its source and chosen target', () => {
    const started = upkeep();
    const source = oidOf(started.state, CURRENCY.name);
    const target = oidOf(started.state, 'Opposing Relic');
    const done = answer(aim(started), true);
    expect(controllerOf(done.state, source)).toBe(1);
    expect(controllerOf(done.state, target)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toHaveLength(2);
  });

  it('chooses its target before its controller may decline the exchange', () => {
    const started = upkeep();
    const source = oidOf(started.state, CURRENCY.name);
    const target = oidOf(started.state, 'Opposing Relic');
    const done = answer(aim(started), false);
    expect(controllerOf(done.state, source)).toBe(0);
    expect(controllerOf(done.state, target)).toBe(1);
    expect(eventsOfType(done.events, 'triggerDeclined')).toHaveLength(1);
  });

  it('does nothing when the source permanent leaves before resolution', () => {
    const aimed = aim(upkeep());
    const source = oidOf(aimed.state, CURRENCY.name);
    const target = oidOf(aimed.state, 'Opposing Relic');
    const departed = moveObject(beginTrace(aimed.state), source, 'graveyard');
    const done = answer({ state: departed.state, events: [...aimed.events, ...departed.events] }, true);
    expect(controllerOf(done.state, target)).toBe(1);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
  });

  it('does not follow a blinked target into its new incarnation', () => {
    const aimed = aim(upkeep());
    const source = oidOf(aimed.state, CURRENCY.name);
    const target = oidOf(aimed.state, 'Opposing Relic');
    const gone = moveObject(beginTrace(aimed.state), target, 'graveyard');
    const returned = moveObject(gone, target, 'battlefield', { controller: 1 });
    let current: ReduceResult = { state: returned.state, events: [...aimed.events, ...returned.events] };
    for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'priority') break;
      current = reduce(current.state, { type: 'passPriority', player: decision.player });
    }
    expect(controllerOf(current.state, source)).toBe(0);
    expect(controllerOf(current.state, target)).toBe(1);
    expect(eventsOfType(current.events, 'controlEffectAdded')).toEqual([]);
  });
});
