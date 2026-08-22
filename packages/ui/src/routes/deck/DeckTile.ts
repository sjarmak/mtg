/**
 * One card in a built deck: its art, what it costs, and why it is here.
 *
 * Not `card/Card.ts`. That component draws a DSL card, and a real Scryfall card
 * has no DSL form — its rules text is free text the kernel cannot run, which is
 * the invariant the whole project is built on. Fabricating a DSL card from
 * oracle text to reuse the frame would break exactly the line that keeps the
 * generator's output space equal to the engine's. So this is a tile, not a
 * face: the parts a real card and a generated one genuinely share, which are
 * the art window, the name, the cost and the count.
 *
 * The reason and the cited criterion ids are on the tile rather than behind a
 * click because they are the deck's argument. A list that shows the cards but
 * hides why each one is in it is just a decklist.
 *
 * `omit` carries the criteria every card in the deck cites. Those are true of
 * the tile but say nothing about it: forty tiles each reading "format colors
 * budget archetype" is forty copies of one sentence. `DeckRoute` states the
 * shared set once and passes it here, so what survives on a tile is only what
 * distinguishes it.
 *
 * `mode` is the pane's density and it subtracts regions rather than restyling
 * them. A compact tile draws the head and the type line and nothing else — same
 * markup, same classes, fewer children — so there is one tile in this file and
 * not two, and the sheet is never asked to hide something the tree still holds.
 * `./view-mode.ts` argues which regions go and why the picture takes its credit
 * with it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { ArtSlot } from '../../card/ArtSlot';
import { colorsToIdentity } from '../../card/identity';
import { symbolizeLine } from '../../card/SymbolText';
import type { DeckArtifactEntry } from '../../lab/deck-artifact';
import { DEFAULT_DECK_VIEW_MODE } from './view-mode';
import type { DeckViewMode } from './view-mode';

export interface DeckTileProps {
  readonly entry: DeckArtifactEntry;
  /** Criteria stated once for the whole deck, so they are dropped from the tile. */
  readonly omit?: readonly string[];
  /** The pane's density. Absent reads as full, which is what every caller drew before. */
  readonly mode?: DeckViewMode;
}

function isColor(value: string): value is Color {
  return (COLORS as readonly string[]).includes(value);
}

/** `'RW'` → the frame identity. Anything unrecognized reads as colorless. */
export function identityOf(colorIdentity: string): ReturnType<typeof colorsToIdentity> {
  return colorsToIdentity([...colorIdentity].filter(isColor));
}

function priceLabel(priceUsd: number | null): string {
  return priceUsd === null ? 'unpriced' : `$${priceUsd.toFixed(2)}`;
}

/**
 * The cost, or nothing at all.
 *
 * A land has no mana cost, and the artifact spells that fact two ways: `null`
 * for a basic, and `''` for a nonbasic printing whose cost field is present and
 * empty. Every nonbasic land in the committed deck takes the second form, so
 * treating only `null` as absent left an empty `<span class="…__cost">` in the
 * head of those tiles. It is invisible today only because the class carries no
 * background of its own, which is not a property of the markup.
 *
 * Two spellings, not three: the check was `manaCost.trim() === ''` and no
 * producer emits a whitespace-only cost. `deck-artifact.ts` reads the field as
 * written and normalizes nothing into existence, so the trim guarded a case
 * nobody has seen and no test could reach.
 */
function costOf(manaCost: string | null): string | null {
  return manaCost === null || manaCost === '' ? null : manaCost;
}

export function DeckTile(props: DeckTileProps): ReactElement {
  const { entry } = props;
  const omit = props.omit ?? [];
  const mode = props.mode ?? DEFAULT_DECK_VIEW_MODE;
  const full = mode === 'full';
  const cites = entry.criteria.filter((id) => !omit.includes(id));
  const cost = costOf(entry.manaCost);
  const credit =
    entry.art === null
      ? null
      : createElement(
          'span',
          { key: 'credit' },
          entry.art.artist === null ? entry.art.setCode : `${entry.art.artist} · ${entry.art.setCode}`,
        );

  return createElement(
    'article',
    {
      className: 'mtg-deck-card',
      'data-identity': identityOf(entry.colorIdentity),
      'data-view': mode,
      'data-mana-value': entry.manaValue,
    },
    full ? createElement(ArtSlot, { art: entry.art, subject: entry.name }) : null,
    createElement(
      'span',
      { className: 'mtg-deck-card__head' },
      createElement('span', { className: 'mtg-deck-card__count' }, `${String(entry.count)}×`),
      // The compact strip clips the name to one row (`../../styles/deck.ts`), so
      // the whole name goes in the attribute a browser shows on hover. The text
      // node is untouched either way, so nothing that reads the tree loses it.
      createElement(
        'span',
        { className: 'mtg-deck-card__name', ...(full ? {} : { title: entry.name }) },
        entry.name,
      ),
      // A real printing's cost is a string of brace tokens, so the tile paints
      // it with the registry the card face uses. A token no set states — hybrid
      // and Phyrexian mana, which the DSL cannot express and this store is full
      // of — stays printed as written, which is `oracleChunks`' own rule and
      // exactly right here: `{W/U}` reads as `{W/U}` rather than as a blank.
      cost === null
        ? null
        : createElement('span', { className: 'mtg-deck-card__cost' }, ...symbolizeLine(cost)),
    ),
    createElement('span', { className: 'mtg-deck-card__type' }, entry.typeLine),
    full ? createElement('p', { className: 'mtg-deck-card__reason' }, entry.reason) : null,
    full
      ? createElement(
          'span',
          { className: 'mtg-deck-card__foot' },
          ...cites.map((id) => createElement('span', { key: id, className: 'mtg-deck-card__cite' }, id)),
          credit,
          createElement(
            'span',
            { key: 'price', className: 'mtg-deck-card__price' },
            priceLabel(entry.priceUsd),
          ),
        )
      : null,
  );
}
