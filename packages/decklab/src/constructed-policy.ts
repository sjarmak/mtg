import type { LlmProvider } from '@mtg/llm';
import type { OpponentPopulation, ResolvedCriteria } from './criteria';
import type { DeckPool } from './pool';
import { statedCopyLimit } from './verify';

export const CONSTRUCTED_FORMAT_CONTRACT = 'decklab-constructed-format/v1';
export const DECKLAB_MODEL_REPAIR_SELECTION_POLICY = 'decklab-model-repair/v1';
export const DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY = 'decklab-verified-partial/v1';

export type ConstructedPoolSource =
  | { readonly kind: 'format'; readonly format: string }
  | { readonly kind: 'sets'; readonly sets: readonly string[] }
  | { readonly kind: 'printed-format'; readonly formatId: string; readonly sourceCodes: readonly string[] };

export interface ConstructedFormatContract {
  readonly id: typeof CONSTRUCTED_FORMAT_CONTRACT;
  readonly source: ConstructedPoolSource;
  readonly deckSize: number;
  readonly landCount: number;
  readonly spellCount: number;
  readonly copyLimit: number;
  readonly opponentPopulation: OpponentPopulation | null;
}

export interface ConstructedSelectionPolicy {
  readonly id: typeof DECKLAB_MODEL_REPAIR_SELECTION_POLICY;
  readonly provider: string;
  readonly model: string;
  readonly fallbackId: typeof DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY;
}

function sourceOf(pool: DeckPool, criteria: ResolvedCriteria): ConstructedPoolSource {
  if (pool.kind === 'store') {
    if (criteria.format === undefined)
      throw new Error('a store-backed constructed contract requires a format');
    return { kind: 'format', format: criteria.format };
  }
  if (pool.kind === 'printed-format') {
    return { kind: 'printed-format', formatId: pool.formatId, sourceCodes: [...pool.sourceCodes] };
  }
  if (criteria.sets === undefined || criteria.sets.length === 0) {
    throw new Error('a set-backed constructed contract requires at least one set');
  }
  return { kind: 'sets', sets: [...criteria.sets] };
}

/** The exact structural and strategic context one constructed build ran under. */
export function constructedFormatContract(
  pool: DeckPool,
  criteria: ResolvedCriteria,
): ConstructedFormatContract {
  return {
    id: CONSTRUCTED_FORMAT_CONTRACT,
    source: sourceOf(pool, criteria),
    deckSize: criteria.size,
    landCount: criteria.landCount,
    spellCount: criteria.size - criteria.landCount,
    copyLimit: statedCopyLimit(criteria),
    opponentPopulation:
      criteria.opponentPopulation === undefined
        ? null
        : {
            ...criteria.opponentPopulation,
            members: criteria.opponentPopulation.members.map((member) => ({ ...member })),
          },
  };
}

/** Attribute semantic selection and its deterministic verified-partial fallback. */
export function constructedSelectionPolicy(provider: LlmProvider): ConstructedSelectionPolicy {
  return {
    id: DECKLAB_MODEL_REPAIR_SELECTION_POLICY,
    provider: provider.name,
    model: provider.model,
    fallbackId: DECKLAB_VERIFIED_PARTIAL_FALLBACK_POLICY,
  };
}
