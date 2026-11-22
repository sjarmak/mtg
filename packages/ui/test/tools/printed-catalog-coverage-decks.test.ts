import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildPrintedCatalogCoverageDeckPairs } from '../../tools/printed-catalog-coverage-decks';

const catalogNames = ['akh', 'hou', 'mp2'];

it('builds deterministic 40-card seat-swapped decks covering every exact catalog script', async () => {
  const catalogs = await Promise.all(
    catalogNames.map(async (name) =>
      JSON.parse(
        await readFile(
          new URL(`../../../data/data/akh-hou/${name}-printed-catalog-v1.json`, import.meta.url),
          'utf8',
        ),
      ),
    ),
  );
  const first = buildPrintedCatalogCoverageDeckPairs(catalogs);
  const second = buildPrintedCatalogCoverageDeckPairs(catalogs);
  const colorsByPrintingId = new Map(
    catalogs.flatMap((catalog) =>
      catalog.cards.map(
        (card: { physicalId: string; colorIdentity: readonly string[] }) =>
          [card.physicalId, card.colorIdentity.slice().sort().join('') || 'C'] as const,
      ),
    ),
  );

  expect(first).toEqual(second);
  expect(first.length).toBeGreaterThan(1);
  expect(first.every((pair) => pair.length === 2)).toBe(true);
  expect(
    first.every((pair) => pair.every((deck) => deck.cards.length === 40 && deck.targetScripts.length <= 8)),
  ).toBe(true);

  const localScripts = new Set(first.flatMap((pair) => pair[0].targetScripts));
  const engineScripts = new Set(first.flatMap((pair) => pair[1].targetScripts));
  expect(localScripts).toEqual(engineScripts);
  expect(localScripts.size).toBe(509);
  expect(
    first.every((pair) =>
      pair.every(
        (deck) => new Set(deck.targetPrintingIds.map((id) => colorsByPrintingId.get(id))).size === 1,
      ),
    ),
  ).toBe(true);
  expect(
    first.every((pair) => pair.every((deck) => deck.cards.every((card) => !/[\r\n|]/u.test(card.name)))),
  ).toBe(true);
});

it('can trade match count for repeated access to a smaller target cohort', async () => {
  const catalogs = await Promise.all(
    catalogNames.map(async (name) =>
      JSON.parse(
        await readFile(
          new URL(`../../../data/data/akh-hou/${name}-printed-catalog-v1.json`, import.meta.url),
          'utf8',
        ),
      ),
    ),
  );
  const pairs = buildPrintedCatalogCoverageDeckPairs(catalogs, { targetsPerDeck: 4 });
  const nameByScript = new Map(
    catalogs.flatMap((catalog) =>
      catalog.cards.map(
        (card: { correctedName: string; forgeScript: string }) =>
          [card.forgeScript, card.correctedName] as const,
      ),
    ),
  );

  expect(pairs).toHaveLength(136);
  expect(pairs.every((pair) => pair.every((deck) => deck.targetScripts.length <= 4))).toBe(true);
  expect(
    pairs.every((pair) =>
      pair.every((deck) =>
        deck.targetScripts.every(
          (script) => deck.cards.filter((card) => card.name === nameByScript.get(script)).length >= 4,
        ),
      ),
    ),
  ).toBe(true);
  expect(new Set(pairs.flatMap((pair) => pair[0].targetScripts))).toHaveProperty('size', 509);
  expect(new Set(pairs.flatMap((pair) => pair[1].targetScripts))).toHaveProperty('size', 509);
});
