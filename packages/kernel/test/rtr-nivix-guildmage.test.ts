/** Exact target ownership and resolution order for RTR Nivix Guildmage. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { counterStackEntry } from '../src/counter';
import { instant, ISLAND, lands, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const NIVIX = parseCard({
  kind: 'creature',
  id: 'rtr-182-nivix-guildmage-kernel',
  name: 'Nivix Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 182 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, U: 1, R: 1 } },
      effects: [
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1, R: 1 } },
      effects: [
        {
          kind: 'copySpell',
          spellFilter: { cardTypes: ['instant', 'sorcery'] },
          spellSelection: 'targetSpellYouControl',
        },
      ],
    },
  ],
} as CardInput);

const HELD = instant('Nivix Held Card', [{ kind: 'scry', count: 1 }], {});
const DRAWN = instant('Nivix Drawn Card', [{ kind: 'scry', count: 1 }], {});
const OWN_SPARK = instant(
  'Nivix Own Spark',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
  {},
);
const OPPOSING_SPARK = instant(
  'Nivix Opposing Spark',
  [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
  {},
);

function pass(from: ReduceResult): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'priority')
    throw new Error(`priority unavailable at ${decision?.kind ?? 'nothing'}`);
  return apply(from, { type: 'passPriority', player: decision.player });
}

function resolveTop(from: ReduceResult): ReduceResult {
  return pass(pass(from));
}

function activation(
  state: GameState,
  abilityIndex: number,
  targetSpell?: string,
): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === oidOf(state, NIVIX.name) &&
      action.abilityIndex === abilityIndex &&
      (targetSpell === undefined ||
        (action.targets[0]?.kind === 'spell' && action.targets[0].oid === targetSpell)),
  );
  if (found === undefined) throw new Error(`Nivix ability ${String(abilityIndex)} was not offered`);
  return found;
}

function stackedSparks(): {
  readonly current: ReduceResult;
  readonly own: string;
  readonly opposing: string;
} {
  const start = scenario({
    active: 1,
    battlefield: [
      { card: NIVIX, controller: 0 },
      ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
      ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[OWN_SPARK], [OPPOSING_SPARK]],
  });
  const opposing = handOidOf(start.state, 1, OPPOSING_SPARK.name);
  let current = apply(start, {
    type: 'castSpell',
    player: 1,
    oid: opposing,
    targets: [{ kind: 'player', player: 0 }],
  });
  current = pass(current);
  const own = handOidOf(current.state, 0, OWN_SPARK.name);
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: own,
    targets: [{ kind: 'player', player: 0 }],
  });
  return { current, own, opposing };
}

describe('Nivix Guildmage in the kernel', () => {
  it('draws before asking which card its controller discards', () => {
    const start = scenario({
      battlefield: [
        { card: NIVIX, controller: 0 },
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[HELD], []],
      libraries: [[DRAWN], []],
    });
    const held = handOidOf(start.state, 0, HELD.name);
    let current = apply(start, activation(start.state, 0));
    current = resolveTop(current);
    expect(pendingDecision(current.state)).toMatchObject({ kind: 'handDiscard', player: 0, count: 1 });
    expect(current.state.players[0].hand.map((oid) => current.state.objects[oid]?.card.name)).toEqual([
      HELD.name,
      DRAWN.name,
    ]);
    current = apply(current, { type: 'chooseDiscards', player: 0, oids: [held] });
    expect(current.state.players[0].hand.map((oid) => current.state.objects[oid]?.card.name)).toEqual([
      DRAWN.name,
    ]);
    expect(eventsOfType(current.events, 'cardDrawn')).toHaveLength(1);
    expect(eventsOfType(current.events, 'cardsDiscarded')).toHaveLength(1);
  });

  it('offers only its activator own instant or sorcery and can retarget the copy', () => {
    const { current: stacked, own, opposing } = stackedSparks();
    const offeredTargets = legalActions(stacked.state)
      .filter(
        (action): action is Extract<Action, { type: 'activateAbility' }> =>
          action.type === 'activateAbility' && action.abilityIndex === 1,
      )
      .map((action) => action.targets[0]);
    expect(offeredTargets).toContainEqual({ kind: 'spell', oid: own });
    expect(offeredTargets).not.toContainEqual({ kind: 'spell', oid: opposing });

    let current = apply(stacked, activation(stacked.state, 1, own));
    current = resolveTop(current);
    const targets = pendingDecision(current.state);
    if (targets?.kind !== 'spellTargets') throw new Error('the copied spell did not offer new targets');
    const atOpponent = targets.options.find(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        action.targets[0]?.kind === 'player' &&
        action.targets[0].player === 1,
    );
    if (atOpponent === undefined) throw new Error('the copied spell could not be retargeted');
    current = apply(current, atOpponent);
    expect(current.state.stack.at(-1)).toMatchObject({
      controller: 0,
      targets: [{ kind: 'player', player: 1 }],
      copiedSpell: { copiedFrom: own },
    });
  });

  it('rechecks ownership and makes no copy after its target leaves the stack', () => {
    const { current: stacked, own } = stackedSparks();
    const activated = apply(stacked, activation(stacked.state, 1, own));
    const removed = counterStackEntry(beginTrace(activated.state), own, 'hostile-target-removal');
    const resolved = resolveTop({ state: removed.state, events: [...activated.events, ...removed.events] });
    expect(eventsOfType(resolved.events, 'spellCopied')).toEqual([]);
    expect(resolved.state.stack.some((entry) => entry.copiedSpell !== undefined)).toBe(false);
  });
});
