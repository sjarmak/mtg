/**
 * `npm run lab` resolution.
 *
 * Same shape as the `npm run play` launcher tests and for the same reason: the
 * launcher's real product is its failure modes, so most of this is about what
 * it says when there is no deck, or when the one it found is not a deck.
 *
 * The first test is the acceptance criterion for `mtg-bc2.75` in one line — a
 * clean checkout, no card store, no API key, a deck on screen.
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDeckDocument, resolveDeck } from '../../tools/resolve-deck';
import type { DeckCandidate } from '../../tools/resolve-deck';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const REAL_DECK = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

const CANDIDATES: readonly DeckCandidate[] = [
  { path: '/nowhere/out/decklab/deck.json', what: 'the most recent decklab run' },
  { path: REAL_DECK, what: 'the committed example deck' },
];

function scratch(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-lab-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('finding a deck', () => {
  it('falls back to the committed deck, so a clean checkout can render one', () => {
    const result = resolveDeck(CANDIDATES, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.cardCount).toBe(60);
    expect(result.what).toBe('the committed example deck');
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('prefers a decklab run when one exists', () => {
    const committed = readDeckDocument(REAL_DECK, 'unused');
    if (!committed.ok) throw new Error(committed.message);
    const result = resolveDeck(CANDIDATES, undefined, {
      exists: () => true,
      read: (path, what) => ({ ...committed, path, what }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.what).toBe('the most recent decklab run');
  });

  it('names every place it looked when there is nothing', () => {
    const result = resolveDeck(CANDIDATES, undefined, { exists: () => false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('no deck to show');
    expect(result.message).toContain('the most recent decklab run');
    expect(result.message).toContain('the committed example deck');
    expect(result.message).toContain('--artifact');
  });

  it('says where it looked for a deck the caller named', () => {
    const result = resolveDeck(CANDIDATES, 'nope.json', { cwd: '/tmp/checkout' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('/tmp/checkout/nope.json');
  });
});

describe('reading a deck document', () => {
  it('rejects a file that is not JSON, naming the file', () => {
    const path = scratch('deck.json', 'not json at all');
    const result = readDeckDocument(path, 'the deck you named');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain(path);
    expect(result.message).toContain('not valid JSON');
  });

  it('rejects a document that is missing a section, naming the field', () => {
    const path = scratch('deck.json', JSON.stringify({ version: 1, prompt: 'burn' }));
    const result = readDeckDocument(path, 'the deck you named');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('not a deck artifact this build can read');
    expect(result.message).toContain('`format`');
  });

  it('rejects an artifact written by a different version rather than half-rendering it', () => {
    const path = scratch('deck.json', JSON.stringify({ version: 999 }));
    const result = readDeckDocument(path, 'the deck you named');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('`version`');
  });

  it('counts every card in the deck, not every line', () => {
    const result = readDeckDocument(REAL_DECK, 'the committed example deck');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.cardCount).toBe(60);
  });
});
