/**
 * The questions the study asks, and that they are a pure function of the seed.
 *
 * The recorder resumes by key, so a decision list that drifted between two runs
 * would skip work that was never done and repeat work that was. What is asserted
 * here is that the list is reproducible, that each decision is a view the bot
 * really had, and that nothing about the bot's own answer reaches the prompt.
 */
import type { BoosterRecipe } from '@mtg/deckbuild';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_PACK_SIZE, podDecisions, studyDecisions } from '../tools/jev-label/decisions';
import { QUESTION_ID, decisionRequest, optionLine, poolLine } from '../tools/jev-label/questions';
import { SET } from './jev-label-fixture';

describe('the decisions of one pod', () => {
  const decisions = podDecisions(SET, 'decisions/pod/0');

  it('is the same list every time for one seed, and another for a different seed', () => {
    const again = podDecisions(SET, 'decisions/pod/0');
    expect(again.map((decision) => [decision.key, decision.botPickId])).toEqual(
      decisions.map((decision) => [decision.key, decision.botPickId]),
    );
    const other = podDecisions(SET, 'decisions/pod/1');
    expect(other.map((decision) => decision.pack.map((card) => card.id))).not.toEqual(
      decisions.map((decision) => decision.pack.map((card) => card.id)),
    );
  });

  it('gives each decision a unique key naming its pod, round and pick', () => {
    expect(new Set(decisions.map((decision) => decision.key)).size).toBe(decisions.length);
    for (const decision of decisions) {
      expect(decision.key).toBe(`decisions/pod/0/${String(decision.round)}/${String(decision.pickNumber)}`);
    }
  });

  it('holds only picks from a pack of at least the floor, with the bot pick inside it', () => {
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(decision.pack.length).toBeGreaterThanOrEqual(DEFAULT_MIN_PACK_SIZE);
      expect(decision.pack.map((card) => card.id)).toContain(decision.botPickId);
    }
  });

  it('shows the pool the seat had already built: empty at the first pick, one card longer at the next', () => {
    expect(decisions[0]?.pool).toEqual([]);
    for (let index = 1; index < decisions.length; index += 1) {
      const before = decisions[index - 1]!;
      const after = decisions[index]!;
      if (after.round !== before.round || after.pickNumber !== before.pickNumber + 1) continue;
      expect(after.pool.map((card) => card.id)).toEqual([
        ...before.pool.map((card) => card.id),
        before.botPickId,
      ]);
    }
  });

  it('refuses a seat outside the pod', () => {
    expect(() => podDecisions(SET, 'decisions/pod/0', { seat: 8 })).toThrow(/seat/);
    expect(() => podDecisions(SET, 'decisions/pod/0', { seat: -1 })).toThrow(/seat/);
  });

  it('returns nothing when no pack is as large as the floor', () => {
    expect(podDecisions(SET, 'decisions/pod/0', { minPackSize: 1000 })).toEqual([]);
  });

  it('deals the packs of the recipe it is given, so a study can match another run pack for pack', () => {
    const opening = (recipe?: BoosterRecipe): number =>
      podDecisions(SET, 'decisions/pod/0', recipe === undefined ? {} : { recipe })[0]!.pack.length;
    const wider: BoosterRecipe = [
      { rarity: 'common', count: 10 },
      { rarity: 'uncommon', count: 3 },
      { rarity: 'rare', count: 1 },
    ];

    expect(opening()).toBe(13);
    expect(opening(wider)).toBe(14);
  });
});

describe('the decisions of a study', () => {
  it('draws pods in order until it has as many decisions as asked for, and no more', () => {
    const onePod = podDecisions(SET, 'study/pod/0').length;
    const wanted = onePod + 5;
    const decisions = studyDecisions(SET, { seedPrefix: 'study', count: wanted });

    expect(decisions).toHaveLength(wanted);
    expect(new Set(decisions.map((decision) => decision.key)).size).toBe(wanted);
    expect(decisions.slice(0, onePod).every((decision) => decision.podSeed === 'study/pod/0')).toBe(true);
    expect(decisions.slice(onePod).every((decision) => decision.podSeed === 'study/pod/1')).toBe(true);
  });

  it('is a prefix of a longer study over the same seed, so a run can be extended', () => {
    const short = studyDecisions(SET, { seedPrefix: 'study', count: 12 });
    const long = studyDecisions(SET, { seedPrefix: 'study', count: 40 });
    expect(long.slice(0, 12).map((decision) => decision.key)).toEqual(short.map((decision) => decision.key));
  });

  it('refuses a count that is not a positive integer, and a pod with nothing to label', () => {
    expect(() => studyDecisions(SET, { seedPrefix: 'study', count: 0 })).toThrow(/positive integer/);
    expect(() => studyDecisions(SET, { seedPrefix: 'study', count: 2.5 })).toThrow(/positive integer/);
    expect(() => studyDecisions(SET, { seedPrefix: 'study', count: 3, minPackSize: 1000 })).toThrow(
      /no pick from a pack worth labeling/,
    );
  });
});

describe('putting a decision to the labeler', () => {
  const decisions = podDecisions(SET, 'questions/pod/0');
  const first = decisions[0]!;
  const later = decisions[decisions.length - 1]!;

  it('asks one choice question whose options are exactly the pack, keyed by card id', () => {
    const request = decisionRequest(first);
    const question = request.questions[QUESTION_ID]!;
    expect(Object.keys(request.questions)).toEqual([QUESTION_ID]);
    expect(question.type).toBe('choice');
    expect(Object.keys(question.criteria)).toEqual(first.pack.map((card) => card.id));
  });

  it('describes each option with its name, cost and rules text, and each pool card by name and cost', () => {
    const card = first.pack[0]!;
    expect(optionLine(card)).toContain(card.name);
    expect(optionLine(card)).toContain(card.rarity);
    expect(poolLine(card)).toContain(card.name);
    expect(poolLine(card).length).toBeLessThan(optionLine(card).length);
  });

  it('states an empty pool as such and later a line per card taken', () => {
    expect(decisionRequest(first).state['poolSoFar']).toBe('empty');
    expect(decisionRequest(later).state['poolSoFar']).toHaveLength(later.pool.length);
  });

  it('carries the pick number and round, and nothing that names the bot or the pod', () => {
    const request = decisionRequest(later);
    expect(request.state).toMatchObject({ pickNumber: later.pickNumber, round: later.round });
    const text = JSON.stringify(request);
    expect(text).not.toContain(later.key);
    expect(text).not.toContain(later.podSeed);
    expect(Object.keys(request.state)).toEqual(['task', 'pickNumber', 'round', 'poolSoFar']);
  });
});
