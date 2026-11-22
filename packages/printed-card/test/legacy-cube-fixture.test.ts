import { describe, expect, it } from 'vitest';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

describe('the committed Legacy Cube catalog at the browser-safe seam', () => {
  it('parses all 600 positions without importing @mtg/data or a Node API', () => {
    const catalog = parsePrintedCardCatalog(catalogJson);
    expect(catalog.cards).toHaveLength(600);
    expect(catalog.cards[0]?.correctedName).toBe('Giver of Runes');
    expect(catalog.cards[599]?.position).toBe(600);
    expect(catalog.cards.filter((card) => card.faces.length > 1).length).toBeGreaterThan(0);
    expect(catalog.cards.every((card) => card.art.status === 'available')).toBe(true);
  });
});
