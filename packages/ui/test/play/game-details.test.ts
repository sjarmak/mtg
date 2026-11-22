// @vitest-environment jsdom
/**
 * A game's technical name is one fact with one label, out of the chrome.
 *
 * Requirement 2 of the playtester's interface pass names the defect in its own
 * words: `seed lab/sealed/…` was drawn in the sealed builder's primary toolbar,
 * beside "pool 78" and "deck 40", where a person reading their deck's counts
 * reads a namespaced token they cannot act on. Requirements 25 and 26 are the
 * other half — the replay toolbar folded the same fact away but called it
 * *Seed*, and the precon table's menu called it *Game ID*.
 *
 * So: one label from one module, and in the builder it is behind the
 * disclosure rather than in the row of counts. The value stays whole, which
 * `./seed.test.ts` is the test of — a name that no longer reproduces the pool
 * is a name for nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { GAME_DETAILS_LABEL, GAME_ID_LABEL } from '../../src/routes/game-details';
import { SealedGame } from '../../src/routes/play/SealedGame';
import { SEED_LABEL } from '../../src/routes/play/SealedBuilder';
import { PRECON_TABLE_SEED_LABEL } from '../../src/routes/play/precon-strip';

afterEach(cleanup);

describe('the seed a surface shows', () => {
  it('is called the same thing on every surface that shows one', () => {
    expect(SEED_LABEL).toBe(GAME_ID_LABEL);
    expect(PRECON_TABLE_SEED_LABEL).toBe(GAME_ID_LABEL);
  });

  it('is behind the disclosure in the sealed builder, not in the count row', () => {
    const markup = renderToStaticMarkup(h(SealedGame, { set: EXAMPLE_CARDS, seed: 'lab/sealed/named' }));
    // The whole seed, because `#/play?seed=` takes the whole seed.
    expect(markup).toContain('lab/sealed/named');
    const toolbar = markup.slice(markup.indexOf('mtg-toolbar'), markup.indexOf('mtg-gamedetails'));
    expect(toolbar, 'the seed is still a counter in the primary toolbar').not.toContain('lab/sealed/named');
  });

  it('says what the disclosure holds before it is opened', () => {
    render(h(SealedGame, { set: EXAMPLE_CARDS, seed: 'lab/sealed/named' }));
    expect(screen.getByText(GAME_DETAILS_LABEL)).toBeTruthy();
    expect(screen.getByText(GAME_ID_LABEL)).toBeTruthy();
  });
});
