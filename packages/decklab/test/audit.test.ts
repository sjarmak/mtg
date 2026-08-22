import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import { auditDeck, type DeckEntry } from '../src/audit';
import { DeckCriteriaSchema, type DeckCriteriaInput } from '../src/criteria';
import { createFakeStore, SAMPLE_CARDS } from './support/fake-store';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

function audit(entries: readonly DeckEntry[], overrides: Partial<DeckCriteriaInput> = {}) {
  store = createFakeStore(SAMPLE_CARDS);
  const criteria = DeckCriteriaSchema.parse({
    prompt: 'test',
    format: 'modern',
    colors: ['R'],
    size: 60,
    landCount: 24,
    ...overrides,
  });
  return auditDeck(store, entries, criteria);
}

/**
 * 60 cards, nothing over four copies except the basics, which are exempt. The
 * sample store holds only two red nonland cards, so the Mountains carry the
 * count; that is fine, and it exercises the basic-land exemption directly.
 */
const LEGAL_DECK: readonly DeckEntry[] = [
  { name: 'Lightning Bolt', count: 4 },
  { name: 'Monastery Swiftspear', count: 4 },
  { name: 'Mountain', count: 52 },
];

describe('auditDeck', () => {
  it('passes a deck that breaks no rule', () => {
    const result = audit(LEGAL_DECK);
    expect(result.violations).toEqual([]);
    expect(result.totalCards).toBe(60);
    expect(result.sizeDelta).toBe(0);
    expect(result.clean).toBe(true);
  });

  it('counts basic lands without calling them off-colour or over the copy limit', () => {
    const result = audit(LEGAL_DECK);
    expect(result.violations.filter((v) => v.kind === 'off-colour')).toEqual([]);
    expect(result.violations.filter((v) => v.kind === 'too-many-copies')).toEqual([]);
  });

  it('flags a card that does not exist', () => {
    const result = audit([{ name: 'Bolt of Lightning', count: 4 }]);
    expect(result.violations[0]?.kind).toBe('unknown-card');
    expect(result.offendingCards).toBe(4);
  });

  it('flags a real card that is illegal in the format', () => {
    const result = audit([{ name: 'Force of Will', count: 1 }], { colors: ['U'] });
    expect(result.violations.some((v) => v.kind === 'illegal-in-format')).toBe(true);
  });

  it('flags a card outside the stated colors', () => {
    const result = audit([{ name: 'Counterspell', count: 4 }]);
    expect(result.violations.some((v) => v.kind === 'off-colour')).toBe(true);
  });

  it('flags a fifth copy', () => {
    const result = audit([{ name: 'Lightning Bolt', count: 5 }]);
    expect(result.violations.some((v) => v.kind === 'too-many-copies')).toBe(true);
  });

  it('allows any number of a card that says so', () => {
    const result = audit([{ name: 'Relentless Rats', count: 20 }], { colors: ['B'] });
    expect(result.violations.filter((v) => v.kind === 'too-many-copies')).toEqual([]);
  });

  it('caps at one in a singleton format', () => {
    const result = audit([{ name: 'Lightning Bolt', count: 2 }], {
      format: 'commander',
      size: 100,
    });
    expect(result.violations.some((v) => v.kind === 'too-many-copies')).toBe(true);
  });

  it('flags a card over the per-card budget and totals the deck price', () => {
    const result = audit([{ name: 'Sacred Foundry', count: 1 }], {
      colors: ['R', 'W'],
      budget: { maxCardUsd: 5 },
    });
    expect(result.violations.some((v) => v.kind === 'over-card-budget')).toBe(true);
    expect(result.deckPriceUsd).toBeCloseTo(12);
  });

  it('reports a deck over its total budget', () => {
    const result = audit([{ name: 'Sacred Foundry', count: 4 }], {
      colors: ['R', 'W'],
      budget: { maxDeckUsd: 10 },
    });
    expect(result.overDeckBudget).toBe(true);
    expect(result.clean).toBe(false);
  });

  it('flags a card above the stated mana value', () => {
    const result = audit([{ name: 'Relentless Rats', count: 1 }], {
      colors: ['B'],
      maxManaValue: 2,
    });
    expect(result.violations.some((v) => v.kind === 'over-mana-value')).toBe(true);
  });

  it('picks the real card over a same-named token', () => {
    // The store holds a `token` row named exactly "Ornithopter", marked
    // not_legal everywhere, alongside the real card. Selecting the token
    // scored a legal deck as illegal in the first run of the comparison.
    store = createFakeStore([
      ...SAMPLE_CARDS,
      {
        name: 'Ornithopter',
        manaCost: '{0}',
        manaValue: 0,
        typeLine: 'Token Creature — Thopter',
        colorIdentity: '',
        layout: 'token',
        legalities: { modern: 'not_legal' },
      },
      {
        name: 'Ornithopter',
        manaCost: '{0}',
        manaValue: 0,
        typeLine: 'Artifact Creature — Thopter',
        colorIdentity: '',
        legalities: { modern: 'legal' },
      },
    ]);
    const criteria = DeckCriteriaSchema.parse({ prompt: 'test', format: 'modern', size: 60 });
    const result = auditDeck(store, [{ name: 'Ornithopter', count: 4 }], criteria);
    expect(result.violations.filter((v) => v.kind === 'illegal-in-format')).toEqual([]);
  });

  it('picks the real double-faced card over an art-series row with the same front face', () => {
    store = createFakeStore([
      ...SAMPLE_CARDS,
      {
        name: 'Delver of Secrets // Delver of Secrets',
        manaCost: '{U}',
        manaValue: 1,
        typeLine: 'Card',
        colorIdentity: 'U',
        layout: 'art_series',
        legalities: { legacy: 'not_legal' },
      },
      {
        name: 'Delver of Secrets // Insectile Aberration',
        manaCost: '{U}',
        manaValue: 1,
        typeLine: 'Creature — Human Wizard',
        colorIdentity: 'U',
        layout: 'transform',
        legalities: { legacy: 'legal' },
      },
    ]);
    const criteria = DeckCriteriaSchema.parse({
      prompt: 'test',
      format: 'legacy',
      colors: ['U'],
      size: 60,
    });
    const result = auditDeck(store, [{ name: 'Delver of Secrets', count: 4 }], criteria);
    expect(result.violations).toEqual([]);
  });

  it('reports the gap when the deck is the wrong size', () => {
    const result = audit([{ name: 'Lightning Bolt', count: 4 }]);
    expect(result.sizeDelta).toBe(-56);
    expect(result.clean).toBe(false);
  });
});
