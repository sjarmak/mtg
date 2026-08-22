/**
 * The zone browser: a strip you click and a panel that scrolls (`mtg-bc2.138`).
 *
 * Its own sheet rather than part of `./zone.ts`, because a browser is a zone plus
 * a control and the control is where all of the rules are. Emitted straight
 * after the zone, where it reads beside the rules it extends, and before
 * `./fit.ts` and `./rail.ts`, so the play route's sizing and the rail's floor and
 * clip still apply to a browser exactly as they do to every other block up
 * there. `./index.ts` owns that order.
 *
 * `.mtg-browser__head` is a button that has to look like the zone head it
 * replaces, so it resets what a button brings: no chrome, `font: inherit`, and
 * the same baseline row `.mtg-zone__head` lays out. It reuses `.mtg-zone__label`
 * and `.mtg-zone__count` verbatim rather than restating them — a second
 * uppercase micro-label rule is exactly the drift `../../../test/polish.test.ts`
 * sweeps for.
 *
 * The panel is the scroller and the section clips: on the play route the rail
 * caps each block at 30% of its height and sets `overflow: hidden`, so a panel
 * that grew instead of scrolling would be silently cut off at the block edge
 * rather than reachable. `min-height: 0` is what lets it shrink inside that cap
 * at all — a flex item's default `min-height: auto` refuses to go below its
 * content and the overflow never engages. `max-height` bounds it on the replay
 * route, which has no such cap and would otherwise draw a forty-card list.
 *
 * The last two rules are the reveal, and both are load-bearing. `:hover` is the
 * pointer's and `:focus-within` is the keyboard's; a browser that declared only
 * the first would be a detail channel nobody tabbing can reach. The panel they
 * reveal is `.mtg-zoom` from `../card.ts` — the battlefield's own, fixed and
 * `pointer-events: none`, which is why a row inside a scrolling panel can show
 * one at all.
 */
export const BROWSER_CSS = `
.mtg-browser__head {
  display: flex; align-items: baseline; gap: var(--mtg-space-2);
  width: 100%; padding: 0; margin: 0;
  background: none; border: 0; border-radius: var(--mtg-radius-sm);
  font: inherit; color: inherit; text-align: left;
}
button.mtg-browser__head { cursor: pointer; }
button.mtg-browser__head:hover .mtg-zone__label { color: var(--mtg-ink); }
.mtg-browser__newest {
  margin-left: auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
}
.mtg-browser__list {
  display: flex; flex-direction: column; gap: 2px;
  flex: 1 1 auto; min-height: 0; max-height: 16rem; overflow-y: auto;
  margin: 0; padding: 0; list-style: none;
}
.mtg-browser__row { display: flex; min-width: 0; }
.mtg-browser__card {
  display: flex; align-items: baseline; gap: var(--mtg-space-2);
  width: 100%; padding: 1px var(--mtg-space-1); margin: 0;
  background: none; border: 0; border-radius: var(--mtg-radius-sm);
  font: inherit; font-size: var(--mtg-text-sm); color: inherit; text-align: left;
  cursor: pointer;
}
.mtg-browser__card:hover, .mtg-browser__card:focus-visible { background: var(--mtg-surface-raised); }
.mtg-browser__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtg-browser__row:hover > .mtg-zoom, .mtg-browser__row:focus-within > .mtg-zoom { display: block; }
`;
