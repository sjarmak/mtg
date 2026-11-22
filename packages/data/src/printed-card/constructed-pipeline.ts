import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  PrintedConstructedFormatSchema,
  checkStandardDeck,
  serializedPrintedConstructedFormatContent,
  type PrintedCardCatalogEntry,
  type PrintedConstructedDeck,
  type PrintedConstructedFormat,
  type PrintedLimitedFormat,
} from '@mtg/printed-card';
import { PrintedArchetypeListSchema } from './archetypes';

const SlotSchema = z.strictObject({
  physicalId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  count: z.number().int().positive(),
});

const DeckArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-constructed-deck'),
  formatId: z.string().trim().min(1),
  sourceCodes: z.array(z.string().trim().min(1)).min(1),
  archetype: z.strictObject({
    name: z.string().trim().min(1),
    colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G'])).min(1),
    plan: z.string().trim().min(1),
  }),
  spend: z.strictObject({
    spentUsd: z.number().nonnegative(),
    selectionUsd: z.number().nonnegative(),
    maxSpendUsd: z.number().positive(),
  }),
  deck: z.strictObject({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    commanders: z.array(SlotSchema),
    cards: z.array(SlotSchema).min(1),
  }),
});

export const PrintedConstructedForgeReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  formatId: z.string().trim().min(1),
  formatSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  results: z.array(
    z.strictObject({
      archetypeId: z.string().trim().min(1),
      status: z.enum(['completed', 'failed']),
      decisions: z.number().int().nonnegative(),
      elapsedMs: z.number().nonnegative(),
      reason: z.string().trim().min(1).optional(),
    }),
  ),
});

interface CatalogInput {
  readonly code: string;
  readonly cards: readonly Pick<
    PrintedCardCatalogEntry,
    'physicalId' | 'correctedName' | 'typeLine' | 'oracleText'
  >[];
}

interface CandidateInput {
  readonly id: string;
  readonly name: string;
  readonly sources: PrintedLimitedFormat['sources'];
  readonly archetypes: unknown;
  readonly catalogs: readonly CatalogInput[];
  readonly admittedPhysicalIds: ReadonlySet<string>;
  readonly artifacts: readonly PrintedConstructedArtifactInput[];
}

export type PrintedConstructedArtifactInput =
  | { readonly archetypeId: string; readonly status: 'loaded'; readonly value: unknown }
  | { readonly archetypeId: string; readonly status: 'failed'; readonly reason: string };

export interface PrintedConstructedPipelineResult {
  readonly archetypeId: string;
  readonly status: 'passed' | 'failed';
  readonly reason?: string;
}

export interface PrintedConstructedCandidate {
  readonly format: PrintedConstructedFormat | null;
  readonly results: readonly PrintedConstructedPipelineResult[];
}

export function forgeCompletionResults(
  format: PrintedConstructedFormat,
  raw: unknown,
): ReadonlyMap<string, 'completed' | 'failed'> {
  const receipt = PrintedConstructedForgeReceiptSchema.parse(raw);
  if (receipt.formatId !== format.id)
    throw new Error(`Forge receipt is for ${receipt.formatId}, not ${format.id}`);
  if (receipt.formatSha256 !== format.contentSha256) {
    throw new Error(`Forge receipt proves format ${receipt.formatSha256}, not ${format.contentSha256}`);
  }
  const results = new Map<string, 'completed' | 'failed'>();
  for (const result of receipt.results) {
    if (results.has(result.archetypeId)) throw new Error(`duplicate Forge result for ${result.archetypeId}`);
    results.set(result.archetypeId, result.status);
  }
  return results;
}

function seal(
  id: string,
  name: string,
  sources: PrintedLimitedFormat['sources'],
  decks: readonly PrintedConstructedDeck[],
): PrintedConstructedFormat {
  const unsealed = PrintedConstructedFormatSchema.parse({
    schemaVersion: 1,
    kind: 'printed-constructed-format',
    id,
    name,
    sources,
    rules: { variant: 'standard', startingLife: 20 },
    decks,
    contentSha256: '0'.repeat(64),
  });
  return PrintedConstructedFormatSchema.parse({
    ...unsealed,
    contentSha256: createHash('sha256')
      .update(serializedPrintedConstructedFormatContent(unsealed))
      .digest('hex'),
  });
}

function failure(archetypeId: string, reason: string): PrintedConstructedPipelineResult {
  return { archetypeId, status: 'failed', reason };
}

export function buildPrintedConstructedCandidate(input: CandidateInput): PrintedConstructedCandidate {
  const archetypes = PrintedArchetypeListSchema.parse(input.archetypes);
  if (archetypes.formatId !== input.id) throw new Error(`archetype list is for ${archetypes.formatId}`);
  const sourceCodes = input.sources.map((source) => source.code);
  const printings = new Map(
    input.catalogs.flatMap((catalog) => catalog.cards).map((card) => [card.physicalId, card]),
  );
  const byId = new Map(archetypes.archetypes.map((archetype) => [archetype.id, archetype]));
  const decks: PrintedConstructedDeck[] = [];
  const results: PrintedConstructedPipelineResult[] = [];

  for (const artifactInput of input.artifacts) {
    if (artifactInput.status === 'failed') {
      results.push(failure(artifactInput.archetypeId, artifactInput.reason));
      continue;
    }
    const parsed = DeckArtifactSchema.safeParse(artifactInput.value);
    if (!parsed.success) {
      results.push(failure(artifactInput.archetypeId, z.prettifyError(parsed.error)));
      continue;
    }
    const artifact = parsed.data;
    const archetype = byId.get(artifactInput.archetypeId);
    if (archetype === undefined) {
      results.push(failure(artifactInput.archetypeId, `no declared archetype ${artifactInput.archetypeId}`));
      continue;
    }
    const expected = { name: archetype.name, colors: archetype.colors, plan: archetype.plan };
    if (
      artifact.formatId !== input.id ||
      !isDeepStrictEqual(artifact.sourceCodes, sourceCodes) ||
      !isDeepStrictEqual(artifact.archetype, expected) ||
      artifact.deck.id !== archetype.id ||
      artifact.deck.name !== archetype.name ||
      artifact.deck.commanders.length > 0
    ) {
      results.push(failure(archetype.id, 'artifact identity differs from its declared archetype'));
      continue;
    }
    const misnamed = artifact.deck.cards.find((slot) => {
      const printing = printings.get(slot.physicalId);
      return printing !== undefined && printing.correctedName !== slot.name;
    });
    if (misnamed !== undefined) {
      results.push(failure(archetype.id, `${misnamed.name} does not match its catalog printing name`));
      continue;
    }
    const verdict = checkStandardDeck(artifact.deck, printings);
    if (!verdict.legal || verdict.cards !== 60) {
      const reasons = verdict.findings
        .filter((finding) => finding.kind !== 'deck-size')
        .map((finding) => finding.detail);
      if (verdict.cards !== 60) {
        reasons.push(`${String(verdict.cards)} cards; this pipeline requires exactly 60`);
      }
      results.push(failure(archetype.id, reasons.join('; ')));
      continue;
    }
    const unadmitted = artifact.deck.cards.find((slot) => !input.admittedPhysicalIds.has(slot.physicalId));
    if (unadmitted !== undefined) {
      results.push(failure(archetype.id, `${unadmitted.name} is not Forge-admitted`));
      continue;
    }
    decks.push(artifact.deck);
    results.push({ archetypeId: archetype.id, status: 'passed' });
  }

  return { format: decks.length === 0 ? null : seal(input.id, input.name, input.sources, decks), results };
}

export function finalizePrintedConstructedFormat(
  candidate: PrintedConstructedCandidate,
  forgeResults: ReadonlyMap<string, 'completed' | 'failed'>,
): PrintedConstructedFormat {
  if (candidate.format === null) throw new Error('No structurally valid constructed deck was built');
  const decks = candidate.format.decks.filter((deck) => forgeResults.get(deck.id) === 'completed');
  if (decks.length === 0) throw new Error('No structurally valid deck has a completed Forge game');
  return seal(candidate.format.id, candidate.format.name, candidate.format.sources, decks);
}
