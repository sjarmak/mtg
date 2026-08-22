import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import { loadKnownNames, normalizeName, selectUniverse } from '../src/candidates';
import { DeckCriteriaSchema, type DeckCriteriaInput } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import {
  cardCount,
  deckPrice,
  enforceDeckBudget,
  enforceLandSlot,
  landCount,
  spellCount,
  verifyProposals,
  type Proposal,
} from '../src/verify';
import { createFakeStore, SAMPLE_CARDS } from './support/fake-store';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

function verify(proposals: readonly Proposal[], overrides: Partial<DeckCriteriaInput> = {}) {
  store = createFakeStore(SAMPLE_CARDS);
  const criteria = DeckCriteriaSchema.parse({
    prompt: 'test',
    format: 'modern',
    archetype: 'aggro',
    ...overrides,
  });
  const universe = selectUniverse(store, criteria);
  return verifyProposals(proposals, universe, criteria, { knownNames: loadKnownNames(store) });
}

const bolt = (over: Partial<Proposal> = {}): Proposal => ({
  name: 'Lightning Bolt',
  count: 4,
  criteria: ['archetype'],
  reason: 'cheap reach',
  ...over,
});

describe('verifyProposals', () => {
  it('accepts a legal, in-color, correctly cited card', () => {
    const result = verify([bolt()]);
    expect(result.rejections).toEqual([]);
    expect(result.inclusions).toHaveLength(1);
    expect(result.inclusions[0]?.card.name).toBe('Lightning Bolt');
  });

  it('calls an invented card a hallucination, not an exclusion', () => {
    const result = verify([bolt({ name: 'Lightning Bolt of Doom' })]);
    expect(result.rejections[0]?.code).toBe('unknown-card');
  });

  it('distinguishes a real card the criteria exclude from one that does not exist', () => {
    const result = verify([bolt({ name: 'Force of Will' })]);
    expect(result.rejections[0]?.code).toBe('not-in-universe');
    expect(result.rejections[0]?.detail).toContain('is a real card');
  });

  it('rejects a citation the user never stated', () => {
    const result = verify([bolt({ criteria: ['budget'] })]);
    expect(result.rejections[0]?.code).toBe('unstated-criterion');
  });

  it('rejects an inclusion that cites nothing', () => {
    const result = verify([bolt({ criteria: [] })]);
    expect(result.rejections[0]?.code).toBe('no-criterion');
  });

  it('enforces the four-copy rule', () => {
    const result = verify([bolt({ count: 5 })]);
    expect(result.rejections[0]?.code).toBe('too-many-copies');
  });

  it('lets a card that says so exceed four copies', () => {
    const result = verify([bolt({ name: 'Relentless Rats', count: 12 })]);
    expect(result.rejections).toEqual([]);
    expect(result.inclusions[0]?.count).toBe(12);
  });

  it('caps every card at one in a singleton format', () => {
    const result = verify([bolt({ count: 2 })], { format: 'commander', colors: [] });
    expect(result.rejections[0]?.code).toBe('too-many-copies');
    expect(result.rejections[0]?.detail).toContain('limit here is 1');
  });

  it('collapses a card listed twice into a rejection rather than a double entry', () => {
    const result = verify([bolt(), bolt()]);
    expect(result.inclusions).toHaveLength(1);
    expect(result.rejections[0]?.code).toBe('duplicate');
  });

  it('keeps a rejected card out of the totals it reports', () => {
    const result = verify([bolt({ name: 'Nonexistent Card' }), bolt()]);
    expect(cardCount(result.inclusions)).toBe(4);
    expect(deckPrice(result.inclusions)).toBeCloseTo(4 * 0.78);
  });
});

describe('enforceDeckBudget', () => {
  function inclusionsFor(entries: readonly (readonly [string, number])[]) {
    store = createFakeStore(SAMPLE_CARDS);
    const criteria = DeckCriteriaSchema.parse({
      prompt: 'test',
      format: 'modern',
      colors: ['R', 'W'],
      budget: { maxDeckUsd: 10 },
    });
    const universe = selectUniverse(store, criteria);
    const inclusions = entries.map(([name, count]) => {
      const card = universe.byName.get(normalizeName(name));
      if (card === undefined) throw new Error(`${name} missing from test universe`);
      return { card, count, criteria: ['budget'], reason: 'test' };
    });
    return { inclusions, criteria };
  }

  it('cuts the most expensive entries until the deck fits', () => {
    const { inclusions, criteria } = inclusionsFor([
      ['Sacred Foundry', 4],
      ['Lightning Bolt', 4],
    ]);
    const result = enforceDeckBudget(inclusions, criteria);
    const names = result.inclusions.map((entry) => entry.card.name);
    expect(names).not.toContain('Sacred Foundry');
    expect(names).toContain('Lightning Bolt');
    expect(result.rejections[0]?.code).toBe('over-deck-budget');
  });

  it('leaves a deck inside its budget untouched', () => {
    const { inclusions, criteria } = inclusionsFor([['Lightning Bolt', 4]]);
    const result = enforceDeckBudget(inclusions, criteria);
    expect(result.inclusions).toHaveLength(1);
    expect(result.rejections).toEqual([]);
  });

  it('judges the accumulated deck, not one round of it', () => {
    // Regression: the budget used to be checked per round of proposals, so
    // several individually-affordable rounds combined into a deck well over
    // budget and were reported as compliant.
    const { inclusions, criteria } = inclusionsFor([
      ['Boros Charm', 3],
      ['Lightning Bolt', 4],
      ['Monastery Swiftspear', 4],
    ]);
    expect(deckPrice(inclusions)).toBeGreaterThan(10);
    const result = enforceDeckBudget(inclusions, criteria);
    expect(deckPrice(result.inclusions)).toBeLessThanOrEqual(10);
  });
});

describe('basic lands', () => {
  it('names a basic as a basic rather than as an excluded card', () => {
    // Regression for mtg-bc2.40's fix. Basics are held out of the universe, so
    // without a specific code a proposed Mountain came back as "a real card
    // that does not satisfy the criteria", which reads as "find a legal
    // replacement" instead of "the basics are not yours to choose".
    const result = verify([bolt({ name: 'Mountain' })]);
    expect(result.rejections[0]?.code).toBe('basic-land');
    expect(result.rejections[0]?.detail).toContain('computed from the pip demand');
    expect(result.inclusions).toEqual([]);
  });

  it('catches the snow-covered spelling too', () => {
    const result = verify([bolt({ name: 'Snow-Covered Mountain' })]);
    expect(result.rejections[0]?.code).toBe('basic-land');
  });

  it('still accepts a nonbasic land, which is the model to choose', () => {
    const result = verify([bolt({ name: 'Sacred Foundry', count: 4 })], { colors: ['R', 'W'] });
    expect(result.rejections).toEqual([]);
    expect(result.inclusions[0]?.card.name).toBe('Sacred Foundry');
  });
});

describe('enforceLandSlot', () => {
  function landsFor(entries: readonly (readonly [string, number])[], landCount: number) {
    store = createFakeStore(SAMPLE_CARDS);
    const criteria = resolveCriteria(
      DeckCriteriaSchema.parse({
        prompt: 'test',
        format: 'modern',
        colors: ['R', 'W'],
        size: 60,
        landCount,
      }),
      { count: landCount, source: 'stated', reason: 'as the player stated' },
    );
    const universe = selectUniverse(store, criteria);
    const inclusions = entries.map(([name, count]) => {
      const card = universe.byName.get(normalizeName(name));
      if (card === undefined) throw new Error(`${name} missing from test universe`);
      return { card, count, criteria: ['archetype'], reason: 'test' };
    });
    return { inclusions, criteria };
  }

  it('leaves a deck inside its land slot alone', () => {
    const { inclusions, criteria } = landsFor(
      [
        ['Sacred Foundry', 4],
        ['Lightning Bolt', 4],
      ],
      24,
    );
    const result = enforceLandSlot(inclusions, criteria);
    expect(result.inclusions).toHaveLength(2);
    expect(result.rejections).toEqual([]);
  });

  it('cuts lands past the slot and says which, so the next round can fix it', () => {
    const { inclusions, criteria } = landsFor(
      [
        ['Sacred Foundry', 4],
        ['Mishra’s Factory', 4],
        ['Lightning Bolt', 4],
      ],
      4,
    );
    const result = enforceLandSlot(inclusions, criteria);
    expect(landCount(result.inclusions)).toBe(4);
    expect(result.rejections[0]?.code).toBe('over-land-slot');
    expect(result.rejections[0]?.name).toBe('Mishra’s Factory');
    // Spells are never touched: the land slot is a claim about lands.
    expect(result.inclusions.map((entry) => entry.card.name)).toContain('Lightning Bolt');
  });
});

describe('counting a deck', () => {
  it('separates lands from spells, because only spells count against the spell target', () => {
    const { inclusions } = (() => {
      store = createFakeStore(SAMPLE_CARDS);
      const criteria = DeckCriteriaSchema.parse({
        prompt: 'test',
        format: 'modern',
        colors: ['R', 'W'],
      });
      const universe = selectUniverse(store, criteria);
      const pick = (name: string, count: number) => {
        const card = universe.byName.get(normalizeName(name));
        if (card === undefined) throw new Error(`${name} missing`);
        return { card, count, criteria: ['archetype'], reason: 'test' };
      };
      return { inclusions: [pick('Lightning Bolt', 4), pick('Sacred Foundry', 3)] };
    })();

    expect(cardCount(inclusions)).toBe(7);
    expect(spellCount(inclusions)).toBe(4);
    expect(landCount(inclusions)).toBe(3);
  });
});

describe('normalizeName matching', () => {
  it('accepts a proposal whose punctuation differs from the printed name', () => {
    expect(normalizeName('lightning  bolt')).toBe(normalizeName('Lightning Bolt'));
  });
});
