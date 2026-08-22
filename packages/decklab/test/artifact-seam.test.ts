/**
 * One deck artifact, written by the producer and read by the other declaration.
 *
 * `@mtg/ui` states the deck artifact's schema a second time because it must not
 * depend on `@mtg/decklab`: that would put `better-sqlite3` on a browser's
 * module graph (AGENTS.md). The price of that decision is this file. Until
 * mtg-bc2.133 nothing read one artifact through both sides, so the producer
 * could gain a field, lose a field or bump its version alone and every suite
 * stayed green until a page rendered blank.
 *
 * The pattern is the art pipeline's manifest test, which does the same for
 * the art manifest's three declarations: the producer's own package builds the
 * document with the real producer and hands it to the consumer's real parser.
 * A test that hand-wrote the document would check the schema against a fixture
 * and leave the seam exactly as unguarded as it was.
 *
 * Both directions of drift are covered here. A field the producer adds and the
 * page does not declare is dropped by the reader and caught by the equality; a
 * field the page requires and the producer stops writing fails the parse.
 */
import { describe, expect, it } from 'vitest';
import { closeStore } from '@mtg/data';
import { DECK_ARTIFACT_VERSION as PAGE_VERSION, readDeckArtifact } from '@mtg/ui';
import { toDeckArtifact, DECK_ARTIFACT_VERSION } from '../src/artifact';
import type { DeckArtifact } from '../src/artifact';
import { builtColorlessDeck, builtDeck, DECK_CARDS } from './support/built-deck';
import { createFakeStore } from './support/fake-store';

/** The document as it reaches a browser: written by the producer, through JSON. */
function staged(deck: () => ReturnType<typeof builtDeck>): unknown {
  const store = createFakeStore(DECK_CARDS);
  try {
    return JSON.parse(JSON.stringify(toDeckArtifact(deck(), store))) as unknown;
  } finally {
    closeStore(store);
  }
}

describe('the deck artifact across both of its declarations', () => {
  it('parses what the producer wrote through the schema the page declares', () => {
    const result = readDeckArtifact(staged(builtDeck), 'the built deck');
    expect(result.ok ? '' : result.message).toBe('');
    expect(result.ok).toBe(true);
  });

  it('keeps every field the producer wrote, so neither side may drift alone', () => {
    const document = staged(builtDeck);
    const result = readDeckArtifact(document, 'the built deck');
    if (!result.ok) throw new Error(result.message);
    // The reader is a Zod object: a field the producer writes and the page does
    // not declare is stripped here, and this equality is where that shows.
    expect(result.deck).toEqual(document);
    expect(result.deck.spells.length).toBeGreaterThan(0);
    expect(result.deck.basics.length).toBeGreaterThan(0);
    expect(result.deck.manaBase.colors.length).toBeGreaterThan(0);
    expect(result.deck.criteria.length).toBeGreaterThan(0);
  });

  it('states one version on both sides, and the artifact carries it', () => {
    const result = readDeckArtifact(staged(builtDeck), 'the built deck');
    if (!result.ok) throw new Error(result.message);
    expect(DECK_ARTIFACT_VERSION).toBe(PAGE_VERSION);
    expect(result.deck.version).toBe(DECK_ARTIFACT_VERSION);
  });

  it('refuses a version only one side has bumped, naming the field', () => {
    const bumped = { ...(staged(builtDeck) as DeckArtifact), version: DECK_ARTIFACT_VERSION + 1 };
    const result = readDeckArtifact(bumped, 'the built deck');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('version');
  });

  it('writes no sideboard at all, this builder being one that leaves nothing over', () => {
    // `mtg-o5z1`. The absence is the claim: `selectCards` proposes exactly the
    // deck and `verify.ts` refuses cards rather than setting them aside, so an
    // empty array here would assert a decision no stage of this pipeline makes.
    const document = staged(builtDeck) as Record<string, unknown>;
    expect('sideboard' in document).toBe(false);
    const result = readDeckArtifact(document, 'the built deck');
    if (!result.ok) throw new Error(result.message);
    expect(result.deck.sideboard).toBeUndefined();
  });

  it('reads a staged deck that does carry one, the field being optional rather than forbidden', () => {
    // The document is the contract for a staged deck, not for this producer's
    // output: `npm run lab -- <path>` reads any file through the page's schema.
    const document = staged(builtDeck) as DeckArtifact;
    const [aside] = document.spells;
    if (aside === undefined) throw new Error('the built deck has no spells');
    const result = readDeckArtifact({ ...document, sideboard: [aside] }, 'a staged deck');
    if (!result.ok) throw new Error(result.message);
    expect(result.deck.sideboard).toHaveLength(1);
    expect(result.deck.sideboard?.[0]?.name).toBe(aside.name);
  });

  it('reads a deck whose land slot took no basics, which is a real deck, not an error', () => {
    const document = staged(builtColorlessDeck);
    const result = readDeckArtifact(document, 'the colorless deck');
    if (!result.ok) throw new Error(result.message);
    expect(result.deck.basics).toEqual([]);
    expect(result.deck).toEqual(document);
  });
});
