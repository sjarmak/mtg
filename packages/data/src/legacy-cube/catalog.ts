/** Deterministic portable presentation catalog for the official 2021 Legacy Cube. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parsePrintedCardCatalog,
  serializedPrintedCardCatalogContent,
  type PrintedCardCatalog,
  type PrintedCardCatalogEntry,
} from '@mtg/printed-card';
import { InvalidInputError } from '../errors';
import { printedCardEntry } from '../printed-card/entry';
import type { ScryfallCard } from '../scryfall/schemas';
import type { LegacyCubeProvenance } from './provenance';
import { loadLegacyCubeProvenance, verifyLegacyCubeProvenance } from './provenance';

const FORMAT = 'legacy-cube-2021-08';
const PROVENANCE_FILE = 'legacy-cube-2021-v1.json';
export const LEGACY_CUBE_PRINTED_CATALOG_PATH = fileURLToPath(
  new URL('../../data/legacy-cube-2021-card-catalog-v1.json', import.meta.url),
);
export const LEGACY_CUBE_PRINTED_CATALOG_SHA256 =
  '34691fed926e033da3630717d88294ccc2d22eb8cb88be0ad4f55a68fd5d22c6';
export interface LegacyCubeCatalogInputs {
  readonly resolveCard: (oracleId: string) => ScryfallCard | null;
  readonly readForgeScript: (path: string) => Uint8Array | null;
}

function invalid(message: string): never {
  throw new InvalidInputError('Legacy Cube printed-card catalog', message);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function provenanceSha256(provenance: LegacyCubeProvenance): string {
  return sha256(`${JSON.stringify(provenance, null, 2)}\n`);
}

function cardEntry(
  identity: LegacyCubeProvenance['identities'][number],
  inputs: LegacyCubeCatalogInputs,
): PrintedCardCatalogEntry {
  const card = inputs.resolveCard(identity.storeOracleId);
  if (card === null) invalid(`missing pinned Scryfall row for ${identity.correctedName}`);
  if (card.oracle_id !== identity.storeOracleId) {
    invalid(`Oracle identity drift for ${identity.correctedName}`);
  }
  if (card.name !== identity.storeName) {
    invalid(
      `stored name drift for ${identity.correctedName}: expected ${identity.storeName}, got ${card.name}`,
    );
  }
  const script = inputs.readForgeScript(identity.forgeScript);
  if (script === null) invalid(`missing Forge script for ${identity.correctedName}`);
  return printedCardEntry(FORMAT, identity, card, script);
}

export function buildLegacyCubePrintedCatalog(
  provenance: LegacyCubeProvenance,
  inputs: LegacyCubeCatalogInputs,
): PrintedCardCatalog {
  verifyLegacyCubeProvenance(provenance);
  const cards = provenance.identities.map((identity) => cardEntry(identity, inputs));
  const withoutHash = {
    schemaVersion: 1 as const,
    kind: 'printed-card-catalog' as const,
    format: FORMAT,
    source: {
      provenanceArtifact: PROVENANCE_FILE,
      provenanceSha256: provenanceSha256(provenance),
      scryfallProvider: provenance.store.provider,
      scryfallBulkFile: provenance.store.bulkFile,
      scryfallBulkSha256: provenance.store.bulkSha256,
      scryfallBulkUpdatedAt: provenance.store.bulkUpdatedAt,
    },
    forgeVersion: provenance.forge.version,
    cards,
    contentSha256: '0'.repeat(64),
  };
  const parsed = parsePrintedCardCatalog(withoutHash);
  const catalog = parsePrintedCardCatalog({
    ...withoutHash,
    contentSha256: sha256(serializedPrintedCardCatalogContent(parsed)),
  });
  verifyLegacyCubePrintedCatalog(catalog, provenance);
  return catalog;
}

export function verifyLegacyCubePrintedCatalog(input: unknown, provenance: LegacyCubeProvenance): void {
  verifyLegacyCubeProvenance(provenance);
  const catalog = parsePrintedCardCatalog(input);
  if (catalog.format !== FORMAT) invalid(`format drift: ${catalog.format}`);
  if (catalog.cards.length !== provenance.identities.length) {
    invalid(
      `expected ${String(provenance.identities.length)} positions, found ${String(catalog.cards.length)}`,
    );
  }
  const expectedProvenanceHash = provenanceSha256(provenance);
  if (
    catalog.source.provenanceArtifact !== PROVENANCE_FILE ||
    catalog.source.provenanceSha256 !== expectedProvenanceHash
  ) {
    invalid('provenance artifact identity drift');
  }
  if (
    catalog.source.scryfallProvider !== provenance.store.provider ||
    catalog.source.scryfallBulkFile !== provenance.store.bulkFile ||
    catalog.source.scryfallBulkSha256 !== provenance.store.bulkSha256 ||
    catalog.source.scryfallBulkUpdatedAt !== provenance.store.bulkUpdatedAt
  ) {
    invalid('pinned Scryfall source drift');
  }
  if (catalog.forgeVersion !== provenance.forge.version) invalid('Forge version drift');

  const oracleIds = new Set<string>();
  const scryfallIds = new Set<string>();
  for (const [index, card] of catalog.cards.entries()) {
    const identity = provenance.identities[index];
    if (
      identity === undefined ||
      card.position !== identity.position ||
      card.sourceName !== identity.sourceName ||
      card.correctedName !== identity.correctedName ||
      card.name !== identity.storeName ||
      card.oracleId !== identity.storeOracleId ||
      card.forgeScript !== identity.forgeScript
    ) {
      invalid(`identity drift at position ${String(index + 1)}`);
    }
    if (oracleIds.has(card.oracleId)) invalid(`duplicate Oracle identity at position ${String(index + 1)}`);
    if (scryfallIds.has(card.scryfallId)) {
      invalid(`duplicate Scryfall identity at position ${String(index + 1)}`);
    }
    oracleIds.add(card.oracleId);
    scryfallIds.add(card.scryfallId);
  }

  const actualHash = sha256(serializedPrintedCardCatalogContent(catalog));
  if (actualHash !== catalog.contentSha256) {
    invalid(`checksum drift: expected ${catalog.contentSha256}, got ${actualHash}`);
  }
}

export function loadLegacyCubePrintedCatalog(
  path: string = LEGACY_CUBE_PRINTED_CATALOG_PATH,
  provenance: LegacyCubeProvenance = loadLegacyCubeProvenance(),
): PrintedCardCatalog {
  const bytes = readFileSync(path);
  if (path === LEGACY_CUBE_PRINTED_CATALOG_PATH) {
    const actualHash = sha256(bytes);
    if (actualHash !== LEGACY_CUBE_PRINTED_CATALOG_SHA256) {
      invalid(
        `committed artifact checksum drift: expected ${LEGACY_CUBE_PRINTED_CATALOG_SHA256}, got ${actualHash}`,
      );
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (cause) {
    invalid(cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`);
  }
  const catalog = parsePrintedCardCatalog(value);
  verifyLegacyCubePrintedCatalog(catalog, provenance);
  return catalog;
}
