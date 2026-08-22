import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import { loadKnownNames, normalizeName, outsideColorsGlob, selectUniverse } from '../src/candidates';
import { DeckCriteriaSchema } from '../src/criteria';
import { createFakeStore, SAMPLE_CARDS } from './support/fake-store';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

function universeFor(overrides: Record<string, unknown>) {
  store = createFakeStore(SAMPLE_CARDS);
  const criteria = DeckCriteriaSchema.parse({
    prompt: 'test',
    format: 'modern',
    ...overrides,
  });
  return selectUniverse(store, criteria);
}

describe('outsideColorsGlob', () => {
  it('matches identities containing a color the deck does not play', () => {
    expect(outsideColorsGlob(['W', 'U'])).toBe('*[BRG]*');
  });

  it('is null for five colors, where nothing is outside', () => {
    expect(outsideColorsGlob(['W', 'U', 'B', 'R', 'G'])).toBeNull();
  });
});

describe('normalizeName', () => {
  it('ignores case, punctuation and the back face', () => {
    expect(normalizeName("Jace, Vryn's Prodigy // Jace, Telepath Unbound")).toBe('jace vryns prodigy');
  });
});

describe('selectUniverse', () => {
  it('excludes cards not legal in the format', () => {
    const names = universeFor({}).cards.map((card) => card.name);
    expect(names).not.toContain('Force of Will');
    expect(names).toContain('Lightning Bolt');
  });

  it('excludes basic lands, which the mana base computes instead', () => {
    expect(universeFor({}).cards.map((card) => card.name)).not.toContain('Mountain');
  });

  it('excludes tokens, which are not deck cards', () => {
    expect(universeFor({}).cards.map((card) => card.name)).not.toContain('Goblin Token');
  });

  it('keeps only identities inside the stated colors', () => {
    const names = universeFor({ colors: ['R'] }).cards.map((card) => card.name);
    expect(names).toContain('Lightning Bolt');
    expect(names).not.toContain('Boros Charm');
    expect(names).not.toContain('Counterspell');
  });

  it('admits a card whose identity is a strict subset of the deck', () => {
    const names = universeFor({ colors: ['R', 'W'] }).cards.map((card) => card.name);
    expect(names).toContain('Lightning Bolt');
    expect(names).toContain('Boros Charm');
  });

  it('applies the mana value ceiling', () => {
    const values = universeFor({ maxManaValue: 1 }).cards.map((card) => card.manaValue);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  it('prices a card at its cheapest printing', () => {
    const bolt = universeFor({}).cards.find((card) => card.name === 'Lightning Bolt');
    expect(bolt?.priceUsd).toBeCloseTo(0.78);
  });

  it('drops cards over the per-card budget', () => {
    const names = universeFor({ budget: { maxCardUsd: 1 } }).cards.map((card) => card.name);
    expect(names).toContain('Lightning Bolt');
    expect(names).not.toContain('Sacred Foundry');
  });

  it('records the filters it applied', () => {
    const universe = universeFor({ colors: ['R'], maxManaValue: 2 });
    expect(universe.filters).toContain('legal in modern');
    expect(universe.filters).toContain('mana value <= 2');
  });
});

describe('loadKnownNames', () => {
  it('holds every card in the store, including ones the criteria exclude', () => {
    store = createFakeStore(SAMPLE_CARDS);
    const known = loadKnownNames(store);
    expect(known.has(normalizeName('Force of Will'))).toBe(true);
    expect(known.has(normalizeName('Not A Real Card'))).toBe(false);
  });
});
