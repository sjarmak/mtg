import { describe, expect, it } from 'vitest';
import { unlimitedBudget } from '@mtg/llm';
import { DeckCriteriaSchema, enumerateCriteria } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import type { DeckPool } from '../src/pool';
import {
  constructedFormatContract,
  constructedSelectionPolicy,
  DECKLAB_MODEL_REPAIR_SELECTION_POLICY,
  DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY,
} from '../src/constructed-policy';
import { VariationConstructionSchema } from '../src/workbench/variation';

const EMPTY_POOL: DeckPool = {
  kind: 'store',
  universe: { cards: [], filters: [], byName: new Map() },
  knownNames: new Set(),
};

function resolved(input: Record<string, unknown>, landCount: number) {
  return resolveCriteria(DeckCriteriaSchema.parse(input), {
    count: landCount,
    source: 'stated',
    reason: 'as stated',
  });
}

describe('constructed format contract', () => {
  it('refuses ambiguous population shares and duplicate opponent identities', () => {
    expect(() =>
      DeckCriteriaSchema.parse({
        prompt: 'deck',
        format: 'modern',
        opponentPopulation: {
          id: 'bad-field',
          members: [
            { id: 'same', share: 0.4, strategy: 'first plan' },
            { id: 'same', share: 0.4, strategy: 'second plan' },
          ],
        },
      }),
    ).toThrow(/duplicate opponent id|sum to 1/);
  });

  it('records the effective 60-card format limits and declared opponents', () => {
    const criteria = resolved(
      {
        prompt: 'tempo tuned for the field',
        format: 'modern',
        size: 60,
        landCount: 23,
        opponentPopulation: {
          id: 'modern-field-2026-09',
          members: [
            { id: 'energy', share: 0.6, strategy: 'go wide with recursive threats' },
            { id: 'combo', share: 0.4, strategy: 'assemble a fast deterministic combo' },
          ],
        },
      },
      23,
    );

    expect(constructedFormatContract(EMPTY_POOL, criteria)).toEqual({
      id: 'decklab-constructed-format/v1',
      source: { kind: 'format', format: 'modern' },
      deckSize: 60,
      landCount: 23,
      spellCount: 37,
      copyLimit: 4,
      opponentPopulation: {
        id: 'modern-field-2026-09',
        members: [
          { id: 'energy', share: 0.6, strategy: 'go wide with recursive threats' },
          { id: 'combo', share: 0.4, strategy: 'assemble a fast deterministic combo' },
        ],
      },
    });
    expect(enumerateCriteria(criteria)).toContainEqual({
      id: 'opponents',
      kind: 'semantic',
      statement:
        'targets modern-field-2026-09: energy (60% — go wide with recursive threats); combo (40% — assemble a fast deterministic combo)',
    });
  });

  it('records singleton limits from the format instead of the raw default', () => {
    const criteria = resolved(
      { prompt: 'commander deck', format: 'commander', size: 100, landCount: 38 },
      38,
    );
    expect(constructedFormatContract(EMPTY_POOL, criteria)).toMatchObject({
      source: { kind: 'format', format: 'commander' },
      deckSize: 100,
      copyLimit: 1,
    });
  });

  it('identifies a staged set pool without inventing format legality', () => {
    const criteria = resolved(
      { prompt: 'set-built deck', sets: ['holdout'], size: 60, landCount: 24, maxCopies: 3 },
      24,
    );
    const pool: DeckPool = { ...EMPTY_POOL, kind: 'set', playable: new Map(), basics: [] };
    expect(constructedFormatContract(pool, criteria)).toMatchObject({
      source: { kind: 'sets', sets: ['holdout'] },
      copyLimit: 3,
    });
  });

  it('persists a printed format pool source in the variation contract', () => {
    const criteria = resolved({ prompt: 'set-built deck', sets: ['KTK'], size: 60, landCount: 24 }, 24);
    const pool: DeckPool = {
      ...EMPTY_POOL,
      kind: 'printed-format',
      formatId: 'ktk',
      sourceCodes: ['KTK'],
      printings: new Map(),
      basics: new Map(),
    };
    const format = constructedFormatContract(pool, criteria);
    expect(format.source).toEqual({ kind: 'printed-format', formatId: 'ktk', sourceCodes: ['KTK'] });
    expect(() =>
      VariationConstructionSchema.parse({
        format,
        selection: {
          id: 'decklab-model-repair/v1',
          provider: 'fixture',
          model: 'scripted',
          fallbackId: 'decklab-verified-partial/v1',
        },
      }),
    ).not.toThrow();
  });
});

describe('constructed selection policy identity', () => {
  it('attributes the selector, verified fallback, and exact model', () => {
    const provider = {
      name: 'fixture' as const,
      model: 'fixture-model',
      budget: unlimitedBudget(),
      complete: async () => {
        throw new Error('unused');
      },
    };
    expect(constructedSelectionPolicy(provider)).toEqual({
      id: DECKLAB_MODEL_REPAIR_SELECTION_POLICY,
      provider: 'fixture',
      model: 'fixture-model',
      fallbackId: DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY,
    });
  });
});
