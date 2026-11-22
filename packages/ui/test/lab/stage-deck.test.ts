/**
 * `npm run play` does not serve a deck `npm run lab` staged.
 *
 * The Decks tab reads `public/deck.json` whenever there is one, and what writes
 * it is `npm run lab`: a `@mtg/decklab` artifact, a deck of real printings cut
 * out of the card store under a prompt somebody typed. It is keyed by printed
 * name, it resolves against no staged set, and the Play tab cannot deal it.
 * Nothing ever removed it, so months after one `npm run lab` run every launch
 * of every set still offered that deck as one of yours.
 *
 * That is the precon file's failure and the run log's failure a third time, and
 * the difference is only that this one has no matching case to keep: an
 * artifact has no set to be about. So the rule under test is the whole of it —
 * the file goes, and the launcher says so once, when there was one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DECK_FILENAME, clearStagedDeck, describeClearedDeck } from '../../tools/stage-deck';

const DIR = mkdtempSync(join(tmpdir(), 'mtg-stage-deck-'));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('clearing a staged deck artifact', () => {
  it('removes the file the Decks tab reads, and says it did', () => {
    const publicDir = join(DIR, 'had-one');
    mkdirSync(publicDir, { recursive: true });
    const target = join(publicDir, DECK_FILENAME);
    // The document's contents do not matter: nothing reads one before removing it.
    writeFileSync(target, '{"version":1}\n');
    expect(clearStagedDeck(publicDir)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(describeClearedDeck(true)).toContain('npm run lab');
  });

  it('is silent when nothing was staged, rather than reporting a removal', () => {
    const publicDir = join(DIR, 'had-none');
    mkdirSync(publicDir, { recursive: true });
    expect(clearStagedDeck(publicDir)).toBe(false);
    expect(describeClearedDeck(false)).toBe('');
  });

  it('is the name `npm run lab` writes and the page fetches', () => {
    const lab = readFileSync(new URL('../../tools/lab.ts', import.meta.url), 'utf8');
    expect(lab).toContain('DECK_FILENAME');
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain(`deckUrl: '${DECK_FILENAME}'`);
  });
});
