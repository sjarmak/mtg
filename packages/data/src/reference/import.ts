/** Validate, classify, and normalize checksum-pinned MTGJSON set documents. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { InvalidInputError, RemoteShapeError } from '../errors';
import { createHttpClient, type HttpClient } from '../http/client';
import type { ReferenceSetSource } from './manifest';
import {
  MtgjsonSetFileSchema,
  ReferenceCorpusSchema,
  ReferenceSetSchema,
  type MtgjsonSetFile,
  type ReferenceCard,
  type ReferenceCardRole,
  type ReferenceCorpus,
  type ReferenceSet,
  type ReferenceToken,
} from './schemas';

export interface ReferenceSourceBytes {
  readonly source: ReferenceSetSource;
  readonly bytes: Uint8Array;
}

export interface FetchReferenceSetOptions {
  readonly cacheDir: string;
  readonly client?: HttpClient;
}

export interface WriteReferenceCorpusOptions {
  readonly format?: (json: string) => string | Promise<string>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeJson(bytes: Uint8Array, source: ReferenceSetSource): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (cause) {
    throw new RemoteShapeError(
      source.url,
      cause instanceof Error ? `invalid JSON: ${cause.message}` : 'invalid JSON',
    );
  }
}

function parseRaw(bytes: Uint8Array, source: ReferenceSetSource): MtgjsonSetFile {
  const actualHash = sha256(bytes);
  if (actualHash !== source.sha256) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `checksum mismatch: expected ${source.sha256}, got ${actualHash}`,
    );
  }
  const parsed = MtgjsonSetFileSchema.safeParse(decodeJson(bytes, source));
  if (!parsed.success) throw new RemoteShapeError(source.url, parsed.error.message);
  return parsed.data;
}

function collectorPosition(number: string): number | null {
  if (!/^\d+$/.test(number)) return null;
  const value = Number.parseInt(number, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const ALTERNATE_PROMO_TYPES = new Set([
  'boosterfun',
  'borderless',
  'etched',
  'extendedart',
  'fullart',
  'retroframe',
  'showcase',
]);

function rolesFor(card: MtgjsonSetFile['data']['cards'][number], baseSetSize: number): ReferenceCardRole[] {
  const position = collectorPosition(card.number);
  const roles: ReferenceCardRole[] = [
    position !== null && position <= baseSetSize ? 'main-set' : 'ancillary',
  ];
  if (card.isPromo === true) roles.push('promo');
  if (
    card.isAlternative === true ||
    (card.promoTypes ?? []).some((promoType) => ALTERNATE_PROMO_TYPES.has(promoType))
  ) {
    roles.push('alternate-treatment');
  }
  return roles;
}

type RawCard = MtgjsonSetFile['data']['cards'][number];
type RawToken = MtgjsonSetFile['data']['tokens'][number];

function commonFields(card: RawCard | RawToken): Omit<ReferenceCard, 'rarity' | 'roles'> {
  return {
    uuid: card.uuid,
    name: card.name,
    number: card.number,
    setCode: card.setCode,
    identifiers: card.identifiers,
    availability: card.availability,
    boosterTypes: card.boosterTypes ?? [],
    promoTypes: card.promoTypes ?? [],
    ...(card.side === undefined ? {} : { side: card.side }),
    otherFaceIds: card.otherFaceIds ?? [],
    ...(card.layout === undefined ? {} : { layout: card.layout }),
    ...(card.manaCost === undefined ? {} : { manaCost: card.manaCost }),
    ...(card.manaValue === undefined ? {} : { manaValue: card.manaValue }),
    ...(card.text === undefined ? {} : { text: card.text }),
    ...(card.originalText === undefined ? {} : { originalText: card.originalText }),
    ...(card.type === undefined ? {} : { type: card.type }),
    ...(card.originalType === undefined ? {} : { originalType: card.originalType }),
    types: card.types ?? [],
    supertypes: card.supertypes ?? [],
    subtypes: card.subtypes ?? [],
    colors: card.colors ?? [],
    colorIdentity: card.colorIdentity ?? [],
    keywords: card.keywords ?? [],
    ...(card.power === undefined ? {} : { power: card.power }),
    ...(card.toughness === undefined ? {} : { toughness: card.toughness }),
    ...(card.loyalty === undefined ? {} : { loyalty: card.loyalty }),
  };
}

function normalizeCard(card: RawCard, baseSetSize: number): ReferenceCard {
  return { ...commonFields(card), rarity: card.rarity, roles: rolesFor(card, baseSetSize) };
}

function normalizeToken(token: RawToken): ReferenceToken {
  return { ...commonFields(token), roles: ['token'] };
}

function assertIdentity(raw: MtgjsonSetFile, source: ReferenceSetSource): void {
  if (raw.data.code !== source.code) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected set ${source.code}, got ${raw.data.code}`,
    );
  }
  if (raw.data.name !== source.name) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected name ${source.name}, got ${raw.data.name}`,
    );
  }
  if (raw.meta.version !== source.version) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected MTGJSON build ${source.version}, got ${raw.meta.version}`,
    );
  }
  if (raw.meta.date !== source.builtDate) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected MTGJSON date ${source.builtDate}, got ${raw.meta.date}`,
    );
  }
  if (raw.data.baseSetSize !== source.baseSetSize) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected base set size ${source.baseSetSize}, got ${raw.data.baseSetSize}`,
    );
  }
  if (raw.data.cards.length !== source.cardRecords) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected ${source.cardRecords} card records, got ${raw.data.cards.length}`,
    );
  }
  if (raw.data.tokens.length !== source.tokenRecords) {
    throw new InvalidInputError(
      `${source.code} reference source`,
      `expected ${source.tokenRecords} token records, got ${raw.data.tokens.length}`,
    );
  }
}

function assertCompleteMainSet(raw: MtgjsonSetFile, source: ReferenceSetSource): void {
  const positions = new Set(
    raw.data.cards
      .map((card) => collectorPosition(card.number))
      .filter((position): position is number => position !== null && position <= raw.data.baseSetSize),
  );
  const missing: number[] = [];
  for (let position = 1; position <= raw.data.baseSetSize; position += 1) {
    if (!positions.has(position)) missing.push(position);
  }
  if (missing.length > 0 || positions.size !== raw.data.baseSetSize) {
    const first = missing.slice(0, 10).join(', ');
    throw new InvalidInputError(
      `${source.code} main-set collector positions`,
      `expected 1-${raw.data.baseSetSize}; missing ${first}${missing.length > 10 ? ', ...' : ''}`,
    );
  }
}

function assertDraftBooster(raw: MtgjsonSetFile, source: ReferenceSetSource): void {
  const draft = raw.data.booster['draft'];
  if (draft === undefined) {
    throw new InvalidInputError(`${source.code} reference source`, 'missing draft booster configuration');
  }
  if (draft.sourceSetCodes.some((code) => code !== source.code)) {
    throw new InvalidInputError(
      `${source.code} draft booster`,
      `references source sets ${draft.sourceSetCodes.join(', ')}; this pinned file can resolve only ${source.code}`,
    );
  }
  const known = new Set(raw.data.cards.map((card) => card.uuid));
  for (const [sheetName, sheet] of Object.entries(draft.sheets)) {
    const total = Object.values(sheet.cards).reduce((sum, weight) => sum + weight, 0);
    if (total !== sheet.totalWeight) {
      throw new InvalidInputError(
        `${source.code} draft booster`,
        `sheet ${sheetName} totalWeight is ${sheet.totalWeight}, card weights sum to ${total}`,
      );
    }
    for (const uuid of Object.keys(sheet.cards)) {
      if (!known.has(uuid)) {
        throw new InvalidInputError(
          `${source.code} draft booster`,
          `sheet ${sheetName} references unknown card uuid ${uuid}`,
        );
      }
    }
  }
  for (const booster of draft.boosters) {
    for (const sheetName of Object.keys(booster.contents)) {
      if (draft.sheets[sheetName] === undefined) {
        throw new InvalidInputError(
          `${source.code} draft booster`,
          `pack references unknown sheet ${sheetName}`,
        );
      }
    }
  }
  const boosterWeight = draft.boosters.reduce((sum, booster) => sum + booster.weight, 0);
  if (boosterWeight !== draft.boostersTotalWeight) {
    throw new InvalidInputError(
      `${source.code} draft booster`,
      `boostersTotalWeight is ${draft.boostersTotalWeight}, pack weights sum to ${boosterWeight}`,
    );
  }
}

export function parseReferenceSetSource(bytes: Uint8Array, source: ReferenceSetSource): ReferenceSet {
  const raw = parseRaw(bytes, source);
  assertIdentity(raw, source);
  assertCompleteMainSet(raw, source);
  assertDraftBooster(raw, source);
  const draftBooster = raw.data.booster['draft'];
  if (draftBooster === undefined) throw new Error('draft booster invariant failed');
  return ReferenceSetSchema.parse({
    code: raw.data.code,
    name: raw.data.name,
    sourceUrl: source.url,
    releaseDate: raw.data.releaseDate,
    setType: raw.data.type,
    sourceSha256: source.sha256,
    mainSetSize: raw.data.baseSetSize,
    totalSetSize: raw.data.totalSetSize,
    cards: raw.data.cards.map((card) => normalizeCard(card, raw.data.baseSetSize)),
    tokens: raw.data.tokens.map(normalizeToken),
    draftBooster,
  });
}

export function buildReferenceCorpus(inputs: readonly ReferenceSourceBytes[]): ReferenceCorpus {
  if (inputs.length === 0) throw new InvalidInputError('reference corpus', 'at least one source is required');
  const versions = new Set(inputs.map((input) => input.source.version));
  const dates = new Set(inputs.map((input) => input.source.builtDate));
  if (versions.size !== 1 || dates.size !== 1) {
    throw new InvalidInputError('reference corpus', 'all sets must come from one MTGJSON build and date');
  }
  const first = inputs[0];
  if (first === undefined) throw new Error('nonempty input invariant failed');
  return ReferenceCorpusSchema.parse({
    schemaVersion: 1,
    source: {
      provider: 'MTGJSON',
      license: 'MIT',
      licenseUrl: 'https://mtgjson.com/license/',
      version: first.source.version,
      builtDate: first.source.builtDate,
    },
    sets: inputs.map((input) => parseReferenceSetSource(input.bytes, input.source)),
  });
}

async function readIfPresent(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return null;
    }
    throw cause;
  }
}

function cacheName(source: ReferenceSetSource): string {
  return `${source.code}-${source.sha256}.json`;
}

async function fetchSource(client: HttpClient, source: ReferenceSetSource): Promise<Uint8Array> {
  const { body } = await client.getStream(source.url);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * Fetches one complete MTGJSON document per set into a gitignored cache. A
 * cached file is always checksum- and schema-validated before reuse; corruption
 * is surfaced rather than hidden by an automatic replacement.
 */
export async function fetchReferenceSetSources(
  sources: readonly ReferenceSetSource[],
  options: FetchReferenceSetOptions,
): Promise<ReferenceSourceBytes[]> {
  const client = options.client ?? createHttpClient();
  await mkdir(options.cacheDir, { recursive: true });
  const result: ReferenceSourceBytes[] = [];
  for (const source of sources) {
    const target = join(options.cacheDir, cacheName(source));
    const cached = await readIfPresent(target);
    if (cached !== null) {
      parseReferenceSetSource(cached, source);
      result.push({ source, bytes: cached });
      continue;
    }

    const bytes = await fetchSource(client, source);
    parseReferenceSetSource(bytes, source);
    const partial = `${target}.part`;
    try {
      await writeFile(partial, bytes);
      await rename(partial, target);
    } catch (cause) {
      await rm(partial, { force: true });
      throw cause;
    }
    result.push({ source, bytes });
  }
  return result;
}

/** Writes the normalized artifact atomically and with stable JSON formatting. */
export async function writeReferenceCorpus(
  path: string,
  corpus: ReferenceCorpus,
  options: WriteReferenceCorpusOptions = {},
): Promise<void> {
  const checked = ReferenceCorpusSchema.parse(corpus);
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.part`;
  try {
    const json = `${JSON.stringify(checked, null, 2)}\n`;
    await writeFile(partial, options.format === undefined ? json : await options.format(json), 'utf8');
    await rename(partial, path);
  } catch (cause) {
    await rm(partial, { force: true });
    throw cause;
  }
}
