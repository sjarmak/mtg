/**
 * What a deck's two panes are called, and what each says when it holds nothing.
 *
 * `mtg-c52t`. Four strings, read by the artifact screen, the written-deck
 * screen and half the rigs in `../../../test/deck/`. They sit apart from all three
 * because they are the vocabulary those screens share: a written deck's pane and
 * a built artifact's pane are both `Main deck` on purpose, and a constant one of
 * them imports from the other would make that agreement look accidental.
 */
/**
 * The two panes, named as the capture names them and cased as this page cases a
 * heading — `Mana base` sits in the same column of headings, and the sheet
 * uppercases all of them anyway.
 */
export const MAIN_DECK_LABEL = 'Main deck';
export const SIDEBOARD_LABEL = 'Sideboard';

/**
 * What a pane holding nothing says, in its own words rather than as a zero.
 *
 * `../../board/ZoneBrowser.ts`'s register: lowercase, terse, a fact about this zone
 * rather than an apology. An empty sideboard is an ordinary deck — a limited
 * deck built out of a small pool leaves nothing over — so the sentence states it
 * and does not suggest a command or blame a build.
 */
export const SIDEBOARD_EMPTY_TEXT = 'nothing set aside';
export const MAIN_DECK_EMPTY_TEXT = 'no cards';
