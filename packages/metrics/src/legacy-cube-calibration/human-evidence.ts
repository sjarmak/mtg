/** Structural admission, not a substitute for verifying the cited human source. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL, readDraftMemory } from '@mtg/draft-export';
import type { ObservedDraft } from '@mtg/draft-export';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';

const text = z.string().trim().min(1).max(1000);
const name = z.string().trim().min(1).max(200);
const sourceSchema = z
  .object({
    author: text,
    url: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && url.username === '' && url.password === '';
      }),
    published: z.string().date(),
    session: text,
    origin: z.enum(['human', 'model', 'synthetic']),
    environment: z.enum(['matched', 'transfer', 'unknown']),
    locator: text,
  })
  .strict();
const common = { id: name, split: z.enum(['tuning', 'holdout']), source: sourceSchema };
const caseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('pick'),
      observations: z
        .array(
          z
            .object({
              round: z.number().int().min(1).max(3),
              pickNumber: z.number().int().min(1).max(15),
              cards: z.array(name).min(1).max(15),
            })
            .strict(),
        )
        .min(1)
        .max(45),
      picks: z.array(name).max(44),
      preference: z.discriminatedUnion('mode', [
        z
          .object({
            mode: z.enum(['current', 'flexible', 'pivot']),
            acceptable: z.array(name).min(1).max(15),
          })
          .strict(),
        z
          .object({
            mode: z.literal('explore'),
            archetype: name,
            acceptable: z.array(name).min(1).max(15),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('deck'),
      cards: z
        .array(z.object({ name, count: z.number().int().min(1).max(40) }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
]);
const corpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogSha256: z.string().regex(/^[a-f0-9]{64}$/),
    cases: z.array(caseSchema).max(10000),
  })
  .strict();
type EvidenceCase = z.infer<typeof caseSchema>;
type AdmissionReason = { readonly code: string; readonly detail: string };
const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
type CardIndex = ReadonlyMap<string, PrintedCardCatalogEntry | undefined>;

export function sourceKey(value: string): string {
  const url = new URL(value);
  // Page fragments and tracking parameters must not manufacture independent sources.
  // Keep content identifiers such as YouTube's v parameter.
  const query = new URLSearchParams(
    [...url.searchParams.entries()]
      .filter(([key]) => !key.startsWith('utm_') && !['fbclid', 'gclid'].includes(key))
      .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)),
  ).toString();
  return `${url.origin}${url.pathname.replace(/\/$/, '')}${query ? `?${query}` : ''}`;
}

function validateSplits(cases: readonly EvidenceCase[]): void {
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate evidence ID');
  const rows = cases.map((c) => ({
    url: sourceKey(c.source.url),
    session: c.source.session,
    split: c.split,
  }));
  for (const key of ['url', 'session'] as const) {
    const sorted = [...rows].sort((a, b) => a[key].localeCompare(b[key]));
    sorted.forEach((entry, index) => {
      const previous = sorted[index - 1];
      if (previous === undefined || entry[key] !== previous[key]) return;
      if (entry.split !== previous.split) throw new Error('Evidence source/session crosses splits');
      if (key === 'url' && entry.session !== previous.session)
        throw new Error('One source must use one session group');
    });
  }
}

function resolveName(catalog: PrintedCardCatalog, value: string): PrintedCardCatalogEntry | undefined {
  const matches = catalog.cards.filter(
    (c) => c.correctedName === value || c.name === value || c.faces.some((f) => f.name === value),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function cardIndex(catalog: PrintedCardCatalog): CardIndex {
  const aliases = new Set(
    catalog.cards.flatMap((c) => [c.correctedName, c.name, ...c.faces.map((f) => f.name)]),
  );
  return new Map([...aliases].map((alias) => [alias, resolveName(catalog, alias)]));
}

function checkPick(
  entry: Extract<EvidenceCase, { kind: 'pick' }>,
  cards: CardIndex,
): readonly AdmissionReason[] {
  const preference = entry.preference;
  if (
    preference.mode === 'explore' &&
    !LEGACY_CUBE_ADVISOR_MODEL.archetypes.some((a) => a.id === preference.archetype)
  )
    return [{ code: 'unknown-archetype', detail: preference.archetype }];
  const resolve = (value: string) => cards.get(value)!;
  const observed: ObservedDraft = {
    seats: 8,
    rounds: 3,
    packSize: 15,
    picks: entry.picks.map((n) => resolve(n).physicalId),
    observations: entry.observations.map((o) => ({ ...o, cards: o.cards.map(resolve) })),
  };
  try {
    const memory = readDraftMemory(observed);
    if (
      entry.preference.acceptable.some(
        (n) => !memory.current?.cards.some((c) => c.physicalId === resolve(n).physicalId),
      )
    ) {
      return [{ code: 'unavailable-choice', detail: 'A labeled choice is not in the current pack' }];
    }
    return [];
  } catch (error) {
    return [{ code: 'invalid-transcript', detail: error instanceof Error ? error.message : String(error) }];
  }
}

function checkDeck(
  entry: Extract<EvidenceCase, { kind: 'deck' }>,
  cards: CardIndex,
): readonly AdmissionReason[] {
  const total = entry.cards.reduce((sum, c) => sum + c.count, 0);
  const nonbasics = entry.cards.filter((c) => !BASIC_LANDS.has(c.name));
  const ids = nonbasics.map((c) => cards.get(c.name)!.physicalId);
  return [
    ...(total !== 40 ? [{ code: 'invalid-deck', detail: `Expected 40 cards, found ${String(total)}` }] : []),
    ...(new Set(ids).size !== ids.length || nonbasics.some((c) => c.count !== 1)
      ? [{ code: 'duplicate-card', detail: 'A singleton cube card appears more than once' }]
      : []),
  ];
}

function inspectCase(entry: EvidenceCase, cards: CardIndex): readonly AdmissionReason[] {
  const names =
    entry.kind === 'deck'
      ? entry.cards.map((c) => c.name).filter((n) => !BASIC_LANDS.has(n))
      : [...entry.picks, ...entry.observations.flatMap((o) => o.cards), ...entry.preference.acceptable];
  const missing = [...new Set(names)].filter((n) => cards.get(n) === undefined);
  return [
    ...(entry.source.origin !== 'human' ? [{ code: 'nonhuman-label', detail: entry.source.origin }] : []),
    ...(entry.source.environment !== 'matched'
      ? [{ code: 'environment-mismatch', detail: entry.source.environment }]
      : []),
    ...missing.map((detail) => ({ code: 'unknown-card', detail })),
    ...(missing.length ? [] : entry.kind === 'pick' ? checkPick(entry, cards) : checkDeck(entry, cards)),
  ];
}

/** Shared provenance boundary; parsing alone does not admit any evidence lane. */
export function parseEvidenceCorpus(
  input: unknown,
  catalog: PrintedCardCatalog,
  requiredSplit?: 'tuning' | 'holdout',
) {
  const corpus = corpusSchema.parse(input);
  if (requiredSplit !== undefined && corpus.cases.some((entry) => entry.split !== requiredSplit))
    throw new Error(`Expected ${requiredSplit}-only evidence, including excluded entries`);
  if (corpus.catalogSha256 !== catalog.contentSha256) throw new Error('Evidence catalog digest mismatch');
  validateSplits(corpus.cases);
  return corpus;
}

/** Every case is accounted for; excluded evidence never contributes to sample counts. */
export function admitHumanEvidence(
  input: unknown,
  catalog: PrintedCardCatalog,
  requiredSplit?: 'tuning' | 'holdout',
) {
  const corpus = parseEvidenceCorpus(input, catalog, requiredSplit);
  const cards = cardIndex(catalog);
  const checked = corpus.cases.map((entry) => ({ entry, reasons: inspectCase(entry, cards) }));
  const admitted = checked.filter((c) => c.reasons.length === 0).map((c) => c.entry);
  return {
    corpusSha256: createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),
    catalogSha256: catalog.contentSha256,
    admitted,
    excluded: checked
      .filter((c) => c.reasons.length > 0)
      .map((c) => ({ id: c.entry.id, source: c.entry.source, reasons: c.reasons })),
    counts: {
      tuning: admitted.filter((c) => c.split === 'tuning').length,
      holdout: admitted.filter((c) => c.split === 'holdout').length,
      independentSessions: new Set(admitted.map((c) => c.source.session)).size,
    },
  };
}
