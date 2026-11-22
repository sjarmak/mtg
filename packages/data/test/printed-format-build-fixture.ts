import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FIXTURES } from './helpers';
import { parsePrintedSourcePin } from '../src/printed-card/source-pin';

export const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const original = JSON.parse(readFileSync(FIXTURES.oracleCards, 'utf8').split('\n')[0]!);
export const script = `Name:${String(original.name)}\n`;

export function buildFixture(codes = ['AKH', 'HOU', 'MP2']) {
  const sources = codes.map((code, index) => {
    const uuid = `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
    const card = { ...original, id: uuid, set: code.toLowerCase(), collector_number: '1' };
    const meta = { date: '2026-09-11', version: '5.3.0' };
    const mtgjson = JSON.stringify({
      meta,
      data: {
        code,
        name: code,
        baseSetSize: 1,
        totalSetSize: 1,
        releaseDate: '2017-04-28',
        type: 'expansion',
        cards: [
          {
            uuid,
            name: card.name,
            number: '1',
            rarity: 'common',
            setCode: code,
            identifiers: { scryfallId: card.id, scryfallOracleId: card.oracle_id },
          },
        ],
        booster: {
          draft: {
            sourceSetCodes: [code],
            boostersTotalWeight: 1,
            boosters: [{ weight: 1, contents: { common: 1 } }],
            sheets: { common: { cards: { [uuid]: 1 }, totalWeight: 1, foil: false } },
          },
        },
      },
    });
    const scryfall = JSON.stringify([card]);
    return {
      mtgjson,
      scryfall,
      descriptor: {
        code,
        mtgjson: {
          file: `${code}-${digest(mtgjson)}.mtgjson.json`,
          url: `https://mtgjson.com/api/v5/${code}.json`,
          sha256: digest(mtgjson),
          meta,
        },
        scryfall: {
          file: `${code}-${digest(scryfall)}.scryfall.json`,
          url: 'https://api.scryfall.com/cards/search',
          sha256: digest(scryfall),
          cards: 1,
        },
      },
    };
  });
  const files = new Map(
    sources.flatMap(
      (s) =>
        [
          [s.descriptor.mtgjson.file, s.mtgjson],
          [s.descriptor.scryfall.file, s.scryfall],
        ] as const,
    ),
  );
  const manifest = JSON.stringify({
    schemaVersion: 1,
    fetchedAt: '2026-09-11T00:00:00Z',
    sources: sources.map((s) => s.descriptor),
  });
  return { manifest, files, pin: parsePrintedSourcePin(manifest, (file) => files.get(file)!) };
}

export const recipe = {
  schemaVersion: 1,
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  sourceCodes: ['AKH', 'HOU', 'MP2'],
  products: [
    { id: 'akh-draft', setCode: 'AKH', boosterKey: 'draft' },
    { id: 'hou-draft', setCode: 'HOU', boosterKey: 'draft' },
  ],
  draft: { seats: 8, rounds: ['hou-draft', 'hou-draft', 'akh-draft'], botPolicy: 'printed-limited-v1' },
  sealed: { boosters: ['hou-draft', 'hou-draft', 'hou-draft', 'hou-draft', 'akh-draft', 'akh-draft'] },
  basicLandPolicy: 'remove',
};
export const forge = {
  version: 'test-version',
  scriptFor: () => ({
    path: 'l/lightning_bolt.txt',
    bytes: new TextEncoder().encode(script),
  }),
};
