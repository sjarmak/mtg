/** Independent local/native blocking and cleanup for each additional textless creature. */
import { it } from 'vitest';
import { textlessBlockingScenario } from './support/textless-blocking';
const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const cases = [
  { name: 'Those Who Serve', land: 'Plains', power: 2, toughness: 4 },
  { name: 'Ancient Crab', land: 'Island', power: 1, toughness: 5 },
  { name: 'Dune Beetle', land: 'Swamp', power: 1, toughness: 4 },
  { name: 'Hyena Pack', land: 'Mountain', power: 3, toughness: 4 },
  { name: 'Colossapede', land: 'Forest', power: 5, toughness: 5 },
  { name: 'Dutiful Servants', land: 'Plains', power: 2, toughness: 5 },
  { name: 'Harrier Naga', land: 'Forest', power: 3, toughness: 3 },
] as const;
for (const card of cases)
  for (const controller of ['engine', 'local'] as const) {
    forgeIt(
      `${controller === 'engine' ? 'Native' : 'Local'} ${card.name} blocks Sacred Cat, survives, and prevents player damage`,
      () => textlessBlockingScenario(card, controller),
      180_000,
    );
  }
