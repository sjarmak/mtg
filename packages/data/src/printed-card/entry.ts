/** Shared presentation mapping; callers retain their own source-identity checks. */
import { createHash } from 'node:crypto';
import {
  PrintedCardCatalogEntrySchema,
  type PrintedCardCatalogEntry,
  type PrintedCardFace,
} from '@mtg/printed-card';
import { InvalidInputError } from '../errors';
import type { ScryfallCard } from '../scryfall/schemas';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
type Color = (typeof COLOR_ORDER)[number];
const MANA_ORDER = [...COLOR_ORDER, 'C'] as const;
type Mana = (typeof MANA_ORDER)[number];

function invalid(message: string): never {
  throw new InvalidInputError('printed-card catalog', message);
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function colorsOf(values: readonly string[] | undefined): Color[] {
  if (values === undefined) return [];
  const found = new Set(values);
  return COLOR_ORDER.filter((color) => found.has(color));
}

function manaOf(values: readonly string[] | undefined): Mana[] | null {
  if (values === undefined) return null;
  const found = new Set(values);
  return MANA_ORDER.filter((color) => found.has(color));
}

function facesOf(card: ScryfallCard): PrintedCardFace[] {
  if (card.card_faces === undefined) {
    return [
      {
        name: card.name,
        manaCost: card.mana_cost ?? null,
        typeLine: card.type_line,
        oracleText: card.oracle_text ?? null,
        power: card.power ?? null,
        toughness: card.toughness ?? null,
        loyalty: card.loyalty ?? null,
        colors: colorsOf(card.colors),
      },
    ];
  }
  return card.card_faces.map((face, index) => {
    if (face.type_line === undefined) {
      invalid(`Scryfall face ${String(index)} on ${card.name} has no type line`);
    }
    return {
      name: face.name,
      manaCost: face.mana_cost ?? null,
      typeLine: face.type_line,
      oracleText: face.oracle_text ?? null,
      power: face.power ?? null,
      toughness: face.toughness ?? null,
      loyalty: face.loyalty ?? null,
      colors: face.colors === undefined ? null : colorsOf(face.colors),
    };
  });
}

function artOf(card: ScryfallCard): PrintedCardCatalogEntry['art'] {
  if (card.image_uris !== undefined) {
    return {
      status: 'available',
      source: 'scryfall',
      scryfallId: card.id,
      images: [{ face: null, uris: card.image_uris }],
    };
  }
  const images =
    card.card_faces?.flatMap((face, index) =>
      face.image_uris === undefined ? [] : [{ face: index, uris: face.image_uris }],
    ) ?? [];
  if (images.length > 0) {
    return {
      status: 'available',
      source: 'scryfall',
      scryfallId: card.id,
      images,
    };
  }
  return {
    status: 'missing',
    source: 'scryfall',
    scryfallId: card.id,
    reason: 'the pinned Scryfall row carries no image_uris',
  };
}

export function printedCardEntry(
  format: string,
  identity: Pick<PrintedCardCatalogEntry, 'position' | 'sourceName' | 'correctedName' | 'forgeScript'>,
  card: ScryfallCard,
  script: Uint8Array,
): PrintedCardCatalogEntry {
  return PrintedCardCatalogEntrySchema.parse({
    physicalId: `${format}:${String(identity.position).padStart(4, '0')}:${card.id}`,
    position: identity.position,
    sourceName: identity.sourceName,
    correctedName: identity.correctedName,
    name: card.name,
    oracleId: card.oracle_id,
    scryfallId: card.id,
    forgeScript: identity.forgeScript,
    forgeScriptSha256: sha256(script),
    layout: card.layout,
    manaCost: card.mana_cost ?? null,
    manaValue: card.cmc,
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? null,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    colors:
      card.colors === undefined
        ? colorsOf(card.card_faces?.flatMap((face) => face.colors ?? []) ?? [])
        : colorsOf(card.colors),
    colorIdentity: colorsOf(card.color_identity),
    producedMana: manaOf(card.produced_mana),
    faces: facesOf(card),
    art: artOf(card),
  });
}
