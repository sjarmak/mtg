import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrintedSourcePin } from '../src/printed-card/source-pin';
import { buildPrintedSetCatalog } from '../src/printed-card/set-catalog';
import { FIXTURES } from './helpers';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const card = {
  ...JSON.parse(readFileSync(FIXTURES.oracleCards, 'utf8').split('\n')[0]!),
  set: 'akh',
  collector_number: '1',
};
function mtgjsonFor(name: string): string {
  const row = {
    uuid: '00000000-0000-0000-0000-000000000001',
    name,
    number: '1',
    rarity: 'common',
    setCode: 'AKH',
    identifiers: { scryfallId: card.id, scryfallOracleId: card.oracle_id },
  };
  return JSON.stringify({
    meta: { date: '2026-09-11', version: '5.3.0' },
    data: {
      code: 'AKH',
      name: 'Amonkhet',
      baseSetSize: 1,
      totalSetSize: 1,
      releaseDate: '2017-04-28',
      type: 'expansion',
      cards: [row, { ...row, uuid: '00000000-0000-0000-0000-000000000002' }],
    },
  });
}
function fixture(scryfallCards = [card]) {
  const mtgjson = mtgjsonFor(scryfallCards[0]?.name ?? card.name);
  const scryfall = JSON.stringify(scryfallCards);
  const descriptor = {
    code: 'AKH',
    mtgjson: {
      file: `AKH-${digest(mtgjson)}.mtgjson.json`,
      url: 'https://mtgjson.com/api/v5/AKH.json',
      sha256: digest(mtgjson),
      meta: { date: '2026-09-11', version: '5.3.0' },
    },
    scryfall: {
      file: `AKH-${digest(scryfall)}.scryfall.json`,
      url: 'https://api.scryfall.com/cards/search?q=set%3Aakh+lang%3Aen',
      sha256: digest(scryfall),
      cards: scryfallCards.length,
    },
  };
  const manifest = JSON.stringify({
    schemaVersion: 1,
    fetchedAt: '2026-09-11T00:00:00Z',
    sources: [descriptor],
  });
  const files = new Map([
    [descriptor.mtgjson.file, mtgjson],
    [descriptor.scryfall.file, scryfall],
  ]);
  const pin = parsePrintedSourcePin(manifest, (file) => files.get(file)!);
  return { pin, manifest, files, descriptor };
}
const forge = {
  version: '2.0.14',
  scriptFor: () => ({ path: 'l/lightning_bolt.txt', bytes: new TextEncoder().encode(`Name:${card.name}\n`) }),
};

describe('offline source pin and printed set catalog', () => {
  it('coalesces MTGJSON face aliases without duplicating a physical printing', () => {
    const { pin } = fixture();
    const built = buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', forge);
    expect(built.catalog.cards).toHaveLength(1);
    expect(built.uuidToPhysicalId.size).toBe(2);
    expect(new Set(built.uuidToPhysicalId.values()).size).toBe(1);
    expect(built.catalog.cards[0]?.physicalId).toBe(`akh-printed-v1:0001:${card.id}`);
    expect(built.catalog.source.provenanceSha256).toBe(pin.sha256);
    expect(built.catalog.source.scryfallProvider).toBe('scryfall-search-snapshot');
  });

  it('fails before reading a path outside the source directory', () => {
    const { descriptor } = fixture();
    const raw = JSON.stringify({
      schemaVersion: 1,
      fetchedAt: 'now',
      sources: [{ ...descriptor, mtgjson: { ...descriptor.mtgjson, file: '../outside.json' } }],
    });
    expect(() =>
      parsePrintedSourcePin(raw, () => {
        throw new Error('must not read');
      }),
    ).toThrow(/file|datetime/);
  });

  it('rejects corrupted bytes and duplicate source descriptors', () => {
    const { manifest, descriptor } = fixture();
    expect(() => parsePrintedSourcePin(manifest, () => '{}')).toThrow(/checksum/);
    expect(() =>
      parsePrintedSourcePin(
        JSON.stringify({
          schemaVersion: 1,
          fetchedAt: '2026-09-11T00:00:00Z',
          sources: [descriptor, descriptor],
        }),
        () => '{}',
      ),
    ).toThrow(/duplicate source/);
  });

  it('does not replace a missing exact printing with another copy of its Oracle card', () => {
    const { pin } = fixture([{ ...card, id: '00000000-0000-0000-0000-000000000003' }]);
    expect(() => buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', forge)).toThrow(
      /exact printing/,
    );
  });

  it('rejects wrong printing facts even when the Scryfall ID matches', () => {
    const { pin } = fixture([{ ...card, collector_number: '2' }]);
    expect(() => buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', forge)).toThrow(
      /identity drift/,
    );
  });

  it.each([
    ['Split', 'Dusk // Dawn', 'split', 'Dusk // Dawn'],
    ['DoubleFaced', 'Screeching Bat // Stalking Vampire', 'transform', 'Screeching Bat'],
    ['Adventure', 'Bonecrusher Giant // Stomp', 'adventure', 'Bonecrusher Giant'],
  ])(
    'corrects a multi-face name to what Forge registers: AlternateMode %s',
    (alternateMode, name, layout, correctedName) => {
      const faced = { ...card, name, layout };
      const { pin } = fixture([faced]);
      const [front, back] = name.split(' // ');
      const built = buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', {
        ...forge,
        scriptFor: () => ({
          path: 'x/faced.txt',
          bytes: new TextEncoder().encode(
            `Name:${front!}\nAlternateMode:${alternateMode}\nALTERNATE\nName:${back!}\n`,
          ),
        }),
      });
      expect(built.catalog.cards[0]).toMatchObject({ name, sourceName: name, correctedName });
    },
  );

  it('checks Forge Name lines, not just a plausible script filename', () => {
    const { pin } = fixture();
    expect(() =>
      buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', { ...forge, scriptFor: () => null }),
    ).toThrow(/missing Forge/);
    expect(() =>
      buildPrintedSetCatalog(pin.sources[0]!, pin, 'sources.json', {
        ...forge,
        scriptFor: () => ({
          path: 'l/lightning_bolt.txt',
          bytes: new TextEncoder().encode('Name:Wrong Card\n'),
        }),
      }),
    ).toThrow(/Forge name/);
  });
});
