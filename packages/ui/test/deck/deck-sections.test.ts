/**
 * The branches the Deck page takes on its way to a heading or a count.
 *
 * Each one decides something a reader sees, and each was reachable and unheld:
 * mutating it left the whole `packages/ui` suite green.
 *
 *  - Whether a sideboard pane is drawn at all. `mtg-o5z1` made that turn on
 *    whether the document carries the field rather than on whether the list has
 *    cards in it, because those are different claims — `@mtg/decklab` writes no
 *    sideboard, and a page that drew `Sideboard: 0` over every deck it has ever
 *    built would be asserting something no builder decided.
 *  - The empty pane's own words, which only a document carrying an empty
 *    sideboard reaches.
 *  - `bindingCell` says "1 source" for a single pip and "N sources" otherwise.
 *    The committed deck prints both on one page, so "1 sources" would ship
 *    green under every other test in this package.
 *
 * The three-panes-by-card-class rule this file used to hold is gone with the
 * split it belonged to: an empty `Nonbasic lands` pane was a header over nothing
 * because the class was our own invention, and there is no equivalent now — the
 * main deck pane always has the deck in it.
 *
 * Assertions go through `renderToStaticMarkup` rather than the DOM, because the
 * workspace tsconfig has no `lib: dom` and `getAttribute` is not typed here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactColor, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { DeckRoute, SIDEBOARD_EMPTY_TEXT } from '../../src/routes/DeckRoute';
import { ManaBasePanel } from '../../src/routes/deck/ManaBasePanel';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedDeck(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(FIXTURE, 'utf8')), FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const DECK = committedDeck();

function deckMarkup(deck: DeckArtifact): string {
  return renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck } }));
}

function colorReport(color: string): DeckArtifactColor {
  const found = DECK.manaBase.colors.find((report) => report.color === color);
  if (found === undefined) throw new Error(`the fixture has no ${color} row`);
  return found;
}

function firstSpell(): DeckArtifactEntry {
  const [first] = DECK.spells;
  if (first === undefined) throw new Error('the fixture has no spells');
  return first;
}

describe('whether the sideboard pane is drawn', () => {
  it('draws none for a document that never mentioned one, that being nobody having said', () => {
    expect(DECK.sideboard).toBeUndefined();
    const html = deckMarkup(DECK);
    expect(html).not.toContain('Sideboard');
    expect(html).toContain('data-panes="1"');
  });

  it('draws one for a document carrying an empty sideboard, that being a builder saying none', () => {
    const html = deckMarkup({ ...DECK, sideboard: [] });
    expect(html).toContain('>Sideboard: 0<');
    expect(html).toContain('data-panes="2"');
  });

  it('says what an empty pane holds in its own words rather than leaving a gap', () => {
    const html = deckMarkup({ ...DECK, sideboard: [] });
    expect(html).toContain(`class="mtg-deck__empty">${SIDEBOARD_EMPTY_TEXT}<`);
  });

  it('gives an empty pane no stats line, there being no counts for one to carry', () => {
    const html = deckMarkup({ ...DECK, sideboard: [] });
    const heads = html.split('class="mtg-deck__section-head"');
    const sideboardHead = heads.find((chunk) => chunk.includes('>Sideboard: 0<'));
    expect(sideboardHead).toBeTruthy();
    expect(sideboardHead?.slice(0, sideboardHead.indexOf('mtg-deck__view'))).not.toContain(
      'mtg-deck__section-note',
    );
  });

  it('draws the cards when there are some, counted in the title', () => {
    const deck: DeckArtifact = { ...DECK, sideboard: [{ ...firstSpell(), count: 3 }] };
    const html = deckMarkup(deck);
    expect(html).toContain('>Sideboard: 3<');
    expect(html).not.toContain(SIDEBOARD_EMPTY_TEXT);
  });
});

describe('the card that set a color’s floor', () => {
  it('demands one pip in one of the committed deck’s colors and two in the other', () => {
    expect(colorReport('W').binding?.pips).toBe(1);
    expect(colorReport('R').binding?.pips).toBe(2);
  });

  it('is quoted in the singular when it asks for one source', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK }));
    expect(html).toContain('Lightning Helix</span> · 1 source by turn 2, to 90%');
  });

  it('is quoted in the plural when it asks for more than one', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK }));
    expect(html).toContain('Searing Blaze</span> · 2 sources by turn 2, to 80%');
  });
});
