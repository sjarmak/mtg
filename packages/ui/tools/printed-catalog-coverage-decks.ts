/** Deterministic constructed decks that expose every exact printed-card script to both seats. */
import { renderDeck } from '@mtg/forge-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

const DEFAULT_TARGETS_PER_DECK = 8;
const TARGET_SLOTS = 16;
const DECK_SIZE = 40;
const BASIC_BY_COLOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' } as const;
type Color = keyof typeof BASIC_BY_COLOR;

interface TargetCard {
  readonly physicalId: string;
  readonly forgeScript: string;
  readonly name: string;
  readonly setCode: string;
  readonly colors: readonly Color[];
}

export interface PrintedCatalogCoverageDeck {
  readonly file: string;
  readonly cards: readonly { readonly name: string; readonly setCode?: string }[];
  readonly targetPrintingIds: readonly string[];
  readonly targetScripts: readonly string[];
  readonly poolPhysicalIds: readonly string[];
  readonly poolPrintingIds: readonly string[];
  readonly selectedPhysicalIds: readonly string[];
  readonly selectedPrintingIds: readonly string[];
  readonly text: string;
}

function chunks<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function paletteOf(target: TargetCard): string {
  return target.colors.join('') || 'C';
}

function distributeBasics(colors: readonly Color[], count: number) {
  const palette = colors.length === 0 ? (Object.keys(BASIC_BY_COLOR) as Color[]) : colors;
  return Array.from({ length: count }, (_, index) => ({
    name: BASIC_BY_COLOR[palette[index % palette.length]!],
  }));
}

function coverageDeck(targets: readonly TargetCard[], index: number): PrintedCatalogCoverageDeck {
  if (targets.length === 0) throw new Error('Catalog coverage deck requires at least one target');
  const targetCards = Array.from({ length: TARGET_SLOTS }, (_, slot) => {
    const target = targets[slot % targets.length]!;
    return { name: target.name, setCode: target.setCode };
  });
  const colors = [...new Set(targets.flatMap((target) => target.colors))].sort() as Color[];
  const cards: readonly { readonly name: string; readonly setCode?: string }[] = [
    ...targetCards,
    ...distributeBasics(colors, DECK_SIZE - targetCards.length),
  ];
  const name = `printed-catalog-coverage-${String(index).padStart(3, '0')}`;
  return {
    file: `${name}.dck`,
    cards,
    targetPrintingIds: targets.map((target) => target.physicalId),
    targetScripts: targets.map((target) => target.forgeScript),
    poolPhysicalIds: targets.map((target) => `catalog-coverage:${target.physicalId}`),
    poolPrintingIds: targets.map((target) => target.physicalId),
    selectedPhysicalIds: targets.map((target) => `catalog-coverage:${target.physicalId}`),
    selectedPrintingIds: targets.map((target) => target.physicalId),
    text: renderDeck({
      name,
      entries: cards.map((card) => ({
        count: 1,
        cardName: card.name,
        ...(card.setCode === undefined ? {} : { setCode: card.setCode }),
      })),
    }),
  };
}

/**
 * Uses one representative printing per exact script, then emits each deck once
 * in each seat. These are discovery decks, not Limited pools or admission proof.
 */
export function buildPrintedCatalogCoverageDeckPairs(
  catalogInputs: readonly unknown[],
  options: { readonly targetsPerDeck?: number } = {},
): readonly (readonly [PrintedCatalogCoverageDeck, PrintedCatalogCoverageDeck])[] {
  const targetsPerDeck = options.targetsPerDeck ?? DEFAULT_TARGETS_PER_DECK;
  if (!Number.isInteger(targetsPerDeck) || targetsPerDeck < 1 || targetsPerDeck > TARGET_SLOTS)
    throw new Error(`Catalog coverage targetsPerDeck must be from 1 to ${String(TARGET_SLOTS)}`);
  const byScript = new Map<string, TargetCard>();
  for (const catalogInput of catalogInputs) {
    const catalog = parsePrintedCardCatalog(catalogInput);
    const setCode = catalog.format.split('-', 1)[0]!.toUpperCase();
    for (const card of catalog.cards) {
      if (byScript.has(card.forgeScript)) continue;
      byScript.set(card.forgeScript, {
        physicalId: card.physicalId,
        forgeScript: card.forgeScript,
        name: card.correctedName,
        setCode,
        colors: card.colorIdentity.filter((color): color is Color => color in BASIC_BY_COLOR),
      });
    }
  }
  const targets = [...byScript.values()].sort(
    (left, right) =>
      paletteOf(left).localeCompare(paletteOf(right)) || left.forgeScript.localeCompare(right.forgeScript),
  );
  if (targets.length === 0) throw new Error('Catalog coverage requires at least one exact script');
  const targetsByPalette = targets.reduce<ReadonlyMap<string, readonly TargetCard[]>>((groups, target) => {
    const palette = paletteOf(target);
    return new Map(groups).set(palette, [...(groups.get(palette) ?? []), target]);
  }, new Map());
  const decks = [...targetsByPalette.values()]
    .flatMap((group) => chunks(group, targetsPerDeck))
    .map(coverageDeck);
  const pairs: [PrintedCatalogCoverageDeck, PrintedCatalogCoverageDeck][] = [];
  for (let index = 0; index < decks.length; index += 2) {
    const left = decks[index]!;
    const right = decks[index + 1] ?? decks[0]!;
    pairs.push([left, right], [right, left]);
  }
  return pairs;
}
