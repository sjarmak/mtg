import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPhysicalIdsByName } from '../tools/ingest-17lands-ktk';

const SHA = '0'.repeat(64);
const UUID_A = '00000000-0000-0000-0000-000000000001';
const UUID_B = '00000000-0000-0000-0000-000000000002';
const UUID_C = '00000000-0000-0000-0000-000000000003';

function catalogEntry(
  position: number,
  scryfallId: string,
  overrides: { readonly name?: string; readonly correctedName?: string } = {},
) {
  const name = overrides.name ?? `Card ${String(position)}`;
  return {
    physicalId: `ktk-printed-v1:${String(position).padStart(4, '0')}:${scryfallId}`,
    position,
    sourceName: name,
    correctedName: overrides.correctedName ?? name,
    name,
    oracleId: '00000000-0000-0000-0000-0000000000f0',
    scryfallId,
    forgeScript: 'f/card.txt',
    forgeScriptSha256: SHA,
    layout: 'normal',
    manaCost: '{1}',
    manaValue: 1,
    typeLine: 'Creature — Human',
    oracleText: null,
    power: '1',
    toughness: '1',
    loyalty: null,
    colors: [],
    colorIdentity: [],
    faces: [
      {
        name,
        manaCost: '{1}',
        typeLine: 'Creature — Human',
        oracleText: null,
        power: '1',
        toughness: '1',
        loyalty: null,
        colors: null,
      },
    ],
    art: {
      status: 'missing' as const,
      source: 'scryfall' as const,
      scryfallId,
      reason: 'fixture carries no art',
    },
  };
}

function catalogWith(cards: ReadonlyArray<ReturnType<typeof catalogEntry>>) {
  return {
    schemaVersion: 1,
    kind: 'printed-card-catalog',
    format: 'ktk-printed-v1',
    source: {
      provenanceArtifact: 'ktk-v1.json',
      provenanceSha256: SHA,
      scryfallProvider: 'Scryfall oracle_cards',
      scryfallBulkFile: 'oracle_cards.jsonl.gz',
      scryfallBulkSha256: SHA,
      scryfallBulkUpdatedAt: '2026-08-09T09:02:38.172+00:00',
    },
    forgeVersion: '2.0.14',
    cards,
    contentSha256: SHA,
  };
}

describe('loadPhysicalIdsByName', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ktk-catalog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('joins on the catalog entry, not an invented physicalId format', () => {
    const catalogPath = join(dir, 'ktk-printed-catalog-v1.json');
    writeFileSync(
      catalogPath,
      JSON.stringify(catalogWith([catalogEntry(1, UUID_A), catalogEntry(2, UUID_B)])),
      'utf8',
    );

    const { byName } = loadPhysicalIdsByName(catalogPath);

    // The canonical catalog format is `${format}:${paddedPosition}:${scryfallId}` — a
    // prior version of this tool instead stamped `17lands:${set}:${collectorNumber}:${scryfallId}`,
    // which does not match anything the printed draft surface looks ratings up by.
    expect(byName.get('Card 1')).toBe(`ktk-printed-v1:0001:${UUID_A}`);
    expect(byName.get('Card 2')).toBe(`ktk-printed-v1:0002:${UUID_B}`);
    expect(byName.size).toBe(2);
  });

  it('has no entry for a name the catalog does not carry', () => {
    const catalogPath = join(dir, 'ktk-printed-catalog-v1.json');
    writeFileSync(catalogPath, JSON.stringify(catalogWith([catalogEntry(1, UUID_A)])), 'utf8');

    const { byName } = loadPhysicalIdsByName(catalogPath);

    expect(byName.get('Not In The Catalog')).toBeUndefined();
  });

  it('resolves a name shared by several printings to the lowest position', () => {
    const catalogPath = join(dir, 'ktk-printed-catalog-v1.json');
    writeFileSync(
      catalogPath,
      JSON.stringify(
        catalogWith([
          catalogEntry(1, UUID_A, { name: 'Forest' }),
          catalogEntry(2, UUID_B, { name: 'Forest' }),
          catalogEntry(3, UUID_C, { name: 'Forest' }),
        ]),
      ),
      'utf8',
    );

    const { byName } = loadPhysicalIdsByName(catalogPath);

    expect(byName.get('Forest')).toBe(`ktk-printed-v1:0001:${UUID_A}`);
    expect(byName.size).toBe(1);
  });

  it('carries a correctedName index for a card whose printed name differs', () => {
    const catalogPath = join(dir, 'ktk-printed-catalog-v1.json');
    writeFileSync(
      catalogPath,
      JSON.stringify(
        catalogWith([
          catalogEntry(1, UUID_A, { name: 'Villainous Wealth', correctedName: 'Villainous Wealth' }),
        ]),
      ),
      'utf8',
    );

    const { byCorrectedName } = loadPhysicalIdsByName(catalogPath);

    expect(byCorrectedName.get('Villainous Wealth')).toBe(`ktk-printed-v1:0001:${UUID_A}`);
  });

  it('never reaches the card store: the catalog alone resolves every name', () => {
    // Regression guard for the bug this fixes: a prior version of this join
    // went through `@mtg/data`'s `findCardsByName`/`getPrintings`, which drops
    // any card whose store-kept printing is from a set other than KTK. There
    // is no store fixture here at all — if the join needs one, this file
    // fails to import, not just to assert.
    const catalogPath = join(dir, 'ktk-printed-catalog-v1.json');
    writeFileSync(
      catalogPath,
      JSON.stringify(catalogWith([catalogEntry(1, UUID_A, { name: 'Abzan Ascendancy' })])),
      'utf8',
    );

    const { byName } = loadPhysicalIdsByName(catalogPath);

    expect(byName.get('Abzan Ascendancy')).toBe(`ktk-printed-v1:0001:${UUID_A}`);
  });
});
