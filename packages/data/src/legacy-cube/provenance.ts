/**
 * Audited provenance for the official August 2021 MTGO Legacy Cube.
 *
 * The published Full Cardlist remains byte-for-byte visible as source rows.
 * Corrections and the identities resolved from them are separate collections,
 * so neither the card store nor Forge can silently rewrite membership.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import type { DataStore } from '../store/store';

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NonemptyString = z.string().min(1);

export const LegacyCubeColorSchema = z.enum([
  'White',
  'Blue',
  'Black',
  'Red',
  'Green',
  'Dimir',
  'Gruul',
  'Orzhov',
  'Simic',
  'Izzet',
  'Selesnya',
  'Azorius',
  'Rakdos',
  'Boros',
  'Golgari',
  'Four-Color',
  'Five-Color',
  'Esper',
  'Grixis',
  'Colorless',
  'Land',
]);

export const LegacyCubeSourceRowSchema = z.object({
  position: z.number().int().positive(),
  name: NonemptyString,
  color: LegacyCubeColorSchema,
});

export const LegacyCubeChangeRowSchema = z.object({
  position: z.number().int().positive(),
  cardIn: NonemptyString,
  cardOut: NonemptyString,
});

export const LegacyCubeCorrectionSchema = z.object({
  sourceName: NonemptyString,
  correctedName: NonemptyString,
  reason: NonemptyString,
});

const ContradictionSideSchema = z.enum(['card-in-present', 'card-out-present']);
export const LegacyCubeContradictionSchema = z.object({
  cardIn: NonemptyString,
  cardOut: NonemptyString,
  changeRow: z.number().int().positive(),
  fullCardlist: ContradictionSideSchema,
  forgeCube2021August: ContradictionSideSchema,
});

export const LegacyCubeIdentitySchema = z.object({
  position: z.number().int().positive(),
  sourceName: NonemptyString,
  correctedName: NonemptyString,
  color: LegacyCubeColorSchema,
  storeOracleId: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i),
  storeName: NonemptyString,
  forgeScript: NonemptyString,
});

export const LegacyCubeProvenanceSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    url: z.literal('https://www.mtgo.com/legacy-cube-cardlist'),
    pageTitle: z.literal('Legacy Cube Cardlist'),
    publishedOn: z.null(),
    lastUpdatedOn: DateSchema,
    publicationDateEvidence: z.literal(
      "The page exposes only 'Last Updated: 8/19/2021'; no distinct publication date is present.",
    ),
    retrievedOn: DateSchema,
    rawBytes: z.number().int().positive(),
    rawSha256: Sha256Schema,
    membershipAuthority: z.literal('Full Cardlist'),
  }),
  normalization: z.object({
    version: z.literal(1),
    format: z.literal('name-tab-color-lf-v1'),
    sha256: Sha256Schema,
  }),
  sourceRows: z.array(LegacyCubeSourceRowSchema).length(600),
  changeRows: z.array(LegacyCubeChangeRowSchema).length(49),
  reviewedCorrections: z.array(LegacyCubeCorrectionSchema),
  contradictions: z.array(LegacyCubeContradictionSchema).length(3),
  store: z.object({
    provider: z.literal('Scryfall oracle_cards'),
    bulkFile: NonemptyString,
    bulkUpdatedAt: NonemptyString,
    bulkSha256: Sha256Schema,
    oracleCards: z.number().int().positive(),
    resolutionPolicy: NonemptyString,
  }),
  forge: z.object({
    version: NonemptyString,
    releaseUrl: z.url(),
    cardScriptArchiveSha256: Sha256Schema,
    cardScriptFiles: z.number().int().positive(),
    bundledCube: z.object({
      file: NonemptyString,
      sha256: Sha256Schema,
      members: z.literal(600),
    }),
    membershipAuthority: z.literal(false),
  }),
  identities: z.array(LegacyCubeIdentitySchema).length(600),
});

export type LegacyCubeColor = z.infer<typeof LegacyCubeColorSchema>;
export type LegacyCubeSourceRow = z.infer<typeof LegacyCubeSourceRowSchema>;
export type LegacyCubeChangeRow = z.infer<typeof LegacyCubeChangeRowSchema>;
export type LegacyCubeCorrection = z.infer<typeof LegacyCubeCorrectionSchema>;
export type LegacyCubeContradiction = z.infer<typeof LegacyCubeContradictionSchema>;
export type LegacyCubeIdentity = z.infer<typeof LegacyCubeIdentitySchema>;
export type LegacyCubeProvenance = z.infer<typeof LegacyCubeProvenanceSchema>;

export interface ParsedLegacyCubePage {
  readonly lastUpdatedOn: string;
  readonly sourceRows: readonly LegacyCubeSourceRow[];
  readonly changeRows: readonly LegacyCubeChangeRow[];
}

export interface CorrectedLegacyCubeRow extends LegacyCubeSourceRow {
  readonly sourceName: string;
  readonly correctedName: string;
}

export interface StoreIdentityMatch {
  readonly oracleId: string;
  readonly storedName: string;
}

export interface ForgeScriptEntry {
  readonly name: string;
  readonly path: string;
}

interface StoreRow {
  readonly oracleId: string;
  readonly storedName: string;
}

export const LEGACY_CUBE_PROVENANCE_PATH = fileURLToPath(
  new URL('../../data/legacy-cube-2021-v1.json', import.meta.url),
);

const REQUIRED_CORRECTION: LegacyCubeCorrection = {
  sourceName: 'Sulfuric Vortext',
  correctedName: 'Sulfuric Vortex',
  reason: 'The Full Cardlist misspells the printed card name; the Changes table spells it correctly.',
};

const REQUIRED_CONTRADICTIONS: readonly LegacyCubeContradiction[] = [
  {
    cardIn: 'Lonis, Cryptozoologist',
    cardOut: 'Oko, Thief of Crowns',
    changeRow: 37,
    fullCardlist: 'card-out-present',
    forgeCube2021August: 'card-in-present',
  },
  {
    cardIn: 'Palace Jailer',
    cardOut: 'Sublime Archangel',
    changeRow: 7,
    fullCardlist: 'card-out-present',
    forgeCube2021August: 'card-in-present',
  },
  {
    cardIn: 'Prismatic Vista',
    cardOut: 'Prismatic Lens',
    changeRow: 48,
    fullCardlist: 'card-in-present',
    forgeCube2021August: 'card-out-present',
  },
];

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Canonical row bytes fixed before implementation: `name<TAB>color<LF>`. */
export function normalizeLegacyCubeRows(rows: readonly LegacyCubeSourceRow[]): string {
  return rows.map((row) => `${row.name}\t${row.color}\n`).join('');
}

export function normalizedLegacyCubeRowsSha256(rows: readonly LegacyCubeSourceRow[]): string {
  return sha256(normalizeLegacyCubeRows(rows));
}

function htmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_whole, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_whole, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableBodyAfterHeading(html: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(
      `<h1\\s+class=["']accordion["']><em>Legacy Cube<\\/em>\\s+${escaped}<\\/h1>` +
        `\\s*<table[^>]*>[\\s\\S]*?<tbody>([\\s\\S]*?)<\\/tbody>`,
      'i',
    ),
  );
  if (match?.[1] === undefined) throw new InvalidInputError('Legacy Cube page', `missing ${heading} table`);
  return match[1];
}

function twoColumnRows(body: string): readonly [string, string][] {
  const rows: [string, string][] = [];
  const pattern = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  for (const match of body.matchAll(pattern)) {
    const left = match[1];
    const right = match[2];
    if (left !== undefined && right !== undefined) rows.push([htmlText(left), htmlText(right)]);
  }
  return rows;
}

/** Extracts only the rendered article tables, never the escaped JSON-LD duplicate. */
export function parseLegacyCubePage(bytes: Uint8Array): ParsedLegacyCubePage {
  let html: string;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new InvalidInputError(
      'Legacy Cube page',
      cause instanceof Error ? `not UTF-8: ${cause.message}` : 'not UTF-8',
    );
  }
  const date = html.match(/Last Updated:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (date?.[1] === undefined || date[2] === undefined || date[3] === undefined) {
    throw new InvalidInputError('Legacy Cube page', 'missing Last Updated date');
  }
  const lastUpdatedOn = `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}`;
  const sourceRows = twoColumnRows(tableBodyAfterHeading(html, 'Full Cardlist')).map(([name, color], index) =>
    LegacyCubeSourceRowSchema.parse({ position: index + 1, name, color }),
  );
  const changeRows = twoColumnRows(tableBodyAfterHeading(html, 'Cardlist Changes')).map(
    ([cardIn, cardOut], index) => ({ position: index + 1, cardIn, cardOut }),
  );
  return { lastUpdatedOn, sourceRows, changeRows };
}

export function correctedLegacyCubeRows(artifact: LegacyCubeProvenance): readonly CorrectedLegacyCubeRow[] {
  const corrections = new Map(
    artifact.reviewedCorrections.map((correction) => [correction.sourceName, correction.correctedName]),
  );
  return artifact.sourceRows.map((row) => ({
    ...row,
    sourceName: row.name,
    correctedName: corrections.get(row.name) ?? row.name,
  }));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value))
      throw new InvalidInputError('Legacy Cube provenance', `duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

/** Schema plus cross-field invariants which JSON Schema cannot express. */
export function verifyLegacyCubeProvenance(input: LegacyCubeProvenance): void {
  if (!Array.isArray(input.sourceRows) || input.sourceRows.length !== 600) {
    throw new InvalidInputError(
      'Legacy Cube provenance',
      `Full Cardlist must contain exactly 600 rows, found ${String(input.sourceRows?.length ?? 0)}`,
    );
  }
  if (!Array.isArray(input.changeRows) || input.changeRows.length !== 49) {
    throw new InvalidInputError(
      'Legacy Cube provenance',
      `page must contain exactly 49 Changes rows, found ${String(input.changeRows?.length ?? 0)}`,
    );
  }
  const parsed = LegacyCubeProvenanceSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError('Legacy Cube provenance', parsed.error.message);
  const artifact = parsed.data;

  for (const [index, row] of artifact.sourceRows.entries()) {
    if (row.position !== index + 1) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `source position ${String(row.position)} is out of order`,
      );
    }
  }
  assertUnique(
    artifact.sourceRows.map((row) => row.name),
    'Full Cardlist name',
  );
  const actualNormalized = normalizedLegacyCubeRowsSha256(artifact.sourceRows);
  if (actualNormalized !== artifact.normalization.sha256) {
    throw new InvalidInputError(
      'Legacy Cube provenance',
      `normalized row checksum drift: expected ${artifact.normalization.sha256}, got ${actualNormalized}`,
    );
  }
  if (!sameJson(artifact.reviewedCorrections, [REQUIRED_CORRECTION])) {
    throw new InvalidInputError(
      'Legacy Cube provenance',
      'unrecorded correction for Sulfuric Vortext; the only reviewed identity is Sulfuric Vortex',
    );
  }

  const corrected = correctedLegacyCubeRows(artifact);
  assertUnique(
    corrected.map((row) => row.correctedName),
    'corrected card name',
  );
  for (const [index, row] of corrected.entries()) {
    const identity = artifact.identities[index];
    if (
      identity === undefined ||
      identity.position !== row.position ||
      identity.sourceName !== row.sourceName ||
      identity.correctedName !== row.correctedName ||
      identity.color !== row.color
    ) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `identity ${String(index + 1)} does not match its corrected source row`,
      );
    }
  }
  assertUnique(
    artifact.identities.map((row) => row.storeOracleId),
    'store oracle id',
  );
  assertUnique(
    artifact.identities.map((row) => row.forgeScript),
    'Forge script path',
  );

  if (!sameJson(artifact.contradictions, REQUIRED_CONTRADICTIONS)) {
    throw new InvalidInputError('Legacy Cube provenance', 'the three reviewed source contradictions drifted');
  }
  const sourceNames = new Set(corrected.map((row) => row.correctedName));
  for (const contradiction of artifact.contradictions) {
    const change = artifact.changeRows[contradiction.changeRow - 1];
    if (change?.cardIn !== contradiction.cardIn || change.cardOut !== contradiction.cardOut) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `Changes table row ${String(contradiction.changeRow)} does not match its contradiction record`,
      );
    }
    const expectedFull =
      contradiction.fullCardlist === 'card-in-present' ? contradiction.cardIn : contradiction.cardOut;
    const excludedFull =
      contradiction.fullCardlist === 'card-in-present' ? contradiction.cardOut : contradiction.cardIn;
    if (!sourceNames.has(expectedFull) || sourceNames.has(excludedFull)) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `Full Cardlist membership does not support contradiction ${contradiction.cardIn}/${contradiction.cardOut}`,
      );
    }
  }
}

/** Checks a supplied or explicitly fetched page snapshot against every pinned page fact. */
export function verifyLegacyCubeSnapshot(artifact: LegacyCubeProvenance, snapshot: Uint8Array): void {
  verifyLegacyCubeProvenance(artifact);
  const page = parseLegacyCubePage(snapshot);
  if (page.lastUpdatedOn !== artifact.source.lastUpdatedOn) {
    throw new InvalidInputError('Legacy Cube snapshot', 'Last Updated date drift');
  }
  if (!sameJson(page.sourceRows, artifact.sourceRows)) {
    throw new InvalidInputError('Legacy Cube snapshot', 'Full Cardlist membership, order, or color drift');
  }
  if (!sameJson(page.changeRows, artifact.changeRows)) {
    throw new InvalidInputError('Legacy Cube snapshot', 'Changes table drift');
  }
  const actualHash = sha256(snapshot);
  if (snapshot.byteLength !== artifact.source.rawBytes || actualHash !== artifact.source.rawSha256) {
    throw new InvalidInputError(
      'Legacy Cube snapshot',
      `raw response checksum drift: expected ${artifact.source.rawSha256}/${String(artifact.source.rawBytes)} bytes, ` +
        `got ${actualHash}/${String(snapshot.byteLength)} bytes`,
    );
  }
}

/** Proves each corrected name resolves once and to the pinned store identity. */
export function verifyStoreIdentityLookup(
  artifact: LegacyCubeProvenance,
  lookup: (correctedName: string) => readonly StoreIdentityMatch[],
): void {
  verifyLegacyCubeProvenance(artifact);
  for (const identity of artifact.identities) {
    const matches = lookup(identity.correctedName);
    if (matches.length === 0) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `unresolved store identity: ${identity.correctedName}`,
      );
    }
    if (matches.length !== 1) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `ambiguous store identity: ${identity.correctedName} resolved ${String(matches.length)} times`,
      );
    }
    const match = matches[0]!;
    if (match.oracleId !== identity.storeOracleId || match.storedName !== identity.storeName) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `store identity drift: ${identity.correctedName}`,
      );
    }
  }
}

/**
 * Store lookup used by the command-line verifier. The Full Cardlist names the
 * front face of modal and transforming cards, while Scryfall stores the joined
 * identity. Non-playable token, art-series, and reversible-display rows are
 * excluded so they cannot make a real card look ambiguous.
 */
export function findLegacyCubeStoreIdentities(
  store: DataStore,
  correctedName: string,
): readonly StoreIdentityMatch[] {
  const exact = store.db
    .prepare<[string], StoreRow>(
      `SELECT oracle_id AS oracleId, name AS storedName
       FROM oracle_card INDEXED BY oracle_card_name_idx
       WHERE source = 'scryfall'
         AND layout NOT IN ('token', 'art_series', 'reversible_card')
         AND name = ? COLLATE NOCASE
       ORDER BY oracle_id`,
    )
    .all(correctedName);
  const joinedFront = store.db
    .prepare<[string, string], StoreRow>(
      `SELECT oracle_id AS oracleId, name AS storedName
       FROM oracle_card INDEXED BY oracle_card_name_idx
       WHERE source = 'scryfall'
         AND layout NOT IN ('token', 'art_series', 'reversible_card')
         AND name >= ? COLLATE NOCASE
         AND name < ? COLLATE NOCASE
       ORDER BY oracle_id`,
    )
    .all(`${correctedName} // `, `${correctedName} // \uffff`);
  return [...exact, ...joinedFront];
}

/** Validates the store population pin before checking all 600 identities. */
export function verifyLegacyCubeStore(artifact: LegacyCubeProvenance, store: DataStore): void {
  const stats = store.db
    .prepare<[], { count: number; minimum: string | null; maximum: string | null }>(
      `SELECT COUNT(*) AS count, MIN(bulk_updated_at) AS minimum, MAX(bulk_updated_at) AS maximum
       FROM oracle_card WHERE source = 'scryfall'`,
    )
    .get();
  if (
    stats === undefined ||
    stats.count !== artifact.store.oracleCards ||
    stats.minimum !== artifact.store.bulkUpdatedAt ||
    stats.maximum !== artifact.store.bulkUpdatedAt
  ) {
    throw new InvalidInputError(
      'Legacy Cube store',
      `population pin drift: expected ${String(artifact.store.oracleCards)} rows at ` +
        `${artifact.store.bulkUpdatedAt}, got ${String(stats?.count ?? 0)} rows at ` +
        `${String(stats?.minimum)}..${String(stats?.maximum)}`,
    );
  }
  verifyStoreIdentityLookup(artifact, (name) => findLegacyCubeStoreIdentities(store, name));
}

/** Proves each corrected name owns exactly one card script and that its path is pinned. */
export function verifyForgeScriptEntries(
  artifact: LegacyCubeProvenance,
  entries: readonly ForgeScriptEntry[],
): void {
  verifyLegacyCubeProvenance(artifact);
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    const paths = byName.get(entry.name) ?? [];
    paths.push(entry.path);
    byName.set(entry.name, paths);
  }
  for (const identity of artifact.identities) {
    const paths = byName.get(identity.correctedName) ?? [];
    if (paths.length === 0) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `missing Forge script: ${identity.correctedName}`,
      );
    }
    if (paths.length !== 1) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `duplicate Forge script: ${identity.correctedName}`,
      );
    }
    if (paths[0] !== identity.forgeScript) {
      throw new InvalidInputError(
        'Legacy Cube provenance',
        `Forge script path drift: ${identity.correctedName}`,
      );
    }
  }
}

/** Reads Forge's `.dck` main section without treating its printing codes as identities. */
export function parseForgeCubeDeck(bytes: Uint8Array): readonly string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const names: string[] = [];
  let inMain = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '[Main]') {
      inMain = true;
      continue;
    }
    if (line.startsWith('[')) {
      inMain = false;
      continue;
    }
    if (!inMain || line.length === 0) continue;
    const match = line.match(/^1\s+(.+)\|[^|]+$/);
    if (match?.[1] === undefined) {
      throw new InvalidInputError('Forge Legacy Cube deck', `unsupported main-deck row: ${line}`);
    }
    names.push(match[1]);
  }
  return names;
}

/** Confirms the bundled Forge cube differs from the authority by only the three recorded pairs. */
export function verifyForgeCubeSnapshot(artifact: LegacyCubeProvenance, bytes: Uint8Array): void {
  verifyLegacyCubeProvenance(artifact);
  const actualHash = sha256(bytes);
  if (actualHash !== artifact.forge.bundledCube.sha256) {
    throw new InvalidInputError(
      'Forge Legacy Cube deck',
      `checksum drift: expected ${artifact.forge.bundledCube.sha256}, got ${actualHash}`,
    );
  }
  const names = parseForgeCubeDeck(bytes);
  if (names.length !== artifact.forge.bundledCube.members) {
    throw new InvalidInputError(
      'Forge Legacy Cube deck',
      `expected ${String(artifact.forge.bundledCube.members)} members, found ${String(names.length)}`,
    );
  }
  assertUnique(names, 'Forge cube member');
  const official = correctedLegacyCubeRows(artifact).map((row) => row.correctedName);
  const officialSet = new Set(official);
  const forgeSet = new Set(names);
  const officialOnly = official.filter((name) => !forgeSet.has(name)).sort();
  const forgeOnly = names.filter((name) => !officialSet.has(name)).sort();
  const expectedOfficialOnly = artifact.contradictions
    .map((row) => (row.fullCardlist === 'card-in-present' ? row.cardIn : row.cardOut))
    .sort();
  const expectedForgeOnly = artifact.contradictions
    .map((row) => (row.forgeCube2021August === 'card-in-present' ? row.cardIn : row.cardOut))
    .sort();
  if (!sameJson(officialOnly, expectedOfficialOnly) || !sameJson(forgeOnly, expectedForgeOnly)) {
    throw new InvalidInputError(
      'Forge Legacy Cube deck',
      'membership differences exceed the three recorded pairs',
    );
  }
}

export function loadLegacyCubeProvenance(path: string = LEGACY_CUBE_PROVENANCE_PATH): LegacyCubeProvenance {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Legacy Cube provenance',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  const parsed = LegacyCubeProvenanceSchema.safeParse(value);
  if (!parsed.success)
    throw new InvalidInputError('Legacy Cube provenance', `${path}: ${parsed.error.message}`);
  verifyLegacyCubeProvenance(parsed.data);
  return parsed.data;
}
