/**
 * What the Deck tab renders for the decks that are not the happy one.
 *
 * Both cases here were found by serving `packages/ui` and looking at the page,
 * and both are states the committed artifact and its producer actually reach:
 *
 *  - A nonbasic land's `manaCost` is `''` in the committed deck, not `null`.
 *    Both spellings mean "this card has no mana cost", and the tile rendered an
 *    empty `<span class="mtg-deck-card__cost">` for one of them.
 *  - A deck whose criteria name no colors has no per-color rows at all. The
 *    rows are `assembleDeck`'s, one per entry of `resolveDeckColors`, and that
 *    returns nothing when the criteria name no colors and no spell carries a
 *    fixed pip. The panel drew nine column headers over an empty body, followed
 *    by a paragraph explaining how the absent rows were scored.
 *
 * That second state is built here by hand rather than by assembling a deck.
 * This package renders artifacts and does not produce them, so what is held
 * here is the page over a shape decklab can emit. That decklab emits it is
 * `resolveDeckColors`'s to hold, and `packages/decklab/test/assemble.test.ts`
 * covers its stated-colors and derived-colors cases but not the empty one.
 * Naming the wrong producer survived this file precisely because these
 * assertions are about the outcome: nothing here reaches the route, so nothing
 * here could contradict a docstring that described the wrong one.
 *
 * Assertions go through `renderToStaticMarkup` rather than the DOM, because the
 * workspace tsconfig has no `lib: dom` and `getAttribute` is not typed here —
 * the same reason `test/lab/deck-route.test.ts` gives.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { DeckTile } from '../../src/routes/deck/DeckTile';
import { ManaBasePanel } from '../../src/routes/deck/ManaBasePanel';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedDeck(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(FIXTURE, 'utf8')), FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const DECK = committedDeck();

function entryNamed(name: string): DeckArtifactEntry {
  const found = [...DECK.spells, ...DECK.lands, ...DECK.basics].find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`the fixture has no ${name}`);
  return found;
}

describe('a card with no mana cost', () => {
  it('is spelled two ways by the committed deck, which is why this matters', () => {
    expect(entryNamed('Battlefield Forge').manaCost).toBe('');
    expect(entryNamed('Mountain').manaCost).toBeNull();
  });

  it('renders no cost element for a land whose cost is an empty string', () => {
    const html = renderToStaticMarkup(h(DeckTile, { entry: entryNamed('Battlefield Forge') }));
    expect(html).not.toContain('mtg-deck-card__cost');
  });

  it('renders no cost element for a basic land, whose cost is null', () => {
    const html = renderToStaticMarkup(h(DeckTile, { entry: entryNamed('Mountain') }));
    expect(html).not.toContain('mtg-deck-card__cost');
  });

  it('still prints the cost of a card that has one, painted from the registry', () => {
    // The tile paints a real printing's cost with the same registry the card
    // face uses, so the brace token is an abbreviation rather than a run of
    // text — and it is still the token, which is what a reader copies and what
    // this assertion reads.
    const bolt = entryNamed('Lightning Bolt');
    const html = renderToStaticMarkup(h(DeckTile, { entry: bolt }));
    const cost = /class="mtg-deck-card__cost">([\s\S]*?)<\/span><\/span>/.exec(html)?.[1] ?? '';
    expect(cost).not.toBe('');
    expect(cost.replace(/<[^>]*>/g, '')).toBe(String(bolt.manaCost));
    expect(cost).toContain('data-symbol="{R}"');
  });
});

describe('a deck that asks for no colored mana', () => {
  const colorless: DeckArtifact = { ...DECK, manaBase: { ...DECK.manaBase, colors: [] } };

  it('draws no table, a header row over an empty body being a table of nothing', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: colorless }));
    expect(html).not.toContain('<table');
    expect(html).not.toContain('castable on curve');
  });

  it('drops the paragraph that explains how rows are scored, there being no rows', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: colorless }));
    expect(html).not.toContain('cheapest requirement is held to');
  });

  it('says why the table is missing instead of leaving a gap', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: colorless }));
    expect(html).toContain('No card here asks for colored mana');
  });

  it('keeps the land count and its reason, which are still the deck’s', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: colorless }));
    expect(html).toContain(`${String(DECK.manaBase.totalLands)} lands`);
    expect(html).toContain(DECK.landPlan.reason);
  });

  it('leaves the ordinary deck its table and its bands', () => {
    // The guard against fixing the empty case by deleting the panel: the
    // committed deck has two colors and must still render both halves.
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK }));
    expect(html).toContain('<table');
    expect(html).toContain('castable on curve');
    expect(html).toContain('cheapest requirement is held to');
    expect(html).not.toContain('No card here asks for colored mana');
  });
});
