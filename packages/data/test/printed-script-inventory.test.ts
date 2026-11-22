import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parsePrintedCardCatalog, serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import { buildPrintedScriptInventory } from '../src/printed-card/script-inventory';

const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const original = parsePrintedCardCatalog(
  JSON.parse(readFileSync(new URL('../data/akh-hou/akh-printed-catalog-v1.json', import.meta.url), 'utf8')),
);
const script = [
  'Name:Example',
  'K:Cycling:3 G',
  'T:Mode$ Cycled | Execute$ Search',
  'SVar:Search:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield',
  'A:AB$ Draw | Cost$ 1',
  'A:SP$ Draw | Cost$ 1',
  'Oracle:This prose mentions DB$ Fake and K:Fake.',
  '# A:SP$ Comment',
].join('\n');
function fixture(path = 'e/example.txt') {
  const catalog = {
    ...original,
    cards: [{ ...original.cards[0]!, forgeScript: path, forgeScriptSha256: digest(script) }],
  };
  return { ...catalog, contentSha256: digest(serializedPrintedCardCatalogContent(catalog)) };
}

describe('printing-to-script audit inventory (not play evidence)', () => {
  it('extracts literal script tokens, never treating script presence as reviewed support', () => {
    const catalog = fixture();
    const result = buildPrintedScriptInventory([catalog], () => script);
    expect(result.kind).toBe('printed-script-review-inventory');
    expect(result.cards).toEqual([
      {
        physicalId: catalog.cards[0]!.physicalId,
        name: catalog.cards[0]!.name,
        catalogFormat: catalog.format,
        forgeScript: 'e/example.txt',
        forgeScriptSha256: digest(script),
        review: 'pending',
        keywords: ['Cycling'],
        apis: ['ChangeZone', 'Draw'],
        triggerModes: ['Cycled'],
      },
    ]);
    expect(result.catalogs).toEqual([{ format: catalog.format, contentSha256: catalog.contentSha256 }]);
    expect(JSON.stringify(result)).not.toContain('Oracle:');
    expect(JSON.stringify(result)).not.toContain('Fake');
  });

  it('rejects stale catalog bytes before reading scripts', () => {
    const read = vi.fn(() => script);
    expect(() => buildPrintedScriptInventory([{ ...fixture(), forgeVersion: 'changed' }], read)).toThrow(
      /catalog checksum/i,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects changed scripts rather than preserving stale review hints', () => {
    expect(() => buildPrintedScriptInventory([fixture()], () => `${script}\n`)).toThrow(/script checksum/i);
  });

  it('propagates a missing script instead of recording an empty supported card', () => {
    expect(() =>
      buildPrintedScriptInventory([fixture()], () => {
        throw new Error('missing script');
      }),
    ).toThrow('missing script');
  });

  it.each(['../outside.txt', '/outside.txt', 'a/../../outside.txt', 'a/[wildcard].txt', '-x', '-option.txt'])(
    'refuses unsafe archive member %s before IO',
    (path) => {
      const read = vi.fn(() => script);
      expect(() => buildPrintedScriptInventory([fixture(path)], read)).toThrow(/script path/i);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('rejects empty input and repeated catalog identities', () => {
    expect(() => buildPrintedScriptInventory([], () => script)).toThrow(/catalog/i);
    expect(() => buildPrintedScriptInventory([fixture(), fixture()], () => script)).toThrow(
      /duplicate catalog/i,
    );
  });

  it('keeps vanilla cards pending with no invented decision family', () => {
    const bytes = 'Name:Example\nManaCost:1 G\nTypes:Creature\nPT:2/2\n';
    const unsealed = { ...fixture(), cards: [{ ...fixture().cards[0]!, forgeScriptSha256: digest(bytes) }] };
    const catalog = { ...unsealed, contentSha256: digest(serializedPrintedCardCatalogContent(unsealed)) };
    expect(buildPrintedScriptInventory([catalog], () => bytes).cards[0]).toMatchObject({
      review: 'pending',
      keywords: [],
      apis: [],
      triggerModes: [],
    });
  });

  it('retains all 550 printing identities even when scripts repeat, independent of catalog input order', () => {
    const catalogs = ['akh', 'hou', 'mp2'].map((code) => {
      const source = parsePrintedCardCatalog(
        JSON.parse(
          readFileSync(new URL(`../data/akh-hou/${code}-printed-catalog-v1.json`, import.meta.url), 'utf8'),
        ),
      );
      // Synthetic script bytes test accounting only, never actual card compatibility.
      const unsealed = {
        ...source,
        cards: source.cards.map((card) => ({ ...card, forgeScriptSha256: digest(script) })),
      };
      return { ...unsealed, contentSha256: digest(serializedPrintedCardCatalogContent(unsealed)) };
    });
    const result = buildPrintedScriptInventory(catalogs, () => new TextEncoder().encode(script));
    expect(result.cards).toHaveLength(550);
    expect(new Set(result.cards.map((card) => card.physicalId)).size).toBe(550);
    expect(result.cards.map((card) => card.physicalId)).toEqual(
      catalogs.flatMap((catalog) => catalog.cards.map((card) => card.physicalId)),
    );
    expect(new Set(result.cards.map((card) => card.review))).toEqual(new Set(['pending']));
    expect(buildPrintedScriptInventory([...catalogs].reverse(), () => script)).toEqual(result);
  });

  it('validates later catalogs before reading earlier valid ones', () => {
    const later = parsePrintedCardCatalog(
      JSON.parse(
        readFileSync(new URL('../data/akh-hou/hou-printed-catalog-v1.json', import.meta.url), 'utf8'),
      ),
    );
    const read = vi.fn(() => script);
    expect(() =>
      buildPrintedScriptInventory([fixture(), { ...later, forgeVersion: 'changed' }], read),
    ).toThrow(/catalog checksum/i);
    expect(read).not.toHaveBeenCalled();
  });

  it('retains exact numbered declarations once per script, separate from all printing identities', () => {
    const source = fixture();
    const second = {
      ...source.cards[0]!,
      position: 2,
      physicalId: source.cards[0]!.physicalId.replace(':0001:', ':0002:'),
    };
    const unsealed = { ...source, cards: [...source.cards, second] };
    const catalog = { ...unsealed, contentSha256: digest(serializedPrintedCardCatalogContent(unsealed)) };
    const read = vi.fn(() => script);
    const inventory = buildPrintedScriptInventory([catalog], read);
    expect(inventory.cards).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
    expect(inventory.scripts).toEqual([
      {
        path: 'e/example.txt',
        sha256: digest(script),
        lines: script
          .split('\n')
          .slice(0, 6)
          .map((text, index) => ({ number: index + 1, text })),
      },
    ]);
  });
});
