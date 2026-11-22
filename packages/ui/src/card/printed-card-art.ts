/** Presentation data for an official printing on any UI card surface. */
import { CardSchema } from '@mtg/dsl';
import type { Card as DslCard, CardInput, Color, ManaColor } from '@mtg/dsl';
import type { ObjectView } from '@mtg/engine';
import type { PrintedCardCatalogEntry, PrintedCardFace, PrintedRarity } from '@mtg/printed-card';
import type { CardArt } from './ArtSlot';
import { manaOutputLabel } from './mana-output';

/**
 * The printing facts a browser needs to present a card.
 *
 * This is deliberately smaller than an admission catalog row. Basic lands are
 * supplied by the match shell rather than admitted cube positions, and making
 * presentation invent Forge scripts or hashes would blur that boundary.
 */
export type PrintedCardPresentation = Pick<
  PrintedCardCatalogEntry,
  | 'physicalId'
  | 'position'
  | 'name'
  | 'oracleId'
  | 'scryfallId'
  | 'typeLine'
  | 'power'
  | 'toughness'
  | 'loyalty'
  | 'colors'
  | 'faces'
  | 'art'
> & {
  readonly manaCost?: string | null | undefined;
  readonly manaValue?: number | undefined;
  readonly oracleText?: string | null | undefined;
  readonly colorIdentity?: readonly Color[] | undefined;
  /** Exact foreign-engine names for this printing; never inferred from display text. */
  readonly observedNames?: readonly string[] | undefined;
  readonly producedMana?: readonly ManaColor[] | null | undefined;
  readonly setCode?: string | undefined;
  readonly rarity?: PrintedRarity | undefined;
};

type PresentedObject = Pick<ObjectView, 'oid' | 'name' | 'typeLine' | 'power' | 'toughness'>;

function faceFor(card: PrintedCardPresentation, name: string): PrintedCardFace {
  return (
    card.faces.find((face) => face.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0) ??
    card.faces[0]!
  );
}

/** Colors of the face currently printed, distinct from a split card's combined colors. */
function visibleFaceColors(card: PrintedCardPresentation, face: PrintedCardFace): readonly Color[] {
  if (face.colors !== null) return face.colors;
  if (face.manaCost === null) return card.colors;
  return card.colors.filter((color) => face.manaCost?.includes(color) === true);
}

function printedLabel(card: PrintedCardPresentation, object: PresentedObject): string {
  const face = faceFor(card, object.name);
  const fields = [object.name];
  if (face.manaCost !== null && face.manaCost.length > 0) fields.push(`Mana cost ${face.manaCost}`);
  fields.push(object.typeLine.length > 0 ? object.typeLine : face.typeLine);
  if (object.power !== null && object.toughness !== null) {
    fields.push(`${String(object.power)}/${String(object.toughness)}`);
  } else if (face.power !== null && face.toughness !== null) {
    fields.push(`${face.power}/${face.toughness}`);
  }
  if (/\bLand\b/i.test(object.typeLine.length > 0 ? object.typeLine : face.typeLine)) {
    const outputs = card.producedMana ?? landManaFromTypeLine(face.typeLine);
    if (outputs.length > 0) fields.push(`Produces ${manaOutputLabel(outputs)} mana`);
  }
  if (face.loyalty !== null) fields.push(`Loyalty ${face.loyalty}`);
  return `${fields.join('. ')}.`;
}

function printedDetail(card: PrintedCardPresentation, object: PresentedObject): string {
  const face = faceFor(card, object.name);
  return [object.name, object.typeLine.length > 0 ? object.typeLine : face.typeLine, face.oracleText]
    .filter((part): part is string => part !== null && part.length > 0)
    .join('\n');
}

function faceIndex(card: PrintedCardPresentation, face: PrintedCardFace): number {
  const index = card.faces.indexOf(face);
  return index < 0 ? 0 : index;
}

function imageForFace(
  card: PrintedCardPresentation,
  face: PrintedCardFace,
): { readonly src: string; readonly alt: string } | undefined {
  if (card.art.status === 'missing') return undefined;
  const index = faceIndex(card, face);
  const image =
    card.art.images.find((candidate) => candidate.face === index) ??
    card.art.images.find((candidate) => candidate.face === null) ??
    card.art.images[index] ??
    card.art.images[0];
  const src = image?.uris['art_crop'];
  return src === undefined ? undefined : { src, alt: `${face.name} illustration` };
}

/** Illustration-only art plus exact fields for the ordinary shared frame. */
export function printedCardArt(card: PrintedCardPresentation, object: PresentedObject): CardArt {
  const face = faceFor(card, object.name);
  const illustration = imageForFace(card, face);
  return {
    src: illustration?.src ?? '',
    alt: illustration?.alt ?? `${face.name} illustration unavailable`,
    presentation: 'printed-card',
    printedFrame: {
      physicalId: card.physicalId,
      position: card.position,
      ...(card.setCode === undefined ? {} : { setCode: card.setCode }),
      ...(card.rarity === undefined ? {} : { rarity: card.rarity }),
      name: object.name,
      manaCost: face.manaCost,
      typeLine: object.typeLine.length > 0 ? object.typeLine : face.typeLine,
      oracleText: face.oracleText,
      power: object.power === null || object.power === undefined ? face.power : String(object.power),
      toughness:
        object.toughness === null || object.toughness === undefined
          ? face.toughness
          : String(object.toughness),
      loyalty: face.loyalty,
    },
    printedLabel: printedLabel(card, object),
    printedDetail: printedDetail(card, object),
  };
}

/**
 * Explicit missing-print state for an observed object outside the supplied catalog.
 *
 * The illustration is pending, but the frame is not: the backend already says
 * the object's name, type line and printed power and toughness, and a token
 * the catalog never held (every catalog holds admitted card printings and no
 * token printings) is exactly that object. Before this frame existed, forty
 * Pegasus tokens on a Commander table drew as forty blank hatched windows with
 * a name and a 1/1 and no type line, and buried the real permanents among
 * them. The frame's identity is the printed one (`printedIdentity`), so the
 * collector line and the pending label both say what this is rather than
 * which object it is. Rules text stays null: the projection carries none, and
 * the frame draws an empty box rather than a guess.
 */
export function missingPrintedCardArt(object: ObjectView): CardArt {
  const facts = [object.name, object.typeLine].filter((part) => part.length > 0);
  return {
    src: '',
    alt: `${object.name} printed image unavailable`,
    presentation: 'printed-card',
    printedFrame: {
      physicalId: printedIdentity(object),
      position: 0,
      name: object.name,
      manaCost: object.characteristics?.manaCost ?? null,
      typeLine: object.typeLine,
      oracleText: null,
      power: object.power === null ? null : String(object.power),
      toughness: object.toughness === null ? null : String(object.toughness),
      loyalty: null,
    },
    printedLabel: `${facts.join('. ')}.`,
    printedDetail: facts.join('\n'),
  };
}

/**
 * The identity two observed objects share when they are the same printed
 * thing: a catalogued card's physical printing, or, for an object the catalog
 * never held, the token's own name and type line. Object identity (`oid`) is
 * deliberately absent; it is what the battlefield keeps in `key` so that a
 * pile of forty Pegasus tokens still opens to forty exact objects.
 */
export function printedIdentity(object: ObjectView, card?: PrintedCardPresentation): string {
  if (card !== undefined) return card.physicalId;
  return `observed:${slug(object.name)}:${slug(object.typeLine)}`;
}

function slug(value: string): string {
  const cleaned = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? 'object' : cleaned;
}

function integer(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !/^-?\d+$/.test(value)) return fallback;
  return Number.parseInt(value, 10);
}

interface DisplayCardFacts {
  readonly id: string;
  readonly setCode: string;
  readonly rarity?: 'common' | 'uncommon' | 'rare' | 'mythic';
  readonly collectorNumber: number;
  readonly colors: readonly Color[];
  readonly typeLine: string;
  readonly landTypeLine: string;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly loyalty: string | null;
  readonly producedMana?: readonly ManaColor[] | null;
}

const BASIC_LAND_MANA = new Map<string, ManaColor>([
  ['Plains', 'W'],
  ['Island', 'U'],
  ['Swamp', 'B'],
  ['Mountain', 'R'],
  ['Forest', 'G'],
]);

/** Mana identity visible from the structured basic-land subtypes of a printed type line. */
function landManaFromTypeLine(typeLine: string): readonly ManaColor[] {
  const separator = typeLine.indexOf('—');
  if (separator < 0) return [];
  const subtypes = typeLine
    .slice(separator + 1)
    .trim()
    .split(/\s+/);
  const colors: ManaColor[] = [];
  for (const subtype of subtypes) {
    const color = BASIC_LAND_MANA.get(subtype);
    if (color !== undefined && !colors.includes(color)) colors.push(color);
  }
  return colors;
}

function displayCard(object: PresentedObject, facts: DisplayCardFacts): DslCard {
  const base = {
    id: facts.id,
    name: object.name,
    rarity: facts.rarity ?? ('common' as const),
    set: { code: facts.setCode, collectorNumber: facts.collectorNumber },
    colors: [...facts.colors],
  };
  let input: CardInput;
  if (/\bCreature\b/i.test(facts.typeLine)) {
    input = {
      ...base,
      kind: 'creature',
      artifact: /\bArtifact\b/i.test(facts.typeLine),
      manaCost: {},
      power: object.power ?? integer(facts.power, 0),
      toughness: object.toughness ?? integer(facts.toughness, 0),
    };
  } else if (/\bPlaneswalker\b/i.test(facts.typeLine)) {
    input = {
      ...base,
      kind: 'planeswalker',
      manaCost: {},
      startingLoyalty: integer(facts.loyalty, 0),
    };
  } else if (/\bBattle\b/i.test(facts.typeLine)) {
    input = { ...base, kind: 'battle', manaCost: {}, defense: 1 };
  } else if (/\bLand\b/i.test(facts.typeLine)) {
    input = {
      ...base,
      kind: 'land',
      producesMana: [...(facts.producedMana ?? landManaFromTypeLine(facts.landTypeLine))],
    };
  } else if (/\bInstant\b/i.test(facts.typeLine)) {
    input = { ...base, kind: 'instant', manaCost: {} };
  } else if (/\bSorcery\b/i.test(facts.typeLine)) {
    input = { ...base, kind: 'sorcery', manaCost: {} };
  } else if (/\bEnchantment\b/i.test(facts.typeLine)) {
    input = { ...base, kind: 'enchantment', manaCost: {} };
  } else {
    input = { ...base, kind: 'artifact', manaCost: {} };
  }
  return CardSchema.parse(input);
}

/**
 * A layout carrier for the shared card component. It never enters an engine;
 * exact visible words live in `printedFrame` and game actions retain the
 * backend object's opaque identity.
 */
export function printedDisplayCard(card: PrintedCardPresentation, object: PresentedObject): DslCard {
  const face = faceFor(card, object.name);
  const typeLine = object.typeLine.length > 0 ? object.typeLine : face.typeLine;
  return displayCard(object, {
    id: `observed-${slug(object.oid)}`,
    setCode: card.setCode ?? 'LGC',
    ...(card.rarity === undefined || card.rarity === 'special' || card.rarity === 'bonus'
      ? {}
      : { rarity: card.rarity }),
    collectorNumber: card.position,
    colors: visibleFaceColors(card, face),
    typeLine,
    landTypeLine: face.typeLine,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    ...(card.producedMana === undefined ? {} : { producedMana: card.producedMana }),
  });
}

/** Inert layout carrier for an observed object absent from the supplied catalog. */
export function missingPrintedDisplayCard(object: ObjectView): DslCard {
  return displayCard(object, {
    id: `observed-missing-${slug(object.oid)}`,
    setCode: 'OBS',
    collectorNumber: 1,
    colors: [],
    typeLine: object.typeLine.length > 0 ? object.typeLine : 'Artifact',
    landTypeLine: object.typeLine,
    power: null,
    toughness: null,
    loyalty: null,
    producedMana: null,
  });
}
