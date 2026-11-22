/** Exact-printing catalog assembly, separate from Forge interaction admission. */
import { createHash } from 'node:crypto';
import { parsePrintedCardCatalog, serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import type { ScryfallCard } from '../scryfall/schemas';
import { printedCardEntry } from './entry';
import type { PrintedSetSource, PrintedSourcePin } from './source-pin';

export interface PrintedSetForgeInputs {
  readonly version: string;
  readonly scriptFor: (card: ScryfallCard) => { readonly path: string; readonly bytes: Uint8Array } | null;
}

/**
 * The name Forge's card database answers to. `CardRules.getName` joins both
 * faces only for `AlternateMode:Split`; a transform, flip, adventure or modal
 * card is registered under its front face alone, so a deck naming
 * "Screeching Bat // Stalking Vampire" does not resolve while "Dusk // Dawn" does.
 */
function forgeCardName(names: readonly string[], scriptLines: readonly string[]): string {
  const front = names[0];
  if (front === undefined) throw new Error('Forge script has no Name line');
  const alternateMode = scriptLines
    .find((line) => line.startsWith('AlternateMode:'))
    ?.slice('AlternateMode:'.length)
    .trim();
  return alternateMode === 'Split' ? names.join(' // ') : front;
}

export function buildPrintedSetCatalog(
  source: PrintedSetSource,
  pin: Pick<PrintedSourcePin, 'manifest' | 'sha256'>,
  provenanceArtifact: string,
  forge: PrintedSetForgeInputs,
) {
  const code = source.descriptor.code;
  const format = `${code.toLowerCase()}-printed-v1`;
  const printings = new Map(source.cards.map((card) => [card.id, card]));
  const uuidToScryfall = new Map<string, string>();
  const orderedIds = new Set<string>();
  for (const row of source.document.data.cards) {
    const id = row.identifiers['scryfallId'];
    const card = typeof id === 'string' ? printings.get(id) : undefined;
    if (card === undefined) throw new Error(`missing exact printing: ${code} ${row.number} ${row.name}`);
    if (
      row.setCode !== code ||
      card.name !== row.name ||
      card.collector_number !== row.number ||
      card.oracle_id !== row.identifiers['scryfallOracleId']
    )
      throw new Error(`printing identity drift: ${row.name}`);
    if (uuidToScryfall.has(row.uuid)) throw new Error(`duplicate MTGJSON UUID: ${row.uuid}`);
    uuidToScryfall.set(row.uuid, card.id);
    orderedIds.add(card.id);
  }
  if (orderedIds.size !== printings.size) throw new Error(`unaccounted Scryfall printings: ${code}`);
  const cards = [...orderedIds].map((id, index) => {
    const card = printings.get(id)!;
    const script = forge.scriptFor(card);
    if (script === null) throw new Error(`missing Forge script: ${card.name}`);
    const lines = new TextDecoder().decode(script.bytes).split(/\r?\n/);
    const names = lines.filter((line) => line.startsWith('Name:')).map((line) => line.slice(5).trim());
    if (names.join(' // ') !== card.name)
      throw new Error(`Forge name mismatch: ${card.name} (${script.path})`);
    return printedCardEntry(
      format,
      {
        position: index + 1,
        sourceName: card.name,
        correctedName: forgeCardName(names, lines),
        forgeScript: script.path,
      },
      card,
      script.bytes,
    );
  });
  const content = parsePrintedCardCatalog({
    schemaVersion: 1,
    kind: 'printed-card-catalog',
    format,
    source: {
      provenanceArtifact,
      provenanceSha256: pin.sha256,
      // Historical field names retained for the existing portable catalog contract.
      scryfallProvider: 'scryfall-search-snapshot',
      scryfallBulkFile: source.descriptor.scryfall.file,
      scryfallBulkSha256: source.descriptor.scryfall.sha256,
      scryfallBulkUpdatedAt: pin.manifest.fetchedAt,
    },
    forgeVersion: forge.version,
    cards,
    contentSha256: '0'.repeat(64),
  });
  const catalog = parsePrintedCardCatalog({
    ...content,
    contentSha256: createHash('sha256').update(serializedPrintedCardCatalogContent(content)).digest('hex'),
  });
  const physicalIds = new Map(cards.map((card) => [card.scryfallId, card.physicalId]));
  return {
    catalog,
    uuidToPhysicalId: new Map([...uuidToScryfall].map(([uuid, id]) => [uuid, physicalIds.get(id)!])),
  };
}
