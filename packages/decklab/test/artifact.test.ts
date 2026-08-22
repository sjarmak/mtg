/**
 * What the browser is handed, checked at the seam.
 *
 * Two properties matter and neither is visible from inside the type system:
 * the artifact must survive a JSON round trip with nothing silently lost
 * (`undefined` is the trap — it type-checks and then vanishes), and it must
 * carry art the store actually holds rather than a URL assembled from a card
 * name.
 *
 * The deck itself is built in `support/built-deck.ts`, which `artifact-seam.test.ts`
 * builds from too, so both files exercise one producer.
 */
import { describe, expect, it } from 'vitest';
import { closeStore } from '@mtg/data';
import { toDeckArtifact, DECK_ARTIFACT_VERSION } from '../src/artifact';
import { createFakeStore } from './support/fake-store';
import { ART, builtColorlessDeck, builtDeck, DECK_CARDS, MOUNTAIN_ART } from './support/built-deck';

describe('toDeckArtifact', () => {
  it('takes art from the earliest real printing that has any', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtDeck(), store);
      const bolt = artifact.spells.find((entry) => entry.name === 'Lightning Bolt');
      expect(bolt?.art?.src).toBe(ART);
      expect(bolt?.art?.artist).toBe('Christopher Rush');
      expect(bolt?.art?.setCode).toBe('LEA');
    } finally {
      closeStore(store);
    }
  });

  it('renders a card the store has no art for as pending rather than as a guess', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtDeck(), store);
      expect(artifact.spells.find((entry) => entry.name === 'Goblin Guide')?.art).toBeNull();
    } finally {
      closeStore(store);
    }
  });

  it('reconstructs the basics from the store, with their counts and their art', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtDeck(), store);
      const mountain = artifact.basics.find((entry) => entry.name === 'Mountain');
      expect(mountain?.count).toBe(16);
      expect(mountain?.typeLine).toBe('Basic Land — Mountain');
      expect(mountain?.art?.src).toBe(MOUNTAIN_ART);
      expect(artifact.basics.find((entry) => entry.name === 'Plains')).toBeUndefined();
    } finally {
      closeStore(store);
    }
  });

  it('keeps the binding check, spelling an absent one as null so JSON holds it', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = JSON.parse(JSON.stringify(toDeckArtifact(builtDeck(), store))) as ReturnType<
        typeof toDeckArtifact
      >;
      const red = artifact.manaBase.colors.find((report) => report.color === 'R');
      expect(red?.binding?.cardName).toBeTypeOf('string');
      expect(red?.sourceFloor).toBeGreaterThan(0);
      for (const report of artifact.manaBase.colors) {
        expect(report).toHaveProperty('binding');
      }
    } finally {
      closeStore(store);
    }
  });

  it('carries the castability bands, so the page never hardcodes a threshold', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtDeck(), store);
      expect(artifact.manaBase.castabilityTarget).toBeGreaterThan(artifact.manaBase.heavyCastabilityTarget);
      expect(artifact.version).toBe(DECK_ARTIFACT_VERSION);
    } finally {
      closeStore(store);
    }
  });

  it('lists as many cards as it claims when no basic could be apportioned', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtColorlessDeck(), store);
      const listed = [...artifact.spells, ...artifact.lands, ...artifact.basics].reduce(
        (sum, entry) => sum + entry.count,
        0,
      );
      expect(artifact.basics).toEqual([]);
      expect(artifact.manaBase.totalLands).toBe(0);
      expect(listed).toBe(artifact.totalCards);
    } finally {
      closeStore(store);
    }
  });

  it('survives a JSON round trip with every field still present', () => {
    const store = createFakeStore(DECK_CARDS);
    try {
      const artifact = toDeckArtifact(builtDeck(), store);
      const roundTripped: unknown = JSON.parse(JSON.stringify(artifact));
      expect(roundTripped).toEqual(artifact);
      expect(JSON.stringify(artifact)).not.toContain('undefined');
    } finally {
      closeStore(store);
    }
  });
});
