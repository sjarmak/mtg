/**
 * mtg-bc2.49. The repair loop ran a fixed three rounds and returned whatever had
 * verified, which shipped a 58-card pauper deck against a stated 60 while the
 * model was still filling it. Three rounds is now the budget every build is
 * guaranteed rather than the whole allowance: past it the loop keeps going while
 * each round is still adding spells, and stops the instant one is not.
 *
 * Every extra round is a live model call, so the extension is capped by
 * `roundsCeiling` and progress is counted in spells. A round that adds only a
 * nonbasic land moves the card count and leaves the spell target exactly where
 * it was, and treating that as progress would let one land a round buy every
 * round up to the cap. The cap is sized to the deck rather than fixed, because a
 * fixed eight is one round short of what a 60-card deck needs at one legal
 * four-of a round — the original failure at 56 cards instead of 58.
 *
 * Which bound stopped the loop is returned rather than inferred downstream, so
 * `stop` is asserted everywhere the deck comes back short.
 *
 * mtg-bc2.89 and mtg-bc2.90 are the two bounds that came after. The round count
 * is a proxy for cost and a poor one, so the dollars the build may spend are
 * read off `@mtg/llm`'s budget guard and stop the loop on their own; and the
 * guaranteed rounds now end early for the one round that cannot inform the next
 * one — no card accepted, and a problem list identical to the one the round
 * before ended with, therefore an identical prompt. Every other shape of
 * unproductive round still buys the round the guarantee promised.
 *
 * Both of those bounds came back wrong in the same way, and the last two tests
 * of each are the repairs. `idle` keyed new information on a rejection the round
 * before did not have, so a problem list that got shorter stopped a loop whose
 * next prompt would have been different; and the dollar bound was a flat $5,
 * which is clear of a 60-card build and stops a 99-card one at ten rounds of
 * nineteen. A guarantee that skips a round asking a different question is not
 * the guarantee it says it is, and a default no supported deck size can finish
 * under is mtg-bc2.49 again with a dollar sign on it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import { ZERO_USAGE } from '@mtg/llm';
import { isLandCard, loadKnownNames, selectUniverse } from '../src/candidates';
import type { ResolvedCriteria } from '../src/criteria';
import { DeckCriteriaSchema } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import type { DeckProposal, SelectionOptions, SelectionResult } from '../src/select';
import { defaultMaxSpendUsd, roundsCeiling, selectCards } from '../src/select';
import { spellCount } from '../src/verify';
import { createFakeStore, fillerSpells, type FakeCard } from './support/fake-store';
import { scriptedProvider, type ScriptedProvider } from './support/scripted-provider';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

/** Three utility lands, so a round can add a card without adding a spell. */
const FIELDS: readonly FakeCard[] = Array.from({ length: 3 }, (_unused, index) => ({
  name: `Ember Field ${index + 1}`,
  manaCost: null,
  manaValue: 0,
  typeLine: 'Land',
  colorIdentity: '',
  producedMana: ['R'],
  priceUsd: 0.5,
}));

const POOL: readonly FakeCard[] = [...fillerSpells(20), ...FIELDS];

function criteriaFor(size: number, landCount: number): ResolvedCriteria {
  const parsed = DeckCriteriaSchema.parse({
    prompt: 'aggressive red deck',
    format: 'modern',
    colors: ['R'],
    archetype: 'aggro',
    size,
    landCount,
  });
  return resolveCriteria(parsed, { count: landCount, source: 'stated', reason: 'as the player stated' });
}

/** One scripted round: these cards, this many copies of each. */
function proposing(names: readonly string[], count: number): DeckProposal {
  return {
    plan: 'burn them out',
    cards: names.map((name) => ({ name, count, criteria: ['archetype'], reason: 'reach' })),
  };
}

async function select(
  answers: readonly DeckProposal[],
  criteria: ResolvedCriteria,
  options: SelectionOptions = {},
  costUsd = 0,
): Promise<{ readonly provider: ScriptedProvider; readonly result: SelectionResult }> {
  store = createFakeStore(POOL);
  const universe = selectUniverse(store, criteria);
  const provider = scriptedProvider(answers, { costUsd });
  const result = await selectCards(
    provider,
    universe,
    criteria,
    { knownNames: loadKnownNames(store) },
    options,
  );
  return { provider, result };
}

describe('the repair loop cannot stop short while it is making progress', () => {
  it('runs past the guaranteed rounds while every round adds spells', async () => {
    // Twenty spells at four a round is five rounds, two more than the guarantee.
    const criteria = criteriaFor(40, 20);
    const { result } = await select(
      [1, 2, 3, 4, 5].map((index) => proposing([`Ember Bolt ${index}`], 4)),
      criteria,
    );

    expect(result.rounds).toBe(5);
    expect(spellCount(result.inclusions)).toBe(20);
    expect(result.shortBy).toBe(0);
    expect(result.stop).toEqual({ kind: 'filled' });
  });

  it('fills a 60-card deck when the model answers with one legal four-of a round', async () => {
    // The bead's own shape. Thirty-six spells at four a round is nine rounds,
    // and a cap that cannot reach nine ships an undersized deck while the model
    // is still supplying cards — which is the failure, not the fix for it.
    const criteria = criteriaFor(60, 24);
    const { result } = await select(
      Array.from({ length: 9 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 4)),
      criteria,
    );

    expect(result.rounds).toBe(9);
    expect(spellCount(result.inclusions)).toBe(36);
    expect(result.shortBy).toBe(0);
    expect(result.stop).toEqual({ kind: 'filled' });
  });

  it('never caps below the rounds one four-of a round needs, whatever the deck size', () => {
    // The property a fixed cap cannot hold: eight rounds is generous for a
    // 40-card deck and one short for a 60-card one.
    for (const spellTarget of [20, 36, 60, 99]) {
      expect(roundsCeiling(spellTarget)).toBeGreaterThanOrEqual(Math.ceil(spellTarget / 4));
    }
  });

  it('stops the moment a round adds no new spells', async () => {
    // Round two re-proposes what round one already had, so it costs a model call
    // and buys nothing; the loop must not spend another on the same answer.
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select(
      [proposing(['Ember Bolt 1'], 4), proposing(['Ember Bolt 1'], 4)],
      criteria,
      { maxRounds: 1 },
    );

    expect(result.rounds).toBe(2);
    expect(provider.prompts).toHaveLength(2);
    expect(spellCount(result.inclusions)).toBe(4);
    expect(result.shortBy).toBe(32);
    expect(result.stop).toEqual({ kind: 'stalled' });
  });

  it('counts progress in spells, so a round that adds only a land does not buy another', async () => {
    const criteria = criteriaFor(60, 24);
    const { result } = await select(
      [proposing(['Ember Bolt 1'], 4), proposing(['Ember Field 1'], 1), proposing(['Ember Field 2'], 1)],
      criteria,
      { maxRounds: 1 },
    );

    expect(result.rounds).toBe(2);
    expect(result.inclusions.filter((entry) => isLandCard(entry.card))).toHaveLength(1);
    expect(result.shortBy).toBe(32);
    expect(result.stop).toEqual({ kind: 'stalled' });
  });

  it('stops at the ceiling when the model adds one card a round, and names the ceiling', async () => {
    // The safety property. Progress alone would buy 36 rounds here, which is 36
    // live model calls for one deck. Every round proposes a fresh legal card and
    // nothing is rejected, so the ceiling is the only thing that stopped it and
    // the only honest thing to report.
    const criteria = criteriaFor(60, 24);
    const ceiling = roundsCeiling(36);
    const { provider, result } = await select(
      Array.from({ length: 20 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 1)),
      criteria,
    );

    expect(result.rounds).toBe(ceiling);
    expect(provider.prompts).toHaveLength(ceiling);
    expect(result.rejections).toEqual([]);
    expect(result.shortBy).toBe(36 - ceiling);
    expect(result.stop).toEqual({ kind: 'ceiling', limit: ceiling });
  });

  it('spends nothing when the caller states a budget of no rounds', async () => {
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select([proposing(['Ember Bolt 1'], 4)], criteria, {
      maxRounds: 0,
    });

    expect(provider.prompts).toEqual([]);
    expect(result.rounds).toBe(0);
    expect(result.shortBy).toBe(36);
    expect(result.stop).toEqual({ kind: 'budget', limit: 0 });
  });

  it('spends a guaranteed round on any round that named a problem the last one did not', async () => {
    // The guarantee's whole purpose, and the thing mtg-bc2.90 must not delete:
    // two rounds of rejections in a row, and the third round is the one that
    // supplies real cards. Each bad name is a different bad name, so each round
    // hands the loop something it did not have.
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select(
      [proposing(['Ember Blot'], 4), proposing(['Ember Bolts'], 4), proposing(['Ember Bolt 1'], 4)],
      criteria,
    );

    // Four rounds: the two rejection rounds are inside the guarantee, round
    // three supplies cards, and the cards buy a fourth round that repeats them.
    expect(result.rounds).toBe(4);
    expect(provider.prompts[2]).toContain('Ember Bolts');
    expect(spellCount(result.inclusions)).toBe(4);
    expect(result.stop).toEqual({ kind: 'stalled' });
  });

  it('ends a guaranteed round early when it added nothing and named nothing new', async () => {
    // mtg-bc2.90. The same wrong card twice: round two accepted nothing and
    // repeated round one's rejection verbatim, so round three would be handed
    // the identical prompt. The guarantee buys the round after a rejection, not
    // an unlimited supply of the same question.
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select([proposing(['Ember Blot'], 4)], criteria);

    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[0]).not.toEqual(provider.prompts[1]);
    expect(result.rounds).toBe(2);
    expect(result.rejections.map((rejection) => rejection.code)).toEqual(['unknown-card']);
    expect(result.stop).toEqual({ kind: 'idle' });
  });

  it('spends a guaranteed round when the problem list shrank, because the next prompt differs', async () => {
    // `idle` once asked only whether a rejection had appeared that the round
    // before did not have, so a problem list that got *shorter* read as nothing
    // new — and the round it refused to buy is exactly the one that would have
    // been handed a different list of problems. Round one names two bad cards,
    // round two names one of them, round three supplies a real card.
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select(
      [proposing(['Bad Alpha', 'Bad Beta'], 4), proposing(['Bad Alpha'], 4), proposing(['Ember Bolt 1'], 4)],
      criteria,
    );

    // Round three ran; and the guarantee's own premise, asserted rather than
    // assumed once there is a third prompt to compare: what round three was
    // asked is not what round two was asked.
    expect(provider.prompts).toHaveLength(4);
    expect(provider.prompts[1]).not.toEqual(provider.prompts[2]);
    expect(result.rounds).toBe(4);
    expect(spellCount(result.inclusions)).toBe(4);
    expect(result.shortBy).toBe(32);
    expect(result.stop).toEqual({ kind: 'stalled' });
  });

  it('lets a 99-card build finish under the default spend, at what a round really costs', async () => {
    // The flat $5 default was sized for a 60-card deck and silently foreclosed
    // the largest size the criteria accept: 61 spells at one legal four-of a
    // round is sixteen rounds, which is $8 at the measured per-round cost, and
    // the build stopped on money at ten of them with 21 spells still to find.
    // Nothing here models commander's singleton rule, which this package does
    // not enforce; what is under test is the deck size against the money.
    const criteria = criteriaFor(99, 38);
    const { result } = await select(
      Array.from({ length: 16 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 4)),
      criteria,
      {},
      0.5,
    );

    expect(result.rounds).toBe(16);
    expect(spellCount(result.inclusions)).toBeGreaterThanOrEqual(61);
    expect(result.shortBy).toBe(0);
    expect(result.stop).toEqual({ kind: 'filled' });
  });

  it('sizes the default spend on the rounds the loop may grant, at every supported deck size', () => {
    // The property a flat default cannot hold. A build that reaches the round
    // ceiling at the measured per-round cost must not run out of money first,
    // whether it is a 40-card deck or the 250-card maximum `size` accepts.
    for (const spellTarget of [16, 36, 61, 210]) {
      expect(defaultMaxSpendUsd(spellTarget)).toBeGreaterThan(roundsCeiling(spellTarget) * 0.5);
    }
  });

  it('still stops a build whose rounds cost far more than a round costs', async () => {
    // What the money bound is for, and what the derived default must not give
    // away: the round ceiling cannot tell a four-card proposal from a forty-card
    // one, so a build at $3 a round runs out of dollars long before rounds.
    const criteria = criteriaFor(60, 24);
    const { result } = await select(
      Array.from({ length: 20 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 1)),
      criteria,
      {},
      3,
    );

    expect(result.rounds).toBe(3);
    expect(result.rounds).toBeLessThan(roundsCeiling(36));
    expect(result.stop).toEqual({ kind: 'spend', limit: defaultMaxSpendUsd(36), spentUsd: 9 });
  });

  it('stops on the dollars a build may spend long before the round ceiling', async () => {
    // mtg-bc2.89. Rounds are a proxy for cost and this is the case that shows
    // the gap: every round makes progress, so the ceiling would grant twelve of
    // them, and the money runs out on the third.
    const criteria = criteriaFor(60, 24);
    const { provider, result } = await select(
      Array.from({ length: 20 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 1)),
      criteria,
      { maxSpendUsd: 2.5 },
      1,
    );

    expect(provider.prompts).toHaveLength(3);
    expect(result.rounds).toBe(3);
    expect(result.rounds).toBeLessThan(roundsCeiling(36));
    expect(result.stop).toEqual({ kind: 'spend', limit: 2.5, spentUsd: 3 });
  });

  it('measures that spend from where the build found the guard, not from zero', async () => {
    // The guard belongs to the provider and counts the whole run, so a second
    // build in the same process must not inherit the first one's bill.
    const criteria = criteriaFor(60, 24);
    store = createFakeStore(POOL);
    const universe = selectUniverse(store, criteria);
    const provider = scriptedProvider(
      Array.from({ length: 20 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 1)),
      { costUsd: 1 },
    );
    provider.budget.record({ costUsd: 40, usage: ZERO_USAGE });

    const result = await selectCards(
      provider,
      universe,
      criteria,
      { knownNames: loadKnownNames(store) },
      { maxSpendUsd: 2.5 },
    );

    expect(result.rounds).toBe(3);
    expect(result.stop).toEqual({ kind: 'spend', limit: 2.5, spentUsd: 3 });
  });

  it('refuses a spend bound that is not a positive number of dollars', async () => {
    const criteria = criteriaFor(60, 24);
    await expect(select([proposing(['Ember Bolt 1'], 4)], criteria, { maxSpendUsd: 0 })).rejects.toThrow(
      /maxSpendUsd must be a positive finite number/,
    );
  });

  it('honors a round budget the caller states above the ceiling', async () => {
    // The cap bounds the rounds the loop grants itself, not the ones it was told
    // to run: a stated budget past the cap is a spend the caller agreed to, and
    // it is that budget, not the cap, that the report has to name.
    const criteria = criteriaFor(60, 24);
    const stated = roundsCeiling(36) + 2;
    const { result } = await select(
      Array.from({ length: 20 }, (_unused, index) => proposing([`Ember Bolt ${index + 1}`], 1)),
      criteria,
      { maxRounds: stated },
    );

    expect(result.rounds).toBe(stated);
    expect(result.shortBy).toBe(36 - stated);
    expect(result.stop).toEqual({ kind: 'budget', limit: stated });
  });
});
