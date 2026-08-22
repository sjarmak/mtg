/**
 * The two bands: which half of the table is yours, and which half is awake.
 *
 * Two beads want the same pixels for different reasons and this file is where
 * they compose. `mtg-rgc.3` is Magic Online's answer, which is about
 * **ownership**: the seat away from you is permanently a lighter band, the seat
 * nearest you a darker one, and a hard bar separates them, so you never have to
 * read a label to know which half you are looking at and it costs nothing at
 * play time. `mtg-1nc` is the playtester's own ask, which is about **activity**:
 * "whoever's turn it is, there should be a clearer indicator like their side of
 * the board being a little more lit". Ours had neither, and answered both with
 * an `Active` chip and a `Priority` chip in a header strip — which is exactly
 * the small badge that reads as a label the bead objects to, and which the seat
 * pods lane is removing anyway.
 *
 * **Ownership is the ground and activity is a lift on it.** They are on the same
 * channel, so the only thing that keeps both readable is the size of the two
 * steps. At rest the two bands are 1.75:1 apart; the *worst* case, a resting far
 * band against a lit near one, is still 1.59:1; and the activity step is 1.08:1
 * on the far side and 1.10:1 on the near. So a lit near band never climbs to a
 * resting far band and the far/near reading survives every turn. Collapse that
 * margin and one of the two wins silently — a board where you cannot tell whose
 * turn it is, or one where you cannot tell which half is yours, and both are
 * failures. `../tokens.ts` carries the four values and `test/play/band.test.ts`
 * holds the ordering, the margin between the two steps, and every ratio quoted
 * here. Measured in chrome-headless-shell 151 at 1440x900 over the flagship
 * set, the two halves came out 1.60:1 apart on your turn and 1.89:1 apart on
 * the opponent's, and the near half was the darker one on both.
 *
 * **Activity carries three channels and not one.** `mtg-1nc` says outright not
 * to ship a version whose only channel is brightness — a viewer who cannot
 * separate two luminances gets nothing from it, and a screen at reduced
 * brightness in a lit room throws it away first. So the active band is lifted
 * (luminance), ringed in `--mtg-ready` (hue), and haloed in `--mtg-ready-soft`
 * spilling onto the mat around it (spatial). Losing any one still leaves a
 * difference you can point at. Those are the three declarations `./slot.ts`
 * already spends on a card you can play, and its docblock names this as the
 * thing they should scale up to: "the same three declarations should be what
 * the turn indicator scales up to a whole seat". This is that.
 *
 * **The lit half is lifted rather than the dark half dimmed**, which is the
 * other thing `mtg-1nc` asks for by name. Dimming the inactive side would push
 * `--mtg-ink-faint` and `--mtg-pending`, both already under AA, further down on
 * whichever side is not moving; lifting the active one moves the surface that
 * is already the brightest thing in play.
 *
 * **Every ground is named outright rather than routed through one re-valued
 * token.** Re-valuing `--mtg-mat-well` per seat would have been four fewer
 * rules and it is the version that was written first: it is wrong, because
 * `test/theme.test.ts` measures that a route resolves every palette name to its
 * paper value at every depth, and a name that means one thing on the shell and
 * another inside a seat is the drift that check exists to catch. A band is a
 * new surface, so it gets new names, and every rule below spends one of them at
 * its own value.
 *
 * **The wells inherit the band rather than restating it.** One declaration
 * rather than four, and it cannot drift from the ground it sits on: whatever
 * the seat resolved to is what the battlefield in it paints. The rail-toned
 * zone opts out for the reason `./zone.ts` already gives — a hand and a stack
 * are things you hold, not places on the table — and Magic Online agrees by
 * drawing the hand below the step bar, outside both bands entirely. The near
 * band's ground still runs behind it, so the half still reads as one half.
 *
 * **A band brings its own keyline and its own ink.** `--mtg-mat-edge` and
 * `--mtg-ink-faint` were chosen against the well, and the well is the one
 * ground neither band has: on paper the near band would put faint ink at 1.49:1
 * against the 2.09:1 it had, and in the dark palette the far band is the one
 * that moves toward the ink. Valuing both per band is what makes the label on a
 * banded zone clear AA on all four grounds — 4.65:1 at worst — instead of on
 * none of them, which `mtg-1nc` asks for by name: a signal must not push an
 * already-thin token further down.
 *
 * The seam is last because it is the one piece of this that is not a tone. A
 * player who cannot separate the two bands by lightness still has a hard
 * oxblood bar at 6.6:1 against the mat and 4.19:1 against the darkest band,
 * eight pixels tall and the full width of the lanes, telling them where one
 * half ends. It costs 7px of the column, and the whole of what that bought was
 * measured: a battlefield face at four permanents a side went 158.1px to
 * 155.7px at 1440x900, and at eight and twelve a side it did not move at all,
 * because those rows are already fitted to a floor rather than to the leftover.
 * `./slot.ts`'s aspect-ratio and min-height pair still holds — one height per
 * row, spread 0, at every count measured.
 *
 * **And the seam is now a place rather than only a boundary.** The playtester,
 * 2026-08-14: "that brownish orangeish bar area is supposed to be for" the
 * creatures in combat. So the bar grows into a band when it holds attackers and
 * collapses back to its eight pixels when it does not, which is the whole of the
 * cost — a board outside combat is the board that was measured above, declaration
 * for declaration. `../../board/CombatZone.ts` decides what goes in it and argues
 * the arrangement, including why no reference client does this.
 *
 * **The band's height is a share of the lanes column rather than a count of
 * pixels**, because three other lanes are moving the card sizes underneath this
 * one and a pixel written down today is a wrong number by the time it merges.
 * The share is only spent on the play route, where `./fit.ts` gives the column a
 * definite height; on a page read down (the replay frame, the turn summary) the
 * percentage is indefinite, resolves to `auto`, and the band is as tall as the
 * cards in it. Both are right, and neither needed a second rule.
 */
import { ARRIVAL_MS, ARRIVAL_RISE_REM } from './arrival';
import { cssNumber } from '../number';
import { PLAY } from './geometry';
import { ART_ANCHOR, TAPPED_FACE_INSET } from './slot';

/**
 * How much of the lanes column a combat band **that is holding a card** takes.
 *
 * **It is spent on cards now rather than on the step, and that is `mtg-ihss`.**
 * The sentence this constant shipped with — "it is spent only while the band is
 * open. A seat that never attacks pays nothing at any point in the game" — was
 * false about the state a player is in for the whole of every combat. The band
 * opens when it has *anything* to hold, and `../../board/CombatZone.ts` counts
 * the confirm control: at the declare-attackers step, before a single creature
 * has been clicked, the band was a quarter of the column holding two buttons.
 *
 * What that cost was measured over `../../tools/board-budget.ts` against the
 * flagship set at the median board the simulator reaches (four permanents and
 * five lands a side, 1,826 measured attacks). At 1280x800 the same position at
 * rest and at the declare-attackers step, side panel open:
 *
 *   band     your row   their row   your face      rules box
 *   8px         155.5       155.5   82.6 x 115.4   on all four
 *   157.7        66.8        94.5   40.4 x 56.4    on none
 *
 * So going to combat halved the row you are trying to click a creature out of,
 * took the rules text off every card on the table, and left **your** cards
 * smaller than your opponent's — which is the one thing about this table that is
 * not allowed to happen. the playtester, 2026-08-14, mid-game: "I've just gone to
 * combat and my hand is huge and the actual card I want to attack with is super
 * small and hidden behind a scrolling view that is a really narrow view of the
 * board". The narrow view is that 66.8px row and the band is where its height
 * went.
 *
 * The rule below therefore gates the share on `:has(.mtg-combat__entry)`. An
 * empty band is as tall as the controls it holds and no taller, which is the
 * state the whole declaration step is spent in, and the share is paid for by
 * cards that are actually in it.
 *
 * **And 18 rather than 26, because a quarter drew the wrong card largest.** At
 * 26% a declared attacker measured 105 x 146.7 at 1280x800 — wider than a card
 * in your hand (103.3) and 2.6 times a card in the row it came from. The whole
 * argument of `./hand.ts` is that the hand is the largest thing on the table
 * because it is the thing you are deciding from; an attacker you have already
 * declared is not that. At 18% it comes out about the size of a resting board
 * face and under a hand card, which reads as *the same card, moved*.
 *
 * Bounded below by the same reasoning as before: under about a fifth of the
 * column the band cannot hold a card legible beside the one it came from, and
 * 18% clears that at every viewport measured because it is a share of the column
 * rather than of what is left after the hand.
 */
const COMBAT_BAND_SHARE = 18;

/**
 * How fast the near lane grows against the far one **while the band is holding a
 * card**, which is where the band's height is taken from.
 *
 * The two lanes divide what is left of the column after the band, and until now
 * they divided it evenly: `./fit.ts` gives both `flex: 1 1 auto` and records why
 * the near lane's old double share was removed — both halves hold one row of
 * cards, so an equal share of the *free* space lands both rows on the same
 * height, and measured at rest they do, to the tenth of a pixel at three of the
 * four viewports.
 *
 * That is the right answer at rest and the wrong one in combat, because the free
 * space is what shrinks and the near lane's fixed rows do not. Measured at
 * 1280x800 over `../../tools/board-budget.ts` with one attacker declared and an
 * even share: your row came out 93.5 against their 108.2, and your board face
 * 58.8 wide against their 68.8. **The seat you are attacking from had the
 * smaller cards**, which is the same inversion `./hand.ts`'s `mtg-d6s` spent a
 * bead removing, arriving down a different road.
 *
 * Two rather than a weight fitted to a viewport. The free space over the two
 * lanes' content bases is split in proportion to these factors, so two gives the
 * near row two-thirds of it: enough at 1280x800 to keep the face over
 * `../card.ts`'s `BOARD_RULES_MIN_REM` with an attacker on the seam, which an
 * even split does not, and the far row stays a row of readable cards rather than
 * a strip. `./fit.ts` already states the principle this spends — the seat you
 * act from and the seat you only read are worth different amounts of a screen —
 * and combat is the moment it is most true: your row holds the creatures you are
 * still choosing between, and theirs holds the permanents you have already read.
 *
 * Scoped to a band with a card in it, so a resting board is unchanged by every
 * measurement this file quotes.
 */
const NEAR_GROW_IN_COMBAT = 2;

/**
 * How tall a *staged* attacker is drawn against the band, and it is under 100 on
 * purpose.
 *
 * The playtester asked for the card to move "up slightly into the combat zone" on the
 * first click and to be declared only on the confirm, so the two states have to
 * be told apart at a glance. A staged card is short of the band and hanging off
 * the edge nearest its own seat — half in — and a declared one fills it. That is
 * a difference in position and size rather than in tone, which leaves the tone
 * channel free for the amber ring the rest of this table already spends on "you
 * may act on this" (`./slot.ts`).
 */
const STAGED_HEIGHT = 78;

/**
 * How thick the strip of a seat's own paper along an attacker's near edge is.
 *
 * The one thing on the mat that already means "this half" is the band's own
 * ground, so which seat an attacker came from is said in that color rather than
 * in a word: their paper along the top of their creatures, yours along the
 * bottom of yours. Three pixels is enough to read as a colored edge against the
 * seam's oxblood and small enough to take nothing off the card.
 */
const SEAT_EDGE_PX = 3;

/**
 * Entering the band, in the vocabulary `./arrival.ts` already established: the
 * same duration, the same distance, the same two free properties, and the same
 * easing shape. What differs is only the sign, because the two seats enter from
 * opposite sides of the seam — an attacker of theirs comes down into it and one
 * of yours goes up. A single keyframe would have had half the table's creatures
 * traveling away from where they came from.
 */
const ENTER_EASING = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/**
 * The one slot in an entry the seat strip runs along: the attacker's own, and
 * only while the row it is in holds cards from both halves of the table.
 *
 * An entry holding a creature that is carrying something is `.mtg-attach` rather
 * than a bare slot (`../../board/Battlefield.ts`), and the held object gets a
 * slot of its own inside it. Both spellings here name the host and neither
 * names the held, because the strip says which half the *attacker* came from
 * and a second strip under its sword says nothing.
 *
 * The row filter is `mtg-oeq0`'s second half and the playtester's own reading of the
 * fixed strip: the color says which half a card came from, and a row every card
 * came from the same half of is a row where that sentence is already true of
 * everything in it. Attacking is one seat's declaration, so that is the whole of
 * declare-attackers. What the strip was drawn for is the block: the seam
 * interleaves each attacker with the blockers staged against it, and only there
 * do two cards side by side belong to different people.
 * `../../board/CombatZone.ts` counts the seats and writes the answer.
 */
const MIXED_STRIP = ".mtg-combat__strip[data-seats='both']";

function hostSlot(seat: string, suffix: string): string {
  const entry = `${MIXED_STRIP} > .mtg-combat__entry[data-seat='${seat}']`;
  return [`${entry} > .mtg-slot${suffix}`, `${entry} > .mtg-attach > .mtg-slot${suffix}`].join(',\n');
}

/** The card, which is what moves, exactly as `./arrival.ts` scopes its own. */
function entering(seat: string, indent: string): string {
  return `${indent}.mtg-combat__entry[data-seat='${seat}'] .mtg-slot > .mtg-card`;
}

/**
 * The badges over its corner, which are carried rather than moved.
 *
 * `./arrival.ts` has the measurement and the argument: `./slot.ts` anchors this
 * row to the card's art window, an anchor rectangle is the anchor's transformed
 * box, so a row with its own copy of the keyframes takes the rise twice and
 * lands on the name. The seam had the same defect for the same reason, found
 * alongside it — one vocabulary means one bug in two places.
 */
function enteringMarks(seat: string, indent: string): string {
  return `${indent}.mtg-combat__entry[data-seat='${seat}'] .mtg-slot > .mtg-slot__marks`;
}

export const BAND_CSS = `
.mtg-board__side { border-radius: var(--mtg-radius-lg); }
.mtg-board__side[data-seat='opponent'] { background: var(--mtg-mat-band-far); }
.mtg-board__side[data-seat='opponent'][data-active='true'] { background: var(--mtg-mat-band-far-lit); }
.mtg-board__side[data-seat='you'] { background: var(--mtg-mat-band-near); }
.mtg-board__side[data-seat='you'][data-active='true'] { background: var(--mtg-mat-band-near-lit); }
.mtg-board__side > .mtg-zone:not([data-tone='rail']) { background-color: inherit; }
/*
 * On paper the near band goes under --mtg-color-w and the far band over it, so
 * a white card separates from the ground it sits on for the first time: 1.14:1
 * at worst against the 1.08:1 the well gave it, and 1.46:1 at best. What that
 * costs is the keyline and the ink, which were both chosen against the well.
 */
/* The empty battlefield slot each of these used to re-color with the zone is
   gone: a battlefield row no longer draws its spare places at all
   (../../board/Battlefield.ts). The hand rail draws its own and keeps them, and
   ./slot.ts is where they are now stated. */
.mtg-board__side[data-seat='opponent'] > .mtg-zone:not([data-tone='rail']) {
  border-color: var(--mtg-mat-band-far-edge);
}
.mtg-board__side[data-seat='you'] > .mtg-zone:not([data-tone='rail']) {
  border-color: var(--mtg-mat-band-near-edge);
}
.mtg-board__side[data-seat='opponent'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__label,
.mtg-board__side[data-seat='opponent'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__count,
.mtg-board__side[data-seat='opponent'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__note,
.mtg-board__side[data-seat='opponent'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__empty {
  color: var(--mtg-mat-band-far-ink);
}
.mtg-board__side[data-seat='you'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__label,
.mtg-board__side[data-seat='you'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__count,
.mtg-board__side[data-seat='you'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__note,
.mtg-board__side[data-seat='you'] > .mtg-zone:not([data-tone='rail']) .mtg-zone__empty {
  color: var(--mtg-mat-band-near-ink);
}
/*
 * Outset rather than inset, and that is forced rather than chosen: the wells
 * inside a seat inherit the band's own color, and a child's background is drawn
 * over its parent's inset shadow, so an inset ring would have been covered by
 * the battlefield the moment it was drawn. Outside the border box it lands on
 * the mat, where the halo has somewhere to spill.
 */
.mtg-board__side[data-active='true'] {
  box-shadow: 0 0 0 2px var(--mtg-ready), 0 0 18px 4px var(--mtg-ready-soft);
}
/*
 * The seam. A bar, not a keyline: ./mat.ts drew it as one pixel of
 * --mtg-mat-edge, which is the line every well on the table is already drawn
 * with, so the one boundary on the mat that means something read exactly like
 * the eleven that do not.
 *
 * A height of auto rather than a stated bar height, with the bar as a *floor*.
 * ./mat.ts declares this element one pixel tall and this block wins it on sheet
 * order alone (./index.ts records that tie), so dropping the declaration here
 * would hand the seam back to the keyline it exists to replace, and stating a
 * height would clip the cards the band now holds. The floor is what keeps an
 * empty seam exactly the bar it was.
 */
.mtg-board__divider {
  height: auto;
  min-height: var(--mtg-space-2);
  margin: 0;
  background: var(--mtg-mat-seam);
  border-radius: var(--mtg-radius-sm);
}
/* Open: a row of the creatures in combat, centered, scrolling sideways rather
   than growing when there are more of them than fit. Sideways is the only axis
   it may spend, for the reason ./fit.ts spends four paragraphs on — a block on
   this column that grew with the game state shrank every card on the table. */
.mtg-board__divider[data-combat='true'] {
  display: flex; align-items: stretch;
  gap: var(--mtg-space-2);
  padding: var(--mtg-space-1) var(--mtg-space-2);
  overflow: hidden;
}
/* The scroller is the strip, not the band, so the confirm keeps its place while
   the attackers slide under it. */
.mtg-combat__strip {
  display: flex; flex: 1 1 auto; min-width: 0;
  align-items: stretch; justify-content: safe center;
  gap: var(--mtg-space-2);
  overflow-x: auto; overflow-y: hidden;
}
/* The share is spent on a band that is holding a card, and on no other band.
   COMBAT_BAND_SHARE has the measurement; the selector is the whole of the fix.

   :has() rather than a second attribute from ../../board/CombatZone.ts, because
   what the sheet needs to know is already in the DOM — the band either contains
   an entry or it does not — and a component writing an attribute that restates
   its own children is a second place for the two to disagree. ./attach.ts
   already selects on :has() for the same reason on this route.

   An empty band keeps the automatic height the block above gives it, so it is
   as tall as the controls it holds, and its min-height keeps it exactly the bar
   when it holds nothing at all. */
${PLAY} .mtg-board__divider[data-combat='true']:has(.mtg-combat__entry) {
  height: ${cssNumber(COMBAT_BAND_SHARE)}%;
}
/* And what it takes, it takes from the half you are only reading.
   NEAR_GROW_IN_COMBAT has the arithmetic and the measurement. */
${PLAY} .mtg-board__lanes:has(.mtg-combat__entry) .mtg-board__side[data-seat='you'] {
  flex-grow: ${cssNumber(NEAR_GROW_IN_COMBAT)};
}
${PLAY} .mtg-board__lanes:has(.mtg-combat__entry) .mtg-board__side[data-seat='opponent'] {
  flex-shrink: ${cssNumber(NEAR_GROW_IN_COMBAT)};
}
/* An entry never shrinks, and that is mtg-bm1 again rather than a preference.
   A card in the band is sized off the band's height and keeps the printed
   aspect, so its width is decided before the row is laid out; a shrinking entry
   takes width the face does not give back and the face paints over its neighbor.
   Measured: with flex 0 1 auto, six attackers overlapped in three pairs at
   1024x768 and in seven at 810x1080 (chrome-headless-shell 151, the DSL example
   set). With flex none the same boards overlap in none, because the excess goes
   to the scroller this band already declared instead of onto the next card.
   Centering is safe center, because a centered overflowing flex row puts its
   first item off the scroller's start edge where nothing can scroll back to it. */
.mtg-combat__entry {
  display: flex; flex: none; align-items: stretch;
  border-radius: var(--mtg-radius-md);
}
/* Which half it came from, in that half's own paper.
   The room the strip needs, reserved on the entry, and the strip itself drawn
   on the slot - which is mtg-oeq0 and not a preference. Both used to be the
   one border on the entry, and that is right exactly while the entry's edge and
   the card's edge are the same line. Attacking taps, ./slot.ts squares a
   tapped slot so the quarter turn has somewhere to land, and the card then
   paints 63/88 of that square centered in it - so on nearly every attacker in
   the band the entry's edge was 20px clear of the card and the strip read as a
   pale bar loose under it. the playtester, 2026-08-18, on what that is: "some of the
   attacking card boundary box showing through rather than the actual card
   border". TAPPED_FACE_INSET is that 20px,
   and is zero wherever the turn did not move the card's edge.

   Padding rather than the border it replaces because the strip now paints
   outside the slot, and the entry has to keep holding those three pixels: the
   strip scrolls under overflow-y: hidden and an entry that gave the room back
   would have the strip clipped instead of drawn. Same box either way - the
   entry stays as tall as the slot plus the strip, so nothing else on this band
   moves.

   The padding is deliberately outside the mixed-row gate hostSlot applies to
   the strip itself. The room is reserved whether or not anything is painted in
   it, so the first staged blocker turns the strips on and moves nothing: gating
   the padding too would resize every entry in the row at the moment the block
   is being assembled, which is the one moment on this band where a player is
   reading positions and pairing cards by eye. Three transparent pixels cost
   nothing; three pixels of reflow under a decision cost the decision. */
.mtg-combat__entry[data-seat='opponent'] { padding-block-start: ${cssNumber(SEAT_EDGE_PX)}px; }
.mtg-combat__entry[data-seat='you'] { padding-block-end: ${cssNumber(SEAT_EDGE_PX)}px; }
${hostSlot('opponent', '::before')},
${hostSlot('you', '::before')} {
  content: ''; position: absolute; inset-inline: 0;
  block-size: ${cssNumber(SEAT_EDGE_PX)}px;
  pointer-events: none;
  /* Unprefixed, because it is one element's working length and not a design
     token: ../../test/tokens.test.ts reads every --mtg- name a var() names as a
     promise that ../tokens.ts declares it, and this one is declared right here
     and read one line down. Same reason ./slot.ts spells the card's own width
     --card-w. Declared on the pseudo rather than the slot so the container
     units below resolve against the slot, which is the container. */
  --seat-edge-inset: 0px;
}
${hostSlot('opponent', "[data-tapped='true']::before")},
${hostSlot('you', "[data-tapped='true']::before")} {
  --seat-edge-inset: ${TAPPED_FACE_INSET};
}
${hostSlot('opponent', '::before')} {
  inset-block-start: calc(var(--seat-edge-inset) - ${cssNumber(SEAT_EDGE_PX)}px);
  background: var(--mtg-mat-band-far);
}
${hostSlot('you', '::before')} {
  inset-block-end: calc(var(--seat-edge-inset) - ${cssNumber(SEAT_EDGE_PX)}px);
  background: var(--mtg-mat-band-near);
}
/* Staged: short of the band, hanging off its own seat's edge, and ringed in the
   amber this table already spends on a thing you may act on. Three channels
   again (position, size, hue), because a proposal a player cannot tell from a
   declaration is worse than no staging at all. */
.mtg-combat__entry[data-state='staged'] {
  height: ${cssNumber(STAGED_HEIGHT)}%;
  outline: 2px solid var(--mtg-ready); outline-offset: 1px;
  box-shadow: 0 0 12px 2px var(--mtg-ready-soft);
}
.mtg-combat__entry[data-seat='opponent'][data-state='staged'] { align-self: flex-start; }
.mtg-combat__entry[data-seat='you'][data-state='staged'] { align-self: flex-end; }
.mtg-combat__controls {
  display: flex; flex: none; align-self: center; align-items: center;
  gap: var(--mtg-space-1);
}
/* The band's own button rather than the ask column's choice button, because
   this one sits on the seam's oxblood and that one sits on the mat: a class shared
   across two grounds is a class one of the two grounds is wrong for. It is also
   the only control on this route drawn inside a colored bar, so it carries its
   own paper. */
.mtg-combat__button {
  flex: none;
  padding: var(--mtg-space-1) var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-pill);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  font-size: var(--mtg-text-sm); font-weight: 600; line-height: 1.4;
  cursor: pointer;
}
.mtg-combat__button[data-kind='confirm'] {
  border-color: var(--mtg-ready);
  box-shadow: 0 0 0 1px var(--mtg-ready), 0 0 10px 2px var(--mtg-ready-soft);
}
.mtg-combat__button:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
/* WCAG 2.5.8 asks 24px of any target and ../touch.ts asks 44 of a coarse one.
   Two new buttons on a surface a tablet plays is exactly where that is checked
   (mtg-biz), so it is stated here rather than inherited from a rule written for
   a rail entry. */
@media (pointer: coarse) {
  .mtg-combat__button { min-height: 44px; min-width: 44px; }
}
@keyframes mtg-combat-enter-far {
  from { opacity: 0; translate: 0 -${cssNumber(ARRIVAL_RISE_REM)}rem; }
  to { opacity: 1; translate: 0 0; }
}
@keyframes mtg-combat-enter-near {
  from { opacity: 0; translate: 0 ${cssNumber(ARRIVAL_RISE_REM)}rem; }
  to { opacity: 1; translate: 0 0; }
}
/* The travel taken out, for the badges the card is already carrying. One
   keyframe for both seats: a fade has no direction to disagree about. */
@keyframes mtg-combat-enter-in-place {
  from { opacity: 0; }
  to { opacity: 1; }
}
${entering('opponent', '')} {
  animation: mtg-combat-enter-far ${cssNumber(ARRIVAL_MS)}ms ${ENTER_EASING};
}
${entering('you', '')} {
  animation: mtg-combat-enter-near ${cssNumber(ARRIVAL_MS)}ms ${ENTER_EASING};
}
${enteringMarks('opponent', '')},
${enteringMarks('you', '')} {
  animation: mtg-combat-enter-in-place ${cssNumber(ARRIVAL_MS)}ms ${ENTER_EASING};
}
@supports not (anchor-scope: ${ART_ANCHOR}) {
${enteringMarks('opponent', '  ')} {
    animation: mtg-combat-enter-far ${cssNumber(ARRIVAL_MS)}ms ${ENTER_EASING};
  }
${enteringMarks('you', '  ')} {
    animation: mtg-combat-enter-near ${cssNumber(ARRIVAL_MS)}ms ${ENTER_EASING};
  }
}
/* The card and its badges rather than the entry, which is ./arrival.ts's own
   finding one surface over: a translate makes an element a containing block for
   fixed-position descendants, and the hover zoom is fixed precisely so the
   scrolling well cannot clip it. On the card the property is free. */
@media (prefers-reduced-motion: reduce) {
${entering('opponent', '  ')},
${entering('you', '  ')},
${enteringMarks('opponent', '  ')},
${enteringMarks('you', '  ')} {
    animation: none;
  }
}
`;
