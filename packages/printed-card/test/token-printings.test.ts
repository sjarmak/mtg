import { describe, expect, it } from 'vitest';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';

const UUID = '00000000-0000-0000-0000-000000000001';
const SHA = '0'.repeat(64);

const token = {
  physicalId: `tscd-token:0001:${UUID}`,
  position: 1,
  setCode: 'TSCD',
  name: 'Pegasus',
  observedNames: ['Pegasus Token'],
  oracleId: '00000000-0000-0000-0000-000000000002',
  scryfallId: UUID,
  typeLine: 'Token Creature — Pegasus',
  power: '1',
  toughness: '1',
  loyalty: null,
  colors: ['W'],
  faces: [
    {
      name: 'Pegasus',
      manaCost: null,
      typeLine: 'Token Creature — Pegasus',
      oracleText: 'Flying',
      power: '1',
      toughness: '1',
      loyalty: null,
      colors: ['W'],
    },
  ],
  art: {
    status: 'available',
    source: 'scryfall',
    scryfallId: UUID,
    images: [{ face: null, uris: { art_crop: 'https://cards.example/pegasus.jpg' } }],
  },
};

const VALID = {
  schemaVersion: 1,
  sets: [
    {
      code: 'TSCD',
      sourceUrl: 'https://api.scryfall.com/cards/search?q=set%3Atscd',
      sourceSha256: SHA,
      fetchedAt: '2026-09-15T22:57:38.697Z',
    },
  ],
  engine: { name: 'forge', version: '2.0.14' },
  tokens: [token],
};

describe('printed token printings', () => {
  it('accepts a token bound to the engine name that witnesses it', () => {
    const parsed = parsePrintedTokenPrintings(VALID);
    expect(parsed.tokens[0]?.observedNames).toEqual(['Pegasus Token']);
    expect(parsed.sets[0]?.code).toBe('TSCD');
  });

  it('refuses a token nobody witnessed, a non-token type line, and a set code outside the token sets', () => {
    expect(() =>
      parsePrintedTokenPrintings({ ...VALID, tokens: [{ ...token, observedNames: [] }] }),
    ).toThrow();
    expect(() =>
      parsePrintedTokenPrintings({ ...VALID, tokens: [{ ...token, typeLine: 'Creature — Pegasus' }] }),
    ).toThrow();
    expect(() => parsePrintedTokenPrintings({ ...VALID, tokens: [{ ...token, setCode: 'SCD' }] })).toThrow();
  });

  it('refuses two tokens sharing one physical id and art bound to another printing', () => {
    expect(() => parsePrintedTokenPrintings({ ...VALID, tokens: [token, token] })).toThrow(
      /duplicate token printing/u,
    );
    expect(() =>
      parsePrintedTokenPrintings({
        ...VALID,
        tokens: [{ ...token, art: { ...token.art, scryfallId: '00000000-0000-0000-0000-000000000099' } }],
      }),
    ).toThrow();
  });
});
