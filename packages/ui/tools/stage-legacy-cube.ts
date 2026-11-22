/** Stages the verified portable printed-card cube without converting it to set.json. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';
import {
  LEGACY_CUBE_FORGE_READY_KIND,
  LEGACY_CUBE_FORGE_READY_SCHEMA_VERSION,
  LEGACY_CUBE_DRAFT_STRUCTURE,
  LEGACY_CUBE_OFFICIAL_POSITIONS,
  readLegacyCubeCatalog,
  readLegacyCubeForgeReadyPool,
} from '../src/routes/legacy-cube/model';
import { sha256Text } from '../src/routes/analysis/calibration-read';

export const LEGACY_CUBE_CATALOG_FILENAME = 'legacy-cube-2021-card-catalog-v1.json';
export const LEGACY_CUBE_FORGE_READY_FILENAME = 'legacy-cube-2021-forge-ready-v1.json';
export const LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME = 'legacy-cube-2021-token-printings-v1.json';

const LedgerCardSchema = z
  .object({
    corpus: z.string(),
    position: z.number().int().positive().nullable(),
    correctedName: z.string().min(1),
    forgeScript: z.string().min(1),
    forgeScriptSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    cardFamilySafe: z.boolean(),
  })
  .passthrough();

const LedgerSchema = z.object({
  forge: z.object({ version: z.string().min(1) }),
  bridgeReview: z.unknown(),
  families: z.unknown(),
  controllerSurface: z.unknown(),
  syntaxReview: z.unknown(),
  syntaxInventory: z.unknown(),
  auditedCards: z.array(LedgerCardSchema),
  runtimeProbes: z.unknown(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const LedgerContentSchema = z.object({
  bridgeReview: z.unknown(),
  families: z.unknown(),
  controllerSurface: z.unknown(),
  syntaxReview: z.unknown(),
  syntaxInventory: z.unknown(),
  auditedCards: z.unknown(),
  runtimeProbes: z.unknown(),
});

export type StagedLegacyCube =
  | { readonly status: 'absent' }
  | {
      readonly status: 'ready';
      readonly cards: number;
      readonly format: string;
      readonly forgeVersion: string;
    };

export type StagedLegacyCubeTokens =
  | { readonly status: 'absent' }
  | { readonly status: 'ready'; readonly tokens: number; readonly forgeVersion: string };

export type StagedLegacyCubeForgeReady = {
  readonly status: 'ready';
  readonly cards: number;
  readonly seats: number;
  readonly forgeVersion: string;
};

function fileSha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ledgerContentSha256(input: unknown): string {
  const ledger = LedgerContentSchema.parse(input);
  const content = {
    bridgeReview: ledger.bridgeReview,
    families: ledger.families,
    controllerSurface: ledger.controllerSurface,
    syntaxReview: ledger.syntaxReview,
    syntaxInventory: ledger.syntaxInventory,
    auditedCards: ledger.auditedCards,
    runtimeProbes: ledger.runtimeProbes,
  };
  return fileSha256(`${JSON.stringify(content)}\n`);
}

/**
 * Project the read-only decision ledger into the smallest artifact the browser
 * needs. Every official row is joined by position and exact script identity;
 * this code never decides that a card is safe.
 */
export async function stageLegacyCubeForgeReadyPool(
  catalogSource: string,
  ledgerSource: string,
  target: string,
): Promise<StagedLegacyCubeForgeReady> {
  try {
    const catalog = await readLegacyCubeCatalog(JSON.parse(readFileSync(catalogSource, 'utf8')) as unknown);
    const ledgerBytes = readFileSync(ledgerSource);
    const ledgerInput = JSON.parse(ledgerBytes.toString('utf8')) as unknown;
    const ledger = LedgerSchema.parse(ledgerInput);
    if (ledger.forge.version !== catalog.forgeVersion) {
      throw new Error(
        `Legacy Cube ledger Forge ${ledger.forge.version} does not match catalog Forge ${catalog.forgeVersion}`,
      );
    }
    const official = ledger.auditedCards.filter((card) => card.corpus === 'official-full-cardlist');
    if (official.length !== catalog.cards.length) {
      throw new Error(
        `Legacy Cube ledger has ${String(official.length)} official rows for ${String(catalog.cards.length)} catalog positions`,
      );
    }
    const byPosition = new Map(official.map((card) => [card.position, card]));
    if (byPosition.size !== catalog.cards.length || byPosition.has(null)) {
      throw new Error('Legacy Cube ledger official positions are missing or duplicated');
    }
    for (const card of catalog.cards) {
      const row = byPosition.get(card.position);
      if (
        row === undefined ||
        row.correctedName !== card.correctedName ||
        row.forgeScript !== card.forgeScript ||
        row.forgeScriptSha256 !== card.forgeScriptSha256
      ) {
        throw new Error(`Legacy Cube ledger position ${String(card.position)} does not match the catalog`);
      }
    }
    const actualLedgerContentSha256 = ledgerContentSha256(ledgerInput);
    if (actualLedgerContentSha256 !== ledger.contentSha256) {
      throw new Error(
        `Legacy Cube ledger content checksum drift: expected ${ledger.contentSha256}, got ${actualLedgerContentSha256}`,
      );
    }
    const positions = official
      .filter((card) => card.cardFamilySafe)
      .map((card) => card.position)
      .filter((position): position is number => position !== null)
      .sort((left, right) => left - right);
    if (
      catalog.cards.length !== LEGACY_CUBE_OFFICIAL_POSITIONS ||
      positions.length !== catalog.cards.length
    ) {
      throw new Error(
        `Legacy Cube Forge-ready pool must contain the complete ${String(LEGACY_CUBE_OFFICIAL_POSITIONS)}-position catalog, got ${String(positions.length)}`,
      );
    }
    const content = {
      schemaVersion: LEGACY_CUBE_FORGE_READY_SCHEMA_VERSION,
      kind: LEGACY_CUBE_FORGE_READY_KIND,
      format: catalog.format,
      forgeVersion: catalog.forgeVersion,
      catalogContentSha256: catalog.contentSha256,
      decisionLedgerContentSha256: ledger.contentSha256,
      decisionLedgerFileSha256: fileSha256(ledgerBytes),
      positions,
      cards: positions.length,
      draft: LEGACY_CUBE_DRAFT_STRUCTURE,
    } as const;
    const artifact = { ...content, contentSha256: await sha256Text(JSON.stringify(content)) };
    await readLegacyCubeForgeReadyPool(artifact, catalog);
    mkdirSync(dirname(target), { recursive: true });
    const prettierConfig = (await resolveConfig(fileURLToPath(import.meta.url))) ?? {};
    const bytes = await format(JSON.stringify(artifact), { ...prettierConfig, parser: 'json' });
    writeFileSync(target, bytes);
    return {
      status: 'ready',
      cards: positions.length,
      seats: LEGACY_CUBE_DRAFT_STRUCTURE.seats,
      forgeVersion: catalog.forgeVersion,
    };
  } catch (cause: unknown) {
    rmSync(target, { force: true });
    throw cause;
  }
}

export async function stageLegacyCubeCatalog(source: string, target: string): Promise<StagedLegacyCube> {
  if (!existsSync(source)) {
    rmSync(target, { force: true });
    return { status: 'absent' };
  }
  const bytes = readFileSync(source);
  try {
    const body: unknown = JSON.parse(bytes.toString('utf8'));
    const catalog = await readLegacyCubeCatalog(body);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return {
      status: 'ready',
      cards: catalog.cards.length,
      format: catalog.format,
      forgeVersion: catalog.forgeVersion,
    };
  } catch (cause: unknown) {
    rmSync(target, { force: true });
    throw cause;
  }
}

/**
 * The cube's token sheet, staged beside its catalog. The cube has no token set
 * of its own, so the sheet is derived from what its scripts create
 * (`packages/data/tools/fetch-token-printings.ts --catalog`); without it every
 * token a cube game makes draws the labeled pending frame.
 */
export async function stageLegacyCubeTokenPrintings(
  source: string,
  target: string,
): Promise<StagedLegacyCubeTokens> {
  if (!existsSync(source)) {
    rmSync(target, { force: true });
    return { status: 'absent' };
  }
  const bytes = readFileSync(source);
  try {
    const sheet = parsePrintedTokenPrintings(JSON.parse(bytes.toString('utf8')));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { status: 'ready', tokens: sheet.tokens.length, forgeVersion: sheet.engine.version };
  } catch (cause: unknown) {
    rmSync(target, { force: true });
    throw cause;
  }
}

export function describeLegacyCubeTokenStage(stage: StagedLegacyCubeTokens): string {
  return stage.status === 'absent'
    ? 'Legacy Cube tokens: no token sheet found; every token a cube game makes draws the pending frame.'
    : `Legacy Cube tokens: staged ${String(stage.tokens)} token printings (Forge ${stage.forgeVersion}).`;
}

export function describeLegacyCubeStage(stage: StagedLegacyCube): string {
  return stage.status === 'absent'
    ? 'Legacy Cube: portable catalog not found; the official cube route is unavailable.'
    : `Legacy Cube: staged ${String(stage.cards)} physical cards for ${stage.format} (Forge ${stage.forgeVersion}).`;
}
