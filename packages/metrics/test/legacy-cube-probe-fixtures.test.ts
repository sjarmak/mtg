import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

it('uses only exact pinned Cube names and singleton nonbasic cards in every competence fixture', () => {
  const catalog = parsePrintedCardCatalog(
    JSON.parse(
      readFileSync(new URL('../../data/data/legacy-cube-2021-card-catalog-v1.json', import.meta.url), 'utf8'),
    ) as unknown,
  );
  const known = new Set([
    ...catalog.cards.map((c) => c.correctedName),
    'Plains',
    'Island',
    'Swamp',
    'Mountain',
    'Forest',
  ]);
  const basics = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
  const fixtures = JSON.parse(
    readFileSync(new URL('../../forge-export/bridge/legacy-cube-bot-probes.json', import.meta.url), 'utf8'),
  ) as {
    id: string;
    variant?: string;
    spell: string;
    target: string;
    sacrifice?: string;
    secondary?: string;
    hand: string[];
    battlefield: string[];
    graveyard: string[];
    library: string[];
    opponentBattlefield: string[];
  }[];
  expect(fixtures).toHaveLength(28);
  expect(new Set(fixtures.map((f) => `${f.id}:${f.variant ?? 'default'}`)).size).toBe(fixtures.length);
  expect(fixtures.filter((f) => f.id === 'cheat-threat').map((f) => f.variant)).toEqual([
    'show-and-tell',
    'sneak-attack',
  ]);
  expect(fixtures.filter((f) => f.id === 'spells-density').map((f) => f.variant)).toEqual([
    'young-pyromancer',
    'monastery-mentor',
  ]);
  expect(fixtures.filter((f) => f.id === 'graveyard-value').map((f) => f.variant)).toEqual([
    'uro-escape',
    'bloodghast-landfall',
  ]);
  expect(fixtures.filter((f) => f.id === 'tokens-wide').map((f) => f.variant)).toEqual([
    'honor-souls',
    'spear-procession',
  ]);
  expect(fixtures.filter((f) => f.id === 'opposition-tokens').map((f) => f.variant)).toEqual([
    'opposition-bitterblossom',
    'glare-ophiomancer',
  ]);
  expect(fixtures.filter((f) => f.id === 'equipment').map((f) => f.variant)).toEqual([
    'wargear-elf',
    'fire-ice-wall',
  ]);
  expect(fixtures.filter((f) => f.id === 'creature-toolbox').map((f) => f.variant)).toEqual([
    'primal-command',
    'birthing-pod',
  ]);
  expect(fixtures.filter((f) => f.id === 'land-recursion').map((f) => f.variant)).toEqual([
    'wasteland-replay',
    'fetchland-replay',
  ]);
  expect(fixtures.filter((f) => f.id === 'upheaval-mana').map((f) => f.variant)).toEqual([
    'monolith-rebuild',
    'powerstone-rebuild',
  ]);
  for (const fixture of fixtures) {
    const cards = [
      ...fixture.hand,
      ...fixture.battlefield,
      ...fixture.graveyard,
      ...fixture.library,
      ...fixture.opponentBattlefield,
    ];
    expect(fixture.library.length, fixture.id).toBeGreaterThanOrEqual(40);
    for (const name of [
      ...cards,
      fixture.spell,
      fixture.target,
      ...(fixture.sacrifice ? [fixture.sacrifice] : []),
      ...(fixture.secondary ? [fixture.secondary] : []),
    ])
      expect(known.has(name), `${fixture.id}: ${name}`).toBe(true);
    const nonbasic = cards.filter((name) => !basics.has(name));
    expect(new Set(nonbasic).size, fixture.id).toBe(nonbasic.length);
  }
});
