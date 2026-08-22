/**
 * An Equipment and the creature holding it, and the values a layer moved.
 *
 * **The tray.** Two cards with a keyline round them, no gap between them where
 * every other neighbor on the row has one, and the weapon drawn at
 * `TUCKED_HEIGHT` sitting on the tray's floor. That reads as one object with
 * something held in it, which is the whole ask: an `EQUIP` badge related the two
 * cards by a word, and a word is not where a player's eye is while they are
 * looking at the table.
 *
 * A true tuck — the weapon *behind* the creature and overlapping it — is the
 * better picture and is not what this is. Every way of expressing the overlap
 * (a negative inline margin, an offset on an absolutely positioned child)
 * resolves its percentage against the *zone's* inline size rather than the
 * card's, and the zone's width is the one length on this route that moves with
 * the permanent count, so the overlap would have been a different fraction of
 * the card at every board state. A tray is exact at every one of them.
 *
 * **The derived value.** The face's own P/T takes a dotted underline, so the
 * number a player counts combat with is marked as one that came from somewhere.
 * Selected through `:has()` on the marks the slot already carries rather than
 * through a flag on the slot, because the flag would have to be threaded through
 * `../../board/CardSlot.ts` and into `../../card/Card.ts`, and the printed face
 * (ADR-0002) has no opinion about a permanent at all. The rule reaches the hover
 * zoom too — `~ *` is the slot's later children, and the zoom is one of them —
 * which is where a player checks a creature before combat and the last place the
 * two channels may disagree.
 *
 * The underline is now the *whole* of that marking, and the strikethrough that
 * used to sit beside it is gone. The badge drew the printed pair with a line
 * through it, on the argument that the corner and the foot together read "was
 * 1/3, is 3/3" without either having to say both. Read in a browser rather than
 * argued, the corner won and the foot lost: `mtg-3rm` measured a 3/3 whose
 * badge said a struck-through "1/1" at 11px, where the line merges into the
 * glyphs and the loudest number on the card is both wrong and illegible as
 * wrong. The badge carries the live pair now (`../../board/Battlefield.ts`).
 *
 * Emitted after `./fit.ts`, and the order is load-bearing: `${PLAY} .mtg-slot`
 * and `.mtg-attach__held > .mtg-slot` weigh the same, so the tucked card keeps
 * its height only because this block is last. `./index.ts` owns that order and
 * says so.
 */
import { cssNumber } from '../number';
import { RATIO } from './geometry';

/**
 * How tall an attached permanent is drawn against the one it is attached to.
 *
 * Small enough to read as held rather than as a second permanent, large enough
 * that the weapon's own name is still the same text every other face draws at
 * this width — the face is width-driven and its bars are `cqw` fractions of it
 * (`../card.ts`), so a card at 70% is the same card, not a squashed one.
 *
 * The slot is re-given an `aspect-ratio` and a zero `min-height` with it,
 * because on the play route `./fit.ts` hands every slot the row's full height
 * and a 5rem floor, and a floor is exactly the rule that would stop this one
 * shrinking.
 */
const TUCKED_HEIGHT = 0.7;

export const ATTACH_CSS = `
.mtg-mark__glyph { display: block; width: 0.85em; height: 0.85em; fill: currentColor; }
/* Asked of the slot rather than followed from the marks row, and mtg-9edk is
   why: the row used to precede the face, so a sibling combinator reached it and
   the zoom panel beside it. The row is drawn after the face now (the badges are
   anchored to the picture, and an anchor has to come first), so a following-
   sibling reach finds nothing. Scoping to the slot keeps what it matched —
   the face's own foot and the zoom's, which is right, because a derived size is
   derived on both. */
.mtg-slot:has(.mtg-slot__marks .mtg-mark[data-mark='derived']) .mtg-card__pt {
  text-decoration: underline dotted; text-underline-offset: 2px;
}
.mtg-attach {
  display: flex; flex: 0 1 auto; min-width: 0; align-items: stretch;
  padding: 2px; border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-inset);
}
.mtg-attach__held { display: flex; flex: 0 1 auto; min-width: 0; align-items: flex-end; gap: 2px; }
.mtg-attach__held > .mtg-slot[data-slot] {
  width: auto; height: ${cssNumber(TUCKED_HEIGHT * 100)}%; min-height: 0;
  aspect-ratio: ${RATIO};
}
/* And square while it is turned, for the reason ../board/slot.ts gives: a tucked
   weapon that taps needs the room its rotation takes, and the tray it sits in is
   the one place on the row with a neighbor hard against it. The two rules above
   and this one carry an extra attribute apiece so a tapped tucked slot beats the
   stated width in ../board/slot.ts rather than tying with it. */
.mtg-attach__held > .mtg-slot[data-tapped='true'] { aspect-ratio: 1; }
.mtg-attach__link {
  flex: none; align-self: center;
  width: var(--mtg-space-2); height: 2px; border-radius: var(--mtg-radius-pill);
  background: var(--mtg-ink-muted);
}
`;
