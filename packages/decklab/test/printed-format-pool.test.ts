import { describe, expect, it } from 'vitest';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { DeckCriteriaSchema } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import {
  printedFormatDeckPool,
  toPrintedConstructedDeck,
  type PrintedPoolCatalog,
} from '../src/printed-format-pool';
import { selectCards } from '../src/select';
import { statedCopyLimit } from '../src/verify';
import { scriptedProvider } from './support/scripted-provider';

const SHA = 'a'.repeat(64);
const IDS = {
  alpha: '00000000-0000-4000-8000-000000000001',
  beta: '00000000-0000-4000-8000-000000000002',
  plains: '00000000-0000-4000-8000-000000000003',
};

function card(
  catalogFormat: string,
  position: number,
  name: string,
  id: string,
  typeLine = 'Creature — Test',
): PrintedCardCatalogEntry {
  const physicalId = `${catalogFormat}:${String(position).padStart(4, '0')}:${id}`;
  return {
    physicalId,
    position,
    sourceName: name,
    correctedName: name,
    name,
    oracleId: id,
    scryfallId: id,
    forgeScript: `a/${name.toLowerCase().replaceAll(' ', '_')}.txt`,
    forgeScriptSha256: SHA,
    layout: 'normal',
    manaCost: typeLine.startsWith('Basic Land') ? null : '{1}{W}',
    manaValue: typeLine.startsWith('Basic Land') ? 0 : 2,
    typeLine,
    oracleText: null,
    power: typeLine.startsWith('Creature') ? '2' : null,
    toughness: typeLine.startsWith('Creature') ? '2' : null,
    loyalty: null,
    colors: typeLine.startsWith('Basic Land') ? [] : ['W'],
    colorIdentity: ['W'],
    producedMana: typeLine.startsWith('Basic Land') ? ['W'] : null,
    faces: [
      {
        name,
        manaCost: typeLine.startsWith('Basic Land') ? null : '{1}{W}',
        typeLine,
        oracleText: null,
        power: typeLine.startsWith('Creature') ? '2' : null,
        toughness: typeLine.startsWith('Creature') ? '2' : null,
        loyalty: null,
        colors: typeLine.startsWith('Basic Land') ? [] : ['W'],
      },
    ],
    art: { status: 'missing', source: 'scryfall', scryfallId: id, reason: 'fixture' },
  };
}

function catalog(
  code: string,
  format: string,
  cards: readonly PrintedCardCatalogEntry[],
): PrintedPoolCatalog {
  return {
    code,
    catalog: {
      schemaVersion: 1,
      kind: 'printed-card-catalog',
      format,
      source: {
        provenanceArtifact: 'fixture.json',
        provenanceSha256: SHA,
        scryfallProvider: 'fixture',
        scryfallBulkFile: 'fixture.json',
        scryfallBulkSha256: SHA,
        scryfallBulkUpdatedAt: '2026-09-25',
      },
      forgeVersion: 'fixture',
      cards: [...cards],
      contentSha256: SHA,
    } satisfies PrintedCardCatalog,
  };
}

const ALPHA = card('aaa-printed-v1', 1, 'Alpha Guard', IDS.alpha);
const PLAINS = card('aaa-printed-v1', 2, 'Plains', IDS.plains, 'Basic Land — Plains');
const BETA = card('bbb-printed-v1', 1, 'Beta Guard', IDS.beta);

function criteria(sets: readonly string[] = ['AAA', 'BBB']) {
  return DeckCriteriaSchema.parse({
    prompt: 'Build disciplined white creatures',
    sets,
    colors: ['W'],
    archetype: 'white aggro',
    landCount: 24,
  });
}

describe('printed format deck pool', () => {
  it('rejects a fixture-provider proposal outside the format catalog', async () => {
    const stated = criteria(['AAA']);
    const pool = printedFormatDeckPool(
      'fixture',
      [catalog('AAA', 'aaa-printed-v1', [ALPHA, PLAINS])],
      stated,
    );
    const provider = scriptedProvider([
      {
        plan: 'Attack early',
        cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
      },
    ]);
    const resolved = resolveCriteria(stated, { count: 24, source: 'stated', reason: 'as stated' });
    const result = await selectCards(
      provider,
      pool,
      resolved,
      { knownNames: pool.knownNames, worldName: 'fixture printed format' },
      { maxRounds: 1 },
    );
    expect(result.inclusions).toEqual([]);
    expect(result.rejections).toMatchObject([{ code: 'unknown-card' }]);
  });

  it('states and enforces the four-copy limit', async () => {
    const stated = criteria(['AAA']);
    const pool = printedFormatDeckPool(
      'fixture',
      [catalog('AAA', 'aaa-printed-v1', [ALPHA, PLAINS])],
      stated,
    );
    const provider = scriptedProvider([
      {
        plan: 'Attack early',
        cards: [{ name: 'Alpha Guard', count: 7, criteria: ['archetype'], reason: 'pressure' }],
      },
    ]);
    const resolved = resolveCriteria(stated, { count: 24, source: 'stated', reason: 'as stated' });
    const result = await selectCards(
      provider,
      pool,
      resolved,
      { knownNames: pool.knownNames, worldName: 'fixture printed format' },
      { maxRounds: 1 },
    );
    expect(statedCopyLimit(resolved)).toBe(4);
    expect(provider.prompts[0]).toContain('At most 4 copies of any one card');
    expect(result.inclusions).toMatchObject([{ count: 4 }]);
  });

  it('pools every catalog in a multi-set printed format', () => {
    const pool = printedFormatDeckPool(
      'fixture',
      [catalog('AAA', 'aaa-printed-v1', [ALPHA, PLAINS]), catalog('BBB', 'bbb-printed-v1', [BETA])],
      criteria(),
    );
    expect(pool.universe.cards.map((entry) => entry.name)).toEqual(['Alpha Guard', 'Beta Guard']);
    expect(pool.sourceCodes).toEqual(['AAA', 'BBB']);
  });

  it('converts a built list to exact physical ids from the format catalogs', () => {
    const catalogs = [
      catalog('AAA', 'aaa-printed-v1', [ALPHA, PLAINS]),
      catalog('BBB', 'bbb-printed-v1', [BETA]),
    ];
    const pool = printedFormatDeckPool('fixture', catalogs, criteria());
    const deck = toPrintedConstructedDeck(
      'white-aggro',
      'White Aggro',
      [
        {
          card: pool.universe.byName.get('alpha guard')!,
          count: 4,
          criteria: ['archetype'],
          reason: 'pressure',
        },
        {
          card: pool.universe.byName.get('beta guard')!,
          count: 4,
          criteria: ['archetype'],
          reason: 'pressure',
        },
      ],
      { W: 16, U: 0, B: 0, R: 0, G: 0 },
      pool,
    );
    expect(deck).toEqual({
      id: 'white-aggro',
      name: 'White Aggro',
      commanders: [],
      cards: [
        { physicalId: ALPHA.physicalId, name: 'Alpha Guard', count: 4 },
        { physicalId: BETA.physicalId, name: 'Beta Guard', count: 4 },
        { physicalId: PLAINS.physicalId, name: 'Plains', count: 16 },
      ],
    });
  });
});
