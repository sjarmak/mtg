/**
 * The bot has to want to pay for an activated ability.
 *
 * `bot-triggers.test.ts` made this argument for slice B and it is the same
 * argument one slice on: risk 3 of `docs/design/dsl-v1-ability-model.md` is a
 * balance gate that plays 10,035 seeded games, reports healthy win-rate bands,
 * and never once had a bot use the set's mechanic.
 *
 * For an activation the failure mode is quieter than it was for a trigger. A
 * trigger fires whether or not the bot understands it. An activation is an
 * enumerated action nothing is obliged to take, so a policy that scores it at
 * zero leaves the option sitting in `decision.options` every window of every
 * turn of every game and the mechanic is never played once. Nothing goes red:
 * the kernel is correct, the enumeration is correct, and the format is
 * unplayed.
 *
 * The assertions are `bot-statics`': not "the number is bigger" but "the action
 * the bot submits is the activation", taken from a real `pendingDecision` and
 * re-checked with `validateAction`.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, PlayerId } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import type { GreedyBotConfig } from '@mtg/sim';
import {
  chooseActivation,
  decideGreedy,
  DEFAULT_GREEDY_CONFIG,
  greedyConfig,
  printedCardValue,
} from '@mtg/sim';
import { creature, MOUNTAIN, PLAINS } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

/** `{1}, {T}: CARDNAME deals 1 damage to any target.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

/** `{4}: You gain 2 life.` The cheapest payload in the DSL behind four mana. */
const DEAR_LIFE: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 4 }, tapSelf: false },
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

let collector = 700;

function artifact(name: string, abilities: readonly AbilityInput[]): Card {
  collector += 1;
  return parseCard({
    kind: 'artifact',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { generic: 2 },
    abilities: [...abilities],
  });
}

const BEACON = artifact('Ashen Beacon', [PING]);
const GILDED_FONT = artifact('Gilded Font', [DEAR_LIFE]);
const BRIGAND = creature('Brigand Scout', 1, 1, [], { generic: 1, R: 1 }, ['R']);

/** `{T}: You gain 2 life.` on a 2/2 for `1W`, so the body is the control. */
const TAP_FOR_LIFE: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

function warden(name: string): Card {
  collector += 1;
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    abilities: [TAP_FOR_LIFE],
  });
}

const WARDEN = warden('Spring Warden');
const VANILLA = creature('Plain Body', 2, 2, [], { generic: 1, W: 1 }, ['W']);

/** The warden's body and payload behind a mana cost, so only the cost differs. */
function pricedWarden(name: string, generic: number): Card {
  collector += 1;
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic }, tapSelf: true },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

const PRICED_WARDEN = pricedWarden('Toll Warden', 3);
const UNAFFORDABLE_WARDEN = pricedWarden('Vault Warden', 7);

/** The bot that reads a printed activation as text it cannot use. */
const BLIND = { ...config.cast, activationValue: 0, activationCostWeight: 0 };

function mountains(count: number): { card: Card; controller: PlayerId }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as PlayerId }));
}

function decide(state: GameState, profile: GreedyBotConfig = config): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = decideGreedy({ state, player: 0, decision }, profile);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

function activationFor(state: GameState, profile: GreedyBotConfig): Action | null {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  return chooseActivation({ state, player: 0, decision }, profile);
}

describe('a permanent with a printed activated ability', () => {
  /**
   * The risk-3 assertion. An empty hand, two untapped Mountains and a beacon
   * that says something: a policy that cannot read the ability passes priority
   * here, and passes it in all 10,035 games.
   */
  it('is the action the bot submits when it has the mana and nothing better to do', () => {
    const start = scenario({
      seed: 'sim/activate/ping',
      battlefield: [...mountains(2), { card: BEACON, controller: 0 }, { card: BRIGAND, controller: 1 }],
      hands: [[], []],
    });
    const action = decide(start.state);
    expect(action.type).toBe('activateAbility');
    if (action.type !== 'activateAbility') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Ashen Beacon');
    expect(action.abilityIndex).toBe(0);
  });

  /**
   * The ability's targets go through `scoreEffectTargets`, which is the same
   * switch a spell's targets go through. A bot that took the first enumerated
   * tuple would point one damage at a player on 20 while a 1/1 it kills stands
   * on the other side of the board.
   */
  it('aims it at the target the shared target policy scores highest', () => {
    const start = scenario({
      seed: 'sim/activate/aim',
      battlefield: [...mountains(2), { card: BEACON, controller: 0 }, { card: BRIGAND, controller: 1 }],
      hands: [[], []],
    });
    const action = decide(start.state);
    if (action.type !== 'activateAbility') throw new Error(`expected an activation, got ${action.type}`);
    const target = action.targets[0];
    expect(target?.kind).toBe('permanent');
    if (target?.kind !== 'permanent') return;
    expect(start.state.objects[target.oid]?.card.name).toBe('Brigand Scout');
  });

  /**
   * `minimumValue` is a floor on value, and a floor nothing is measured against
   * is a number anybody may retune in any direction. Raised past what one
   * damage is worth, the same board produces the pass the unread ability
   * produced.
   */
  it('is left alone when its value does not clear the policy floor', () => {
    const start = scenario({
      seed: 'sim/activate/floor',
      battlefield: [...mountains(2), { card: BEACON, controller: 0 }, { card: BRIGAND, controller: 1 }],
      hands: [[], []],
    });
    const timid = greedyConfig({ activate: { minimumValue: 100 } });
    expect(activationFor(start.state, timid)).toBeNull();
    expect(decide(start.state, timid).type).toBe('passPriority');
  });

  /**
   * `manaValueWeight` is the other half of the same decision, and this is the
   * board where it decides alone: two life is worth 0.8 to the target policy
   * whatever it costs, so the only thing that can decline four mana for it is
   * the cost term.
   */
  it('declines a payload its mana cost outruns, and pays when the cost weight is zero', () => {
    const start = scenario({
      seed: 'sim/activate/cost',
      battlefield: [...mountains(5), { card: GILDED_FONT, controller: 0 }],
      hands: [[], []],
    });
    expect(activationFor(start.state, config)).toBeNull();
    expect(decide(start.state).type).toBe('passPriority');

    const spendthrift = greedyConfig({ activate: { manaValueWeight: 0 } });
    const action = decide(start.state, spendthrift);
    expect(action.type).toBe('activateAbility');
    if (action.type !== 'activateAbility') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Gilded Font');
  });

  it('is not invented on a board that has none', () => {
    const start = scenario({
      seed: 'sim/activate/none',
      battlefield: [...mountains(2), { card: BRIGAND, controller: 1 }],
      hands: [[], []],
    });
    expect(activationFor(start.state, config)).toBeNull();
  });
});

/**
 * The card-in-hand half of the same risk. `printedCardValue` is what decides
 * which of two castable cards the bot spends its mana on, and it reads the
 * printed ability rather than the payload: a bot that valued an activation at
 * nothing would pick by whatever pool order happened to be there and put the
 * mechanic on the board by accident or not at all.
 */
describe('the same ability on a card in hand', () => {
  it('is worth more than the identical vanilla body', () => {
    expect(printedCardValue(config.cast, WARDEN)).toBeGreaterThan(printedCardValue(config.cast, VANILLA));
  });

  it('is worth exactly the vanilla body to a bot whose activation values are zero', () => {
    expect(printedCardValue(BLIND, WARDEN)).toBe(printedCardValue(BLIND, VANILLA));
  });

  /**
   * `activationCostWeight` was documented and read by nothing: collapsing the
   * arm to a flat `config.activationValue` left the whole suite green, so the
   * config field existed, was tuned, and changed no decision. These three cards
   * share a body and a payload and differ only in what activating costs.
   */
  it('is worth less the more the activation costs', () => {
    const free = printedCardValue(config.cast, WARDEN);
    const priced = printedCardValue(config.cast, PRICED_WARDEN);
    expect(priced).toBeLessThan(free);
    expect(free - priced).toBeCloseTo(config.cast.activationCostWeight * 3, 10);
  });

  it('floors at the vanilla body once the cost outruns the flat value', () => {
    // 7 mana at the default weight is a bigger discount than the whole flat
    // figure, and a printed ability must never make a card worth less than the
    // same card without it.
    expect(config.cast.activationValue - config.cast.activationCostWeight * 7).toBeLessThan(0);
    expect(printedCardValue(config.cast, UNAFFORDABLE_WARDEN)).toBe(printedCardValue(config.cast, VANILLA));
  });

  it('is the card the bot casts when it can afford only one of the two', () => {
    const start = scenario({
      seed: 'sim/activate/choice',
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[VANILLA, WARDEN], []],
    });
    const action = decide(start.state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Spring Warden');
  });
});
