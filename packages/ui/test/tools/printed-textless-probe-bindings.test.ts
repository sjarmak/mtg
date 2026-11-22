/** Exact printing bindings for the separate textless gameplay cohort. */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

const expected = [
  {
    name: 'Those Who Serve',
    physicalId: 'akh-printed-v1:0032:b4f27dd9-7ee4-4cdc-8f65-a4349b6aa47f',
    forgeScriptSha256: '61f692487f2fdb4b265766b89bc5d2f37b483b1b2f514607c5e742e703600f0d',
    manaCost: '{2}{W}',
    power: '2',
    toughness: '4',
  },
  {
    name: 'Ancient Crab',
    physicalId: 'akh-printed-v1:0040:7c2ca68b-15fb-4691-b549-268df92ca413',
    forgeScriptSha256: '38c40c667d5ed06ce58b9d9314f0ab697b120317e57d80f21954d0046e9799e2',
    manaCost: '{1}{U}{U}',
    power: '1',
    toughness: '5',
  },
  {
    name: 'Dune Beetle',
    physicalId: 'akh-printed-v1:0089:923cb904-c725-4d57-bc17-7aa87a7cd8e0',
    forgeScriptSha256: '02d3a10513077bc18eac2ef5cc69d721913f23112f1aa6009a56e5dd2a1272a6',
    manaCost: '{1}{B}',
    power: '1',
    toughness: '4',
  },
  {
    name: 'Hyena Pack',
    physicalId: 'akh-printed-v1:0139:f9fa8351-567e-4ef4-8346-c58e50c778a6',
    forgeScriptSha256: '20b78df81dbff0d918e7cbd718420182406d5c4cc609317eb7e098f578bf37f1',
    manaCost: '{2}{R}{R}',
    power: '3',
    toughness: '4',
  },
  {
    name: 'Colossapede',
    physicalId: 'akh-printed-v1:0161:7642bfc5-ace8-419e-b57b-2b881bfe023e',
    forgeScriptSha256: 'fa206ef9164a692dbab8673fc220723af7a649b613b98168127ba8e5edc254fe',
    manaCost: '{4}{G}',
    power: '5',
    toughness: '5',
  },
  {
    name: 'Dutiful Servants',
    physicalId: 'hou-printed-v1:0012:7684db4c-6eff-4da1-a410-48d707fb5bf1',
    forgeScriptSha256: '16a41a8d789afaa6fc6798ea7db6ab1036573e9fb93843a8b414baa8f3ce9c6a',
    manaCost: '{3}{W}',
    power: '2',
    toughness: '5',
  },
  {
    name: 'Harrier Naga',
    physicalId: 'hou-printed-v1:0118:bcdc68c9-f5f3-4c5b-80df-85508cf15f84',
    forgeScriptSha256: '8cd0ad8e78fd99dbdb80cbd7c8ae00041e9e738f09fefdfc4f9b2e7fcab538a2',
    manaCost: '{2}{G}',
    power: '3',
    toughness: '3',
  },
] as const;
const cards = ['akh', 'hou'].flatMap(
  (code) =>
    parsePrintedCardCatalog(
      JSON.parse(readFileSync(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`, 'utf8')),
    ).cards,
);

it('binds fourteen lethal combat observations to exact textless printings', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-hou-textless-lethal-probes-v1.json', 'utf8'));
  expect(config.probes).toHaveLength(14);
  for (const row of expected)
    for (const controller of ['local', 'engine']) {
      const id = `${row.name.toLowerCase().replaceAll(' ', '-')}-${controller}-lethal-v1`;
      expect(config.probes.find((probe: { id: string }) => probe.id === id)).toEqual({
        id,
        scope: 'card',
        controller,
        cardIds: [row.physicalId],
        decisionFamilies: ['textless-creature-lethal-combat'],
        assertions: [`${controller} ${row.name} dies to lethal combat from Colossapede`],
        testFile: 'packages/forge-export/test/observed-akh-hou-textless-lethal.integration.test.ts',
      });
    }
});

it('binds twenty-eight observations to seven exact textless printings', () => {
  const config = JSON.parse(readFileSync('packages/ui/data/akh-hou-textless-probes-v1.json', 'utf8'));
  expect(config.probes).toHaveLength(28);
  for (const row of expected) {
    expect(cards.find((card) => card.physicalId === row.physicalId)).toMatchObject({
      ...row,
      oracleText: '',
    });
    for (const controller of ['local', 'engine']) {
      const id = `${row.name.toLowerCase().replaceAll(' ', '-')}-${controller}-v1`;
      expect(config.probes.find((probe: { id: string }) => probe.id === id)).toEqual({
        id,
        scope: 'card',
        controller,
        cardIds: [row.physicalId],
        decisionFamilies: ['textless-creature-cast-and-unblocked-attack'],
        assertions: [`${controller} ${row.name} pays, resolves, waits, and deals its printed combat damage`],
        testFile: 'packages/forge-export/test/observed-akh-hou-textless.integration.test.ts',
      });
      const blockId = `${row.name.toLowerCase().replaceAll(' ', '-')}-${controller}-block-v1`;
      expect(config.probes.find((probe: { id: string }) => probe.id === blockId)).toEqual({
        id: blockId,
        scope: 'card',
        controller,
        cardIds: [row.physicalId],
        decisionFamilies: ['textless-creature-block-survival-and-cleanup'],
        assertions: [
          `${controller === 'engine' ? 'Native' : 'Local'} ${row.name} blocks Sacred Cat, survives, and prevents player damage`,
        ],
        testFile: 'packages/forge-export/test/observed-akh-hou-textless-block.integration.test.ts',
      });
    }
  }
});
