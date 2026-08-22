import { describe, expect, it } from 'vitest';
import { DeckCriteriaSchema, type DeckCriteriaInput } from '../src/criteria';
import { describeLandCount, landPlanSchema, planLandCount } from '../src/land-plan';
import { scriptedProvider } from './support/scripted-provider';

function criteriaFor(overrides: Partial<DeckCriteriaInput> = {}) {
  return DeckCriteriaSchema.parse({
    prompt: 'aggressive mono-red burn that wins by turn five',
    format: 'modern',
    colors: ['R'],
    archetype: 'aggro',
    size: 60,
    ...overrides,
  });
}

describe('planLandCount', () => {
  it('takes a stated count and never asks the model', async () => {
    // Someone who asks for 17 lands means it, whatever the model would say.
    const provider = scriptedProvider([{ landCount: 24, reason: 'this answer is never reached' }]);

    const plan = await planLandCount(provider, criteriaFor({ landCount: 17 }));

    expect(plan.count).toBe(17);
    expect(plan.source).toBe('stated');
    expect(provider.prompts).toEqual([]);
  });

  it('asks the model when the player stated none', async () => {
    const provider = scriptedProvider([
      { landCount: 19, reason: 'burn wants the extra spell more than the extra land' },
    ]);

    const plan = await planLandCount(provider, criteriaFor());

    expect(plan.count).toBe(19);
    expect(plan.source).toBe('model');
    expect(plan.reason).toBe('burn wants the extra spell more than the extra land');
    expect(provider.prompts).toHaveLength(1);
  });

  it('gives the model what the count follows from', async () => {
    const provider = scriptedProvider([{ landCount: 19, reason: 'lean' }]);

    await planLandCount(provider, criteriaFor({ themes: ['prowess'], maxManaValue: 3 }));

    const prompt = provider.prompts[0] ?? '';
    expect(prompt).toContain('aggressive mono-red burn that wins by turn five');
    expect(prompt).toContain('modern');
    expect(prompt).toContain('60');
    expect(prompt).toContain('aggro');
    expect(prompt).toContain('prowess');
    expect(prompt).toContain('3');
  });

  it('does not ask the model for the split, which is arithmetic', async () => {
    const provider = scriptedProvider([{ landCount: 19, reason: 'lean' }]);

    await planLandCount(provider, criteriaFor());

    expect(provider.prompts[0] ?? '').toContain('split');
    expect(provider.prompts[0] ?? '').toContain('pip demand');
  });
});

/**
 * The band is a guard, not a decision: it is the same share of the deck for
 * every archetype and every format, so it can reject a nonsense answer without
 * being able to tell burn how many lands to run.
 */
describe('the sanity band', () => {
  it('accepts a lean burn mana base in a sixty-card deck', () => {
    expect(landPlanSchema(60).safeParse({ landCount: 19, reason: 'lean' }).success).toBe(true);
  });

  it('rejects counts no real deck runs', () => {
    expect(landPlanSchema(60).safeParse({ landCount: 4, reason: 'all spells' }).success).toBe(false);
    expect(landPlanSchema(60).safeParse({ landCount: 40, reason: 'all lands' }).success).toBe(false);
  });

  it('scales with the deck size rather than assuming sixty cards', () => {
    expect(landPlanSchema(100).safeParse({ landCount: 38, reason: 'commander' }).success).toBe(true);
    expect(landPlanSchema(40).safeParse({ landCount: 17, reason: 'limited' }).success).toBe(true);
    expect(landPlanSchema(40).safeParse({ landCount: 38, reason: 'absurd' }).success).toBe(false);
  });

  it('makes the model say why, because the count is a judgment', () => {
    expect(landPlanSchema(60).safeParse({ landCount: 19 }).success).toBe(false);
  });

  it('bounds the reason, which is model text on its way to a report', () => {
    // One sentence is the contract. An unbounded string reaches the deck
    // report and stdout, so the schema is where it stops.
    const sentence = { landCount: 19, reason: 'x'.repeat(300) };
    const essay = { landCount: 19, reason: 'x'.repeat(301) };

    expect(landPlanSchema(60).safeParse(sentence).success).toBe(true);
    expect(landPlanSchema(60).safeParse(essay).success).toBe(false);
  });
});

describe('scriptedProvider', () => {
  it('refuses an empty script rather than replaying undefined as an answer', async () => {
    // The index is `answers[-1]` when the script is empty, and a cast would
    // hand `undefined` back as though the model had answered.
    await expect(planLandCount(scriptedProvider([]), criteriaFor())).rejects.toThrow(/nothing to replay/);
  });
});

describe('describeLandCount', () => {
  it('credits the player for a stated count', async () => {
    const provider = scriptedProvider([{ landCount: 24, reason: 'never reached' }]);

    const line = describeLandCount(await planLandCount(provider, criteriaFor({ landCount: 17 })));

    expect(line).toContain('17 lands');
    expect(line).toContain('as the player stated');
  });

  it('carries the model reason for a chosen count', () => {
    const line = describeLandCount({ count: 19, source: 'model', reason: 'burn wants spell density' });
    expect(line).toContain('19 lands');
    expect(line).toContain('chosen for this deck: burn wants spell density');
  });
});
