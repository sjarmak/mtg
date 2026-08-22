/**
 * The bot has to want to cast a trigger.
 *
 * `bot-statics.test.ts` makes this argument for slice A and its opening
 * paragraph is the whole reason this file exists for slice B: `mtg-bc2.132`'s
 * risk 3 is a balance gate that plays 10,035 seeded games, reports healthy
 * win-rate bands, and never once had a bot use the set's mechanic, because the
 * cast policy scores a printed trigger exactly as it scores the vanilla body
 * under it. `config.ts` says so where `triggerValue` is declared: "a balance run
 * over a set whose mechanic never fires reports healthy numbers for a format
 * nobody played".
 *
 * `printedAbilityValue`'s triggered branch was the half nothing reached.
 * Deleting it, which is returning 0 for every condition, left `@mtg/sim`
 * green, which means the weight and the branch that reads it were both
 * decoration. The assertion that fixes that is `bot-statics`': not "the number
 * is bigger" but "the action the bot submits is the trigger card", taken from a
 * real `pendingDecision` and checked with `validateAction`.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, TriggerCondition } from '@mtg/dsl';
import { KEYWORDS, parseCard } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy, printedCardValue } from '@mtg/sim';
import { creature, PLAINS } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

function gainTwo(condition: TriggerCondition): AbilityInput {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** A 2/2 for `1W` whose only text is one trigger, so the body is the control. */
function herald(name: string, condition: TriggerCondition, collectorNumber: number): Card {
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    abilities: [gainTwo(condition)],
    power: 2,
    toughness: 2,
  };
  return parseCard(input);
}

const ON_ENTER = herald('Tide Herald', 'selfEnters', 620);
const ON_ATTACK = herald('Dawn Herald', 'selfAttacks', 621);
const ON_DEATH = herald('Dusk Herald', 'selfDies', 622);
const VANILLA = creature('Plain Body', 2, 2, [], { generic: 1, W: 1 }, ['W']);

/** Every condition worth nothing: the bot that reads a trigger as text it cannot use. */
const BLIND = {
  ...config.cast,
  triggerValue: {
    selfEnters: 0,
    selfAttacks: 0,
    selfDies: 0,
    selfDiesNotSacrificed: 0,
    controlledCreatureAttacksAlone: 0,
    selfDealsCombatDamageToCreature: 0,
    beginningOfYourUpkeep: 0,
    beginningOfYourEndStep: 0,
    anotherControlledPermanentEnters: 0,
    anotherControlledCreatureEnters: 0,
    youCastSpell: 0,
    youCastInstantOrSorcery: 0,
    selfDealsCombatDamageToPlayer: 0,
    selfBlocks: 0,
    selfBlocksOrIsBlockedByGreaterPower: 0,
    youGainLife: 0,
    selfEntersOrAttacks: 0,
    aPlayerCastsWhiteSpell: 0,
    aPlayerCastsBlueSpell: 0,
    aPlayerCastsBlackSpell: 0,
    aPlayerCastsRedSpell: 0,
    aPlayerCastsGreenSpell: 0,
    opponentDealtNoncombatDamage: 0,
    anotherControlledCreatureWithPowerThreeOrGreaterEnters: 0,
    beginningOfEndStep: 0,
  },
};

function decide(state: GameState, player: 0 | 1 = 0): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = decideGreedy({ state, player, decision }, config);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

describe('a creature with a printed trigger in hand', () => {
  it('is worth more than the identical vanilla body, whichever condition it carries', () => {
    const vanilla = printedCardValue(config.cast, VANILLA);
    for (const card of [ON_ENTER, ON_ATTACK, ON_DEATH]) {
      expect(printedCardValue(config.cast, card), card.name).toBeGreaterThan(vanilla);
    }
  });

  it('is worth exactly the vanilla body to a bot whose trigger values are zero', () => {
    const vanilla = printedCardValue(BLIND, VANILLA);
    for (const card of [ON_ENTER, ON_ATTACK, ON_DEATH]) {
      expect(printedCardValue(BLIND, card), card.name).toBe(vanilla);
    }
  });

  /**
   * The risk-3 assertion. Two 2/2s for `1W`, two Plains, and one of them says
   * something: a policy that cannot read the trigger picks by the pool order
   * that happens to be there, and the mechanic never reaches the board in
   * 10,035 games.
   */
  it('is the card the bot casts when it can afford only one of the two', () => {
    const start = scenario({
      seed: 'sim/trigger/choice',
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[VANILLA, ON_ENTER], []],
    });
    const action = decide(start.state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Tide Herald');
  });
});

/**
 * `DEFAULT_TRIGGER_VALUE`'s docblock states an order and says the order matters
 * more than the magnitudes: an attack trigger repeats, an enter trigger is
 * certain and immediate, a death trigger arrives late and on the opponent's
 * terms. An order argued in prose and asserted nowhere is three numbers anybody
 * may retune in any direction.
 */
describe('what each condition is worth', () => {
  it('ranks a repeating attack trigger over a certain enter trigger over a late death trigger', () => {
    const values = config.cast.triggerValue;
    expect(values.selfAttacks).toBeGreaterThan(values.selfEnters);
    expect(values.selfEnters).toBeGreaterThan(values.selfDies);
  });

  it('carries that ranking through to the card the bot is holding', () => {
    expect(printedCardValue(config.cast, ON_ATTACK)).toBeGreaterThan(printedCardValue(config.cast, ON_ENTER));
    expect(printedCardValue(config.cast, ON_ENTER)).toBeGreaterThan(printedCardValue(config.cast, ON_DEATH));
  });

  /**
   * The table has two ceilings, and the config's prose names both.
   *
   * `selfAttacks` is the most a condition that pays once is worth, and it is
   * what every keyword is priced against. `selfEntersOrAttacks` sits above it
   * because it is the only condition that pays twice from one card — the
   * arrival the moment the spell resolves, then every attack after it — so the
   * table's outright maximum is no longer the number the keyword partition is
   * read against. Asserting one of the two would let the other move silently.
   */
  it('prices the disjunctive condition above every condition that pays once', () => {
    const values = config.cast.triggerValue;
    const paysOnce = Object.entries(values).filter(([condition]) => condition !== 'selfEntersOrAttacks');
    expect(Math.max(...Object.values(values))).toBe(values.selfEntersOrAttacks);
    expect(Math.max(...paysOnce.map(([, value]) => value))).toBe(values.selfAttacks);
  });

  /**
   * Where the trigger table sits against the keyword table, as a partition
   * rather than a bound.
   *
   * "Held below a keyword's" was the docblock's claim and it was true only
   * against the most valuable keyword, which is the reading a single
   * `toBeLessThan(max)` cannot tell apart from the stronger one. Six of the
   * nine keywords are priced at or under the best single-event trigger. Naming
   * the three lists is what makes a later edit to either table show up as a
   * decision.
   */
  it('splits the keyword table around its best single-event condition, the way the config says', () => {
    const keywords = config.cast.keywordValue;
    const best = config.cast.triggerValue.selfAttacks;
    expect(KEYWORDS.filter((keyword) => keywords[keyword] > best).sort()).toEqual([
      'deathtouch',
      'firstStrike',
      'flying',
    ]);
    expect(KEYWORDS.filter((keyword) => keywords[keyword] === best).sort()).toEqual(['lifelink']);
    expect(KEYWORDS.filter((keyword) => keywords[keyword] < best).sort()).toEqual([
      'haste',
      'menace',
      'reach',
      'trample',
      'vigilance',
    ]);
  });
});
