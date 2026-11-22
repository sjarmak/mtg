/**
 * What the deck being built holds, counted once and said in words.
 *
 * `mtg-dcxg.7`, 2026-08-23. The builder's toolbar drew five monospace facts —
 * `cards 24/60  spells 0/36  creatures 0  lands 24` — over a deck pane whose own
 * header said `Your deck · 0 cards · 0 creatures · 0 spells`. Both numbers were
 * right and they were counting different populations: the strip counted the
 * assembled deck, basics included, and the header counted the spells somebody
 * had picked. A reader gets no way to tell that from the screen, so two lines
 * eighteen hundred pixels apart contradicted each other on the one number this
 * screen is about.
 *
 * This is the same defect commit `2736c335` fixed on the precon tile a day
 * earlier, and the fix is the one that commit chose: subtract, name the nouns so
 * they do not overlap, and make the parts sum to the total a reader can check.
 * `creatures + spells + lands === cards` is an identity here rather than a
 * coincidence — `lands` is what the mana base counted out, `creatures` and
 * `spells` partition the picked cards, and `@mtg/deckbuild` assembles the deck
 * out of exactly those two piles.
 *
 * One function, read by the toolbar and by the deck pane's header, because two
 * derivations of "how many cards" is what produced the contradiction.
 *
 * `mtg-aqxi.21`, 2026-09-04. The Sealed builder was the same surface this fix
 * never reached: it printed seven monospace counters, including the two strings
 * this file was written to delete (`spells 0/23` and `colors none`), over a deck
 * pane whose own note counted creatures and noncreature spells a second time. So
 * the sealed screen carried the identical contradiction on the identical
 * furniture, and patching its phrasing would have left two derivations standing.
 * It reads these three functions now, which is why `builderCounts` takes the
 * picked cards rather than a `ConstructedBuild`: the two builders pick
 * differently -- one counts copies out of a set, the other holds indexes into a
 * fixed pool -- and neither difference reaches the count.
 */
import { plural } from '../../copy';
import type { ManualDeck } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { colorWord } from '../../card/symbols';

export interface BuilderCounts {
  /** Every card in the assembled deck, basics included. */
  readonly cards: number;
  /** What the format asks for: 60 in Constructed. */
  readonly size: number;
  readonly creatures: number;
  /** Picked cards that are not creatures. Named in full so it cannot double-count. */
  readonly spells: number;
  readonly lands: number;
}

export function builderCounts(picked: readonly Card[], deck: ManualDeck): BuilderCounts {
  const creatures = picked.filter((card) => card.kind === 'creature').length;
  return {
    cards: deck.deck.length,
    size: deck.config.deckSize,
    creatures,
    spells: picked.length - creatures,
    lands: deck.lands.length,
  };
}

/**
 * The deck in one sentence, in the order somebody checks it: how far along, then
 * what the cards are.
 *
 * The three parts are always printed, including at zero, which is the opposite
 * of `./type-counts.ts`'s rule for a finished artifact and deliberately so. That
 * pane reports a deck somebody already built; this one is watched while it fills
 * up, and a bucket that vanishes at zero takes the reader's running total with
 * it.
 */
export function builderCountsLine(counts: BuilderCounts): string {
  return [
    `${String(counts.cards)} of ${String(counts.size)} cards`,
    plural(counts.creatures, 'creature'),
    plural(counts.spells, 'noncreature spell'),
    plural(counts.lands, 'land'),
  ].join(' · ');
}

/**
 * The deck's colors as words rather than as letters.
 *
 * `colors none` was the toolbar's own phrasing and it reads as a field that
 * failed to fill. A deck with no cards in it has no colors yet, which is a
 * sentence about a deck; the words come from `../../card/symbols.ts` so the
 * only spelling of "white" on this surface is the one the rules text uses.
 */
export function deckColorsNote(colors: readonly string[]): string {
  const words = colors.map((color) => colorWord(color) ?? color);
  if (words.length === 0) return 'No colors yet';
  if (words.length === 1) return `Colors: ${String(words[0])}`;
  const last = words[words.length - 1] ?? '';
  return `Colors: ${words.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * How big the pool is, for the one builder that is cut from one.
 *
 * The single sealed-specific fact on that screen (`mtg-aqxi.21`). It sits at the
 * head of the pool pane rather than on the deck's bar, and that is a
 * measurement rather than a preference: on the bar it took the sealed row past
 * one toolbar row at 1440x900, which is the band `mtg-i195` took off this
 * screen. On the pane it is beside the count it is meant to be read against --
 * how much of the pool is *not* in the deck -- so the two numbers name their
 * different populations on one line and the deck's spells are the difference.
 * Constructed has no pool and never prints this.
 */
export function poolSizeNote(size: number): string {
  return `Pool of ${plural(size, 'card')}`;
}

/** What the cards still in the pool are, in the words the pane says them in. */
export const POOL_SIDEBOARD_CLAUSE = 'which is your sideboard';

/**
 * The pool pane's line: how big the pool is, how much of it is not in the deck,
 * and what those cards are.
 *
 * `mtg-scps`, 2026-09-04. The bead asked where a limited sideboard is read, and
 * the answer taken is MTGO's: there is no sideboard pane, because in Limited the
 * sideboard is definitionally everything in the pool you did not play. MTGO says
 * it of the same two panes -- "your card pool appears in the top of the window
 * and represents your full sideboard. The main deck will be in the lower pane"
 * (https://www.mtgo.com/getting-started/getting-started-play-limited). So the
 * work that bead leaves is naming, and this line is where the naming goes.
 *
 * Appended to the count rather than written as a sentence of its own above the
 * cards. A standing row of prose over the pool costs the pane a band on every
 * screen that draws it, which is the 78px `mtg-i195` took off this screen and
 * `mtg-aqxi.21` declined to spend again; on the population it names it costs
 * nothing on a desk and one wrapped line on a phone.
 *
 * The pane's heading is deliberately left alone. The pool is what the cards are
 * -- a sealed pool, a drafted one, a LAN room's -- and the
 * sideboard is what the ones left there are for, which is a different sentence
 * and moves as cards are picked. MTGO keeps calling it the card pool too.
 */
export function poolPaneNote(size: number, outside: number): string {
  return `${poolSizeNote(size)} · ${String(outside)} not in the deck, ${POOL_SIDEBOARD_CLAUSE}`;
}
