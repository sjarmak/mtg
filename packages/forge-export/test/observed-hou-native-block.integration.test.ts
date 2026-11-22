/** Blocking is checked through public combat outcomes and local choice validation. */
import { it } from 'vitest';
import { textlessBlockingScenario } from './support/textless-blocking';
const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
for (const controller of ['engine', 'local'] as const) {
  forgeIt(
    `${controller === 'engine' ? 'Native' : 'Local'} Defiant Khenra blocks Sacred Cat, survives, and prevents player damage`,
    () =>
      textlessBlockingScenario(
        { name: 'Defiant Khenra', land: 'Mountain', power: 2, toughness: 2 },
        controller,
      ),
    180_000,
  );
}
