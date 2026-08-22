/**
 * The bot has to want to cast a lord.
 *
 * `mtg-bc2.132`'s risk 3 is the failure that produces a confident wrong answer:
 * the balance gate plays 10,035 seeded games and reports healthy win-rate bands
 * for a format whose mechanic never once mattered, because the policies score a
 * lord in hand exactly as they score a vanilla body of the same stats. So the
 * assertion is not "the number is bigger" but "the action the bot submits is the
 * lord", decided on a real `pendingDecision` and checked against `validateAction`.
 *
 * The board half needs nothing new and is asserted here anyway, because it is
 * the half that is easy to assume: `boardCreatureValue` reads through the
 * kernel's layer system, so a creature a lord is already buffing is valued at
 * its derived power, not its printed power.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, boardCreatureValue, decideGreedy, printedCardValue } from '@mtg/sim';
import { parseCard } from '@mtg/dsl';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { creature, PLAINS } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const ANTHEM: AbilityInput = {
  kind: 'static',
  scope: 'otherCreaturesYouControl',
  subtype: null,
  modification: { kind: 'statBonus', power: 1, toughness: 1 },
};

const SELF_PUMP: AbilityInput = {
  kind: 'static',
  scope: 'self',
  subtype: null,
  modification: { kind: 'statBonus', power: 1, toughness: 1 },
};

const KEYWORD_ANTHEM: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  subtype: null,
  modification: { kind: 'grantKeyword', keyword: 'vigilance' },
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function lord(name: string, abilities: readonly AbilityInput[]): Card {
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 400 + abilities.length },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    abilities: [...abilities],
    power: 2,
    toughness: 2,
  };
  return parseCard(input);
}

/** A noncreature artifact, which is the card type slice A stopped making vanilla. */
function banner(name: string, abilities: readonly AbilityInput[]): Card {
  const input: CardInput = {
    kind: 'artifact',
    id: `tst-${slug(name)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 410 + abilities.length },
    manaCost: { generic: 2 },
    abilities: [...abilities],
  };
  return parseCard(input);
}

const LORD = lord('Field Marshal', [ANTHEM]);
const SELF_LORD = lord('Lone Sentinel', [SELF_PUMP]);
const VANILLA = creature('Plain Body', 2, 2, [], { generic: 1, W: 1 }, ['W']);
const ANTHEM_BANNER = banner('Banner of the Goddess', [KEYWORD_ANTHEM]);
const BLANK_BANNER = banner('Plain Banner', []);

function decide(state: GameState, player: 0 | 1 = 0): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = decideGreedy({ state, player, decision }, config);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

describe('a lord in hand', () => {
  it('is worth more than the identical vanilla body', () => {
    expect(printedCardValue(config.cast, LORD)).toBeGreaterThan(printedCardValue(config.cast, VANILLA));
  });

  it('is worth exactly the vanilla body when the reach is configured to zero', () => {
    const noReach = { ...config.cast, staticAbilityReach: 0 };
    expect(printedCardValue(noReach, LORD)).toBe(printedCardValue(noReach, VANILLA));
  });

  it('is the card the bot casts when it can afford only one of the two', () => {
    const start = scenario({
      seed: 'sim/static/choice',
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[VANILLA, LORD], []],
    });
    const action = decide(start.state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Field Marshal');
  });

  /**
   * `staticAbilityReach` is how many permanents a static is *assumed* to reach,
   * and a `self` scope reaches exactly one by definition, the source. Valuing
   * it at the reach instead would price a creature's own +1/+1 as though it
   * were an anthem, which is the same confident wrong number risk 3 is about,
   * one card smaller.
   */
  it('valued once when the scope is itself, whatever the reach is set to', () => {
    const bonus = printedCardValue(config.cast, SELF_LORD) - printedCardValue(config.cast, VANILLA);
    expect(bonus).toBeCloseTo(config.cast.powerWeight + config.cast.toughnessWeight);
  });
});

/**
 * The other half of risk 3, and the half nothing above reaches: slice A is what
 * stopped `kind: 'artifact'` being vanilla by construction, so the anthem
 * artifact is the new card shape, and `printedCardValue`'s artifact branch is
 * the only place its text is worth anything. A creature-only test leaves that
 * branch scoring an anthem exactly as it scores a blank rock.
 */
describe('an anthem artifact in hand', () => {
  it('is worth more than the blank artifact of the same cost', () => {
    expect(printedCardValue(config.cast, ANTHEM_BANNER)).toBeGreaterThan(
      printedCardValue(config.cast, BLANK_BANNER),
    );
  });

  it('is worth exactly the blank artifact when the reach is configured to zero', () => {
    const noReach = { ...config.cast, staticAbilityReach: 0 };
    expect(printedCardValue(noReach, ANTHEM_BANNER)).toBe(printedCardValue(noReach, BLANK_BANNER));
  });

  it('is the card the bot casts when it can afford only one of the two', () => {
    const start = scenario({
      seed: 'sim/static/artifact-choice',
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[BLANK_BANNER, ANTHEM_BANNER], []],
    });
    const action = decide(start.state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(start.state.objects[action.oid]?.card.name).toBe('Banner of the Goddess');
  });
});

describe('a lord already on the battlefield', () => {
  it('is valued through the layer system, so the buffed body is worth more', () => {
    const withLord = scenario({
      seed: 'sim/static/board',
      battlefield: [
        { card: LORD, controller: 0 },
        { card: VANILLA, controller: 0 },
      ],
    });
    const without = scenario({
      seed: 'sim/static/board',
      battlefield: [{ card: VANILLA, controller: 0 }],
    });

    const buffed = withLord.state.battlefield.find(
      (oid) => withLord.state.objects[oid]?.card.name === 'Plain Body',
    );
    const bare = without.state.battlefield.find(
      (oid) => without.state.objects[oid]?.card.name === 'Plain Body',
    );
    expect(buffed).toBeDefined();
    expect(bare).toBeDefined();
    if (buffed === undefined || bare === undefined) return;

    expect(boardCreatureValue(config.cast, withLord.state, buffed)).toBeGreaterThan(
      boardCreatureValue(config.cast, without.state, bare),
    );
  });
});
