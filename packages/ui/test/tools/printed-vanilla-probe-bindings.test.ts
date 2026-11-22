/** This first textless-creature probe qualifies only the exact printing it exercises. */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import config from '../../data/akh-hou-probes-v1.json';

const catalog = parsePrintedCardCatalog(
  JSON.parse(readFileSync('packages/data/data/akh-hou/hou-printed-catalog-v1.json', 'utf8')),
);

for (const controller of ['local', 'engine']) {
  it(`binds ${controller} textless combat proof only to Defiant Khenra`, () => {
    const card = catalog.cards.find((entry) => entry.name === 'Defiant Khenra');
    expect(card).toMatchObject({
      physicalId: 'hou-printed-v1:0089:67e3983d-b1ed-46a9-9ab0-96c4d0d77050',
      forgeScriptSha256: '7347c52dc3e597b08b2b10403d71f0a6e99fb1b9c20d3839febd8c51c1a1f376',
      oracleText: '',
      manaCost: '{1}{R}',
      power: '2',
      toughness: '2',
      typeLine: 'Creature — Jackal Warrior',
    });
    expect(config.probes.find((probe) => probe.id === `defiant-khenra-${controller}-v1`)).toMatchObject({
      scope: 'card',
      controller,
      cardIds: [card!.physicalId],
      decisionFamilies: ['textless-creature-cast-and-attack-combat'],
      testFile: 'packages/forge-export/test/observed-hou-vanilla.integration.test.ts',
      assertions: [
        `${controller} Defiant Khenra casts, waits to attack, and deals unblocked combat damage`,
        `${controller} Defiant Khenra casts, waits to attack, and trades with a blocker`,
      ],
    });
  });
}

for (const controller of ['engine', 'local'] as const) {
  it(`binds ${controller} blocking outcomes separately from attacking`, () => {
    const id = controller === 'engine' ? 'defiant-khenra-native-block-v2' : 'defiant-khenra-local-block-v1';
    expect(config.probes.find((probe) => probe.id === id)).toEqual({
      id,
      scope: 'card',
      controller,
      cardIds: ['hou-printed-v1:0089:67e3983d-b1ed-46a9-9ab0-96c4d0d77050'],
      decisionFamilies: ['textless-creature-block-survival-and-cleanup'],
      testFile: 'packages/forge-export/test/observed-hou-native-block.integration.test.ts',
      assertions: [
        `${controller === 'engine' ? 'Native' : 'Local'} Defiant Khenra blocks Sacred Cat, survives, and prevents player damage`,
      ],
    });
  });
}
