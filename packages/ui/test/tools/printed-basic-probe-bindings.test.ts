/** Printing equivalence is limited to these five reviewed basic-land rules, not arbitrary names. */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import config from '../../data/akh-hou-probes-v1.json';

const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
  parsePrintedCardCatalog(
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`, 'utf8')),
  ),
);
const basics = [
  ['Plains', 'W', '7b72280280cf668427e25283026a88ebcf3c67963e1097eda39ed6433c228f9c'],
  ['Island', 'U', 'e590434de75aa3e39a03555d0c91788cdabe37f5fdf91ce7c1a189c79f4cade6'],
  ['Swamp', 'B', '96a473942577dee4fffe52906874ef343a7e8d1413872334baa576066112d252'],
  ['Mountain', 'R', 'd421d9639d7b7f2a8c4ed04fa2fa8526cbc768733a92b0a1a453535ee99a3799'],
  ['Forest', 'G', '9a574ea2a8136e588ab77ff8bf260075a94572d8099a7d0d98c62590479aa5a6'],
] as const;

for (const [name, color, sha256] of basics) {
  it(`binds only equivalent ${name} printings to both measured basic-land controllers`, () => {
    const cards = catalogs.flatMap((catalog) => catalog.cards).filter((card) => card.correctedName === name);
    expect(cards).toHaveLength(7);
    for (const card of cards) {
      expect(card).toMatchObject({
        name,
        sourceName: name,
        correctedName: name,
        forgeScript: `${name[0]!.toLowerCase()}/${name.toLowerCase()}.txt`,
        forgeScriptSha256: sha256,
        layout: 'normal',
        manaCost: '',
        manaValue: 0,
        typeLine: `Basic Land — ${name}`,
        oracleText: `({T}: Add {${color}}.)`,
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        colorIdentity: [color],
        producedMana: [color],
        faces: [
          {
            name,
            manaCost: '',
            typeLine: `Basic Land — ${name}`,
            oracleText: `({T}: Add {${color}}.)`,
            power: null,
            toughness: null,
            loyalty: null,
            colors: [],
          },
        ],
      });
      expect(card.faces).toHaveLength(1);
    }
    for (const controller of ['local', 'engine']) {
      const version = controller === 'local' ? 'v2' : 'v4';
      const probe = config.probes.find((entry) => entry.id === `basic-lands-${controller}-${version}`);
      expect(probe).toBeDefined();
      expect(probe?.cardIds).toEqual(expect.arrayContaining(cards.map((card) => card.physicalId)));
      expect(probe?.controller).toBe(controller);
      expect(probe?.scope).toBe('card');
      expect(probe?.decisionFamilies).toEqual(
        controller === 'local'
          ? [
              'basic-land-main-phase-play-once-per-turn',
              'basic-land-colored-mana-use',
              'basic-land-untap-after-mana-use',
            ]
          : ['basic-land-main-phase-play-once-per-turn', 'basic-land-untap-after-mana-use'],
      );
      expect(probe?.assertions).toHaveLength(5);
      expect(probe?.assertions).toContain(
        controller === 'local'
          ? `${name} plays once in its own main phase, produces only ${color}, and untaps next turn`
          : `Forge plays ${name} at most once per turn in its main phase, cycles, and untaps next turn`,
      );
      expect(probe?.testFile).toBe(
        `packages/forge-export/test/observed-akh-basic-lands${controller === 'engine' ? '-bot' : ''}.integration.test.ts`,
      );
    }
  });
}

it('accounts for every basic printing without including any nonbasic', () => {
  const ids = catalogs
    .flatMap((catalog) => catalog.cards)
    .filter((card) => card.typeLine.startsWith('Basic Land'))
    .map((card) => card.physicalId)
    .sort();
  expect(ids).toHaveLength(35);
  for (const controller of ['local', 'engine']) {
    expect(
      config.probes
        .filter((probe) => probe.id.startsWith('basic-') && probe.controller === controller)
        .flatMap((probe) => probe.cardIds)
        .sort(),
    ).toEqual(ids);
  }
});

it('binds colored-payment proof and wrong-color controls to exactly the basic printing population', () => {
  const probe = config.probes.find((entry) => entry.id === 'colored-mana-engine-v2');
  expect(probe).toMatchObject({
    scope: 'card',
    controller: 'engine',
    decisionFamilies: ['basic-land-colored-mana-use'],
    testFile: 'packages/forge-export/test/observed-akh-colored-payment.integration.test.ts',
  });
  const ids = catalogs
    .flatMap((catalog) => catalog.cards)
    .filter((card) => card.typeLine.startsWith('Basic Land'))
    .map((card) => card.physicalId);
  expect([...(probe?.cardIds ?? [])].sort()).toEqual(ids.sort());
  expect(probe?.assertions).toEqual([
    'Native Plains pays the colored cost to cast Adorned Pouncer',
    'Native Island cannot pay the colored cost to cast Adorned Pouncer',
    'Native Island pays the colored cost to cycle Censor',
    'Native Swamp cannot pay the colored cost to cycle Censor',
    'Native Swamp pays the colored cost to cast Khenra Eternal',
    'Native Mountain cannot pay the colored cost to cast Khenra Eternal',
    'Native Mountain pays the colored cost to cast Defiant Khenra',
    'Native Forest cannot pay the colored cost to cast Defiant Khenra',
    'Native Forest pays the colored cost to cycle Shefet Monitor',
    'Native Plains cannot pay the colored cost to cycle Shefet Monitor',
  ]);
});
