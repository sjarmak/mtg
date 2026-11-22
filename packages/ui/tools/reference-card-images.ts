/**
 * Illustration crops for reduced official sets, joined by printing identity.
 *
 * A reduced reference document deliberately contains executable DSL cards,
 * not printing records. The committed reference corpus contains the missing
 * half: set code, collector number, and a pinned Scryfall id. This staging-only
 * join keeps `@mtg/data` and its SQLite dependency out of the browser while
 * making the choice of a printed face explicit. Names are display copy here;
 * they are never identity.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArtManifestSchema } from '@mtg/render-spec';
import type { ArtManifest, ArtManifestEntry } from '@mtg/render-spec';

const SCRYFALL_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

export interface ReferencePrintingCard {
  readonly name: string;
  readonly number: string;
  readonly layout: string;
  readonly otherFaceIds: readonly string[];
  readonly identifiers: { readonly scryfallId?: string };
}

export interface ReferencePrintingCorpus {
  readonly sets: readonly {
    readonly code: string;
    readonly cards: readonly ReferencePrintingCard[];
  }[];
}

interface ReducedCard {
  readonly id: string;
  readonly set: { readonly code: string; readonly collectorNumber: number };
}

interface ReducedDocument {
  readonly kind: string;
  readonly set: { readonly code: string; readonly reduced: boolean };
  readonly cards: readonly ReducedCard[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reducedDocument(value: unknown): ReducedDocument | null {
  if (!isRecord(value) || value['kind'] !== 'position-reduced-reference-set-document') return null;
  const set = value['set'];
  const cards = value['cards'];
  if (
    !isRecord(set) ||
    typeof set['reduced'] !== 'boolean' ||
    typeof set['code'] !== 'string' ||
    !Array.isArray(cards)
  ) {
    throw new Error('a reduced reference document does not state its set identity and card positions');
  }
  const read: ReducedCard[] = cards.map((card) => {
    if (!isRecord(card) || typeof card['id'] !== 'string' || !isRecord(card['set'])) {
      throw new Error('a reduced reference card does not state its id and printing position');
    }
    const cardSet = card['set'];
    if (
      typeof cardSet['code'] !== 'string' ||
      !Number.isSafeInteger(cardSet['collectorNumber']) ||
      (cardSet['collectorNumber'] as number) <= 0
    ) {
      throw new Error(`${card['id']} does not state a positive collector position`);
    }
    return {
      id: card['id'],
      set: { code: cardSet['code'], collectorNumber: cardSet['collectorNumber'] as number },
    };
  });
  return { kind: value['kind'], set: { code: set['code'], reduced: set['reduced'] }, cards: read };
}

/** True only for the explicit reduced-reference document kind. */
export function isPrintedReferenceDocument(setJson: string): boolean {
  return reducedDocument(JSON.parse(setJson) as unknown) !== null;
}

/** Exact-printing image endpoint; Scryfall redirects it to the current CDN raster. */
export function scryfallCardImageUrl(id: string, face?: 'front' | 'back'): string {
  if (!SCRYFALL_ID.test(id)) throw new Error(`invalid Scryfall printing id ${JSON.stringify(id)}`);
  const suffix = face === undefined ? '' : `&face=${face}`;
  return `https://api.scryfall.com/cards/${id}?format=image&version=art_crop${suffix}`;
}

function imageEntries(card: ReferencePrintingCard, setCode: string): readonly ArtManifestEntry[] {
  const id = card.identifiers.scryfallId;
  if (id === undefined || !SCRYFALL_ID.test(id)) {
    throw new Error(`${setCode} collector position ${card.number} has no pinned Scryfall identity`);
  }
  const label = `${card.name} illustration, ${setCode} #${card.number}`;
  if (card.otherFaceIds.length === 0) {
    return [{ href: scryfallCardImageUrl(id), alt: label }];
  }
  return [
    { href: scryfallCardImageUrl(id, 'front'), alt: `${label}, front face` },
    { href: scryfallCardImageUrl(id, 'back'), alt: `${label}, back face` },
  ];
}

/**
 * Builds an illustration-crop manifest for an official reduced document, or `null` for
 * every generated document. Every kept DSL position must join exactly; a
 * partial join is refused instead of quietly mixing real and generated faces.
 */
export function printedReferenceManifest(
  setJson: string,
  corpus: ReferencePrintingCorpus,
): ArtManifest | null {
  const document = reducedDocument(JSON.parse(setJson) as unknown);
  if (document === null) return null;
  const source = corpus.sets.find((set) => set.code.toUpperCase() === document.set.code.toUpperCase());
  if (source === undefined)
    throw new Error(`${document.set.code} is absent from the pinned reference corpus`);

  const byNumber = new Map<string, ReferencePrintingCard>();
  for (const card of source.cards) {
    if (!byNumber.has(card.number)) byNumber.set(card.number, card);
  }
  const art: Record<string, readonly ArtManifestEntry[]> = {};
  for (const card of document.cards) {
    if (card.set.code.toUpperCase() !== document.set.code.toUpperCase()) {
      throw new Error(
        `${card.id} claims ${card.set.code} inside the ${document.set.code} reference document`,
      );
    }
    const position = String(card.set.collectorNumber);
    const printing = byNumber.get(position);
    if (printing === undefined) {
      throw new Error(`${document.set.code} collector position ${position} has no pinned Scryfall identity`);
    }
    art[card.id] = imageEntries(printing, document.set.code);
  }
  return ArtManifestSchema.parse({ formatVersion: 2, art });
}

/** Reads only the committed JSON artifact; browser code never imports this module. */
export function loadReferencePrintingCorpus(repoRoot: string): ReferencePrintingCorpus {
  const path = join(repoRoot, 'packages', 'data', 'data', 'reference-sets-v1.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed['sets'])) {
    throw new Error(`${path} is not a reference printing corpus`);
  }
  return parsed as unknown as ReferencePrintingCorpus;
}
