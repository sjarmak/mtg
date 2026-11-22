/**
 * The whole table: two seats facing each other, the stack on the seam between
 * them, and one block in the side rail.
 *
 * `Board` owns no state at all — not selection, not the current turn, not who
 * has priority. The replay viewer drives it from a reconstructed frame and the
 * playable board will drive it from live kernel state, and neither has to fight
 * this component for control.
 *
 * A table of more than two is the same board with `pod` set (`BoardPod`): the
 * pod column holds a seat rail in place of the opponent's pod, and the opponent's
 * lane is a row of tiles, one per opponent, so every other player's battlefield
 * is on screen at once (`./PodRow.ts`). Without `pod` the markup is a duel's,
 * byte for byte.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Battlefield } from './Battlefield';
import type { BattlefieldProps } from './Battlefield';
import { AvatarZone } from './AvatarZone';
import type { AvatarZoneProps } from './AvatarZone';
import { combatTable } from './CombatZone';
import { CommandZone } from './CommandZone';
import type { CommandZoneProps } from './CommandZone';
import { LibraryTop } from './LibraryTop';
import type { LibraryTopProps } from './LibraryTop';
import { Exile } from './Exile';
import type { ExileProps } from './Exile';
import { Graveyard } from './Graveyard';
import type { GraveyardProps } from './Graveyard';
import { Hand } from './Hand';
import type { HandProps } from './Hand';
import { podRow, podTile } from './PodRow';
import { SeatPod } from './SeatPod';
import type { SeatPodProps } from './SeatPod';
import { SeatRail } from './SeatRail';
import type { SeatRailProps } from './SeatRail';
import { StackZone } from './StackZone';
import type { StackZoneProps } from './StackZone';

export interface BoardSide {
  /**
   * The seat's vitals, drawn as a pod in the column between the two boards.
   *
   * `SeatPodProps` rather than `PlayerStatusProps` since `mtg-bz2.16`: the pod
   * is a control while a spell is being aimed at this seat, and the caller is
   * the only one that knows whether it is. Every field the old type carried is
   * still on this one, so nothing that fills a side had to change.
   */
  readonly status: SeatPodProps;
  readonly battlefield: BattlefieldProps;
  readonly hand?: HandProps;
  readonly graveyard?: GraveyardProps;
  /**
   * The seat's exile, drawn under its graveyard and omitted while it is empty.
   *
   * Optional the way `graveyard` is, and for a sharper reason: most games exile
   * nothing at all, and a permanently-drawn empty strip would spend a row of the
   * pod column on a sentence saying so. A caller supplies it when that seat owns
   * an exiled card and leaves it out otherwise, so the zone appears the moment
   * there is something in it to look at.
   */
  readonly exile?: ExileProps;
  /**
   * The seat's command zone, drawn on the right-hand side of its battlefield
   * and supplied only at a Commander table (`./CommandZone.ts`). A standard
   * game draws exactly the side it drew before.
   */
  readonly commandZone?: CommandZoneProps;
  readonly avatars?: AvatarZoneProps;
  /**
   * The top of the seat's library while it is public, drawn in the same panel
   * as the command zone and supplied only while the engine reveals it
   * (`./LibraryTop.ts`). Absent on every ordinary position.
   */
  readonly libraryTop?: LibraryTopProps;
}

/** One opponent of a pod beyond the one `BoardProps.opponent` holds. */
export interface BoardPodSeat {
  /** Table position, the key the seat's row in the rail is filed under. */
  readonly seat: number;
  readonly side: BoardSide;
}

/**
 * What a table of more than two players adds to the board (`mtg-bc2.154.6.5.4`).
 *
 * Optional whole rather than a field beside each of its parts, so the two halves
 * of a pod cannot be handed over separately: a rail without the tiles it names,
 * or tiles with no rail to say who is close to losing, are both a board that
 * disagrees with itself. Absent draws exactly the duel this component always
 * drew, byte for byte, which is what the replay frame and every two-seat played
 * table rely on.
 *
 * `opponent` stays the seat the combat band lifts its creatures out of, and in a
 * pod it is one of several: the caller says which, because the caller is the
 * one that knows whose turn it is and which opponent is being fought
 * (`../routes/play/backend-position.ts`). Everything else about that seat is as it
 * was, so `opponent` still carries the aiming, the click gestures and the arrival
 * marks and a tile built from it needs none of them re-wired.
 */
export interface BoardPod {
  /** Every player, in table order, one row each (`./SeatRail.ts`). */
  readonly rail: SeatRailProps;
  /** Table position of the seat `BoardProps.opponent` is. */
  readonly opponentSeat: number;
  /** Every other opponent, in the order they are drawn once `opponent` is placed. */
  readonly others: readonly BoardPodSeat[];
  /** Where in the row of opponents `opponent` sits, so the row runs in table order. */
  readonly opponentAt: number;
}

export interface BoardProps {
  /** The seat drawn away from the viewer. */
  readonly opponent: BoardSide;
  /** The seat drawn nearest the viewer. */
  readonly you: BoardSide;
  readonly stack: StackZoneProps;
  /**
   * Drawn in the pod column, between the two seats. One node or several.
   *
   * `mtg-rgc.4`. Magic Online splits its two rails by what they are for: the
   * left column carries the current ask in plain language in the span between
   * the two player pods, and the right column is the chat and the game log and
   * nothing else. The span was already there — `mtg-rgc.1` put the pods at the
   * two ends of a column and left the middle empty — and this is what goes in
   * it.
   *
   * A prop rather than a third thing the rail happens to hold, because the two
   * columns now answer different questions and a caller has to be able to say
   * which one it is filling. A replay frame passes neither and gets the board it
   * always had.
   */
  readonly prompt?: ReactNode;
  /** Disclosure for the prompt/vitals column, preserved in both width states. */
  readonly askHead?: ReactNode;
  /** Narrows the prompt/vitals column while retaining life and priority controls. */
  readonly askCollapsed?: boolean;
  /**
   * Drawn over the board's left region, anchored to the shut ask column.
   *
   * `mtg-li0o`. The shut column is 5rem and `../styles/board/rail.ts` hides
   * `.mtg-board__pods > .mtg-panel` in it, so the column that carries the
   * enumerated moves, the blocker roster, the trigger ordering and a halted
   * game's one acknowledgment carried none of them once it was narrowed. This
   * is where they go instead, and `../routes/play/ask-flyout.ts` argues the
   * whole shape.
   *
   * **It hangs off the lanes rather than the pods**, and both halves of that are
   * load-bearing. `.mtg-board__pods` scrolls, so an absolutely positioned child
   * of it is clipped by its own column at exactly the width that made the flyout
   * necessary. A grid child of `.mtg-board` overlapping a track would take the
   * mat's auto-placement out of the three-column arrangement `../styles/board/
   * fit.ts` builds. `.mtg-board__lanes` is a plain flex column with no
   * `position` and no `overflow` of its own, so giving it a containing block
   * costs the layout nothing and gives the box the board's whole height to be
   * placed against.
   *
   * A slot for the reason `prompt` is one: what goes in it is the route's
   * decision, and a replay frame passes nothing and gets the board it had.
   */
  readonly askFlyout?: ReactNode;
  /**
   * Drawn over the seam between the two battlefields while the game is paused.
   *
   * `mtg-gt4q`. A pause that reports something happening to a permanent is drawn
   * as the movement itself, and the one acknowledgment it needs is offered
   * *during* that movement rather than in a panel that has to be read first —
   * `../routes/play/beat-motion.ts` argues the whole arrangement and
   * `../styles/board/beat.ts` the geometry.
   *
   * Handed to `combatTable` rather than dropped in the lanes, so the seam is the
   * element it is positioned against — the same argument `../styles/board/
   * stack.ts` already makes for the stack strip, and for the same payoff: the
   * band decides whether combat is open, and one parent makes the agreement
   * layout instead of arithmetic. The seam is where it belongs because it is the
   * one band of this element that is not a row of cards, so a control there does
   * not cover the permanents the pause is about.
   *
   * A slot for the reason `prompt` is one: a replay frame passes nothing and
   * gets the board it had.
   */
  readonly beat?: ReactNode;
  /**
   * Drawn in the viewer's own band, under their battlefield and over their hand.
   *
   * `mtg-rgc.6`. Magic Online draws the turn structure there and not on a strip
   * above the table — all three captures in `references/` put it hard against the
   * bottom edge of the lower battlefield with the hand directly under it — and the
   * reading is why: the bar answers "where is the game, and where will it stop",
   * which is a question about the half of the table you are about to act from. On
   * a strip over the opponent's board it was a page header; here it is the last
   * thing between the board and the cards you play from.
   *
   * Inside the near seat rather than between the two, because the hand is inside
   * the near seat: a bar drawn as a sibling of `.mtg-board__side` could sit under
   * the whole lane or over it, and neither is under the *battlefield* and over the
   * *hand*. `../styles/board/band.ts` already reasons from the same geometry when
   * it says Magic Online draws the hand below the step bar and outside both bands.
   *
   * A prop rather than something this component builds, for the reason `prompt`
   * is one: the bar needs an auto-pass setting and somebody listening to it, and
   * a caller that owns neither — a replay frame, a read-only render — passes
   * nothing here and gets the band it always had. A remote seat does own them, so
   * it gets the bar; what it does not own is the pause, and `routes/play/
   * toolbar.ts` drops the toggle at the end of the bar rather than the bar.
   */
  readonly steps?: ReactNode;
  /**
   * The divider between the battlefield and the hand, and where it was dragged.
   *
   * `mtg-7rhk`. Two slots rather than one because they answer different
   * questions and arrive at different times: the handle is drawn on every played
   * table so the control can be found, and the style exists only once somebody
   * has dragged it. `../styles/board/hand.ts` selects its whole seamed arm on
   * the `data-seam` this component writes beside the style, so a caller that
   * passes neither -- a replay frame, a read-only render -- gets markup
   * identical to the one this component rendered before the seam existed, which
   * is what `../../test/play/battlefield-geometry.browser.test.ts` measures.
   *
   * Slots for the reason `prompt` and `steps` are slots: the stored share and
   * the pointer listener belong to whoever owns the view (`../routes/play/
   * hand-seam.ts`), and this component draws the table and decides none of it.
   */
  readonly seam?: ReactNode;
  /** The near lane's inline height for the hand; see `seam`. */
  readonly seamStyle?: Readonly<Record<string, string>>;
  /**
   * Drawn in the side rail, under the disclosure. One node or several.
   *
   * **It is the whole of the rail now** (`mtg-rgc.7`). Three other blocks have
   * left it in three beads: the move list went to `prompt` in `mtg-rgc.4`, and
   * the stack and the two graveyards went to the seam and the ask column here.
   * Magic Online's right rail is the chat and the game log and nothing else, and
   * ours is the log. What that bought is a measurement rather than a tidying:
   * the log's block went 509.3 / 541.3 / 641.3px to 677.4 / 709.4 / 809.4 at
   * 1024x768 / 1280x800 / 1440x900, +168.1px at every one, which is the 52px
   * stack block, the two 52px graveyard blocks and their three 4px gaps handed
   * over intact.
   *
   * Under `mtg-bz2.4` the stack sat above this slot, because "what is about to
   * resolve" should not sit under "everything that already has". That ordering
   * has no subject left in this column; the stack answers it by being on the
   * board.
   *
   * The played table puts everything whose size the game state decides in one of
   * the two columns,
   * which is the geometry every client in
   * `docs/research/prior-art-board-layout.md` uses and the reason the cards can
   * be big: Forge's button dock, stack and log are a 20%-wide left rail and both
   * its battlefields take 73.2% of window height; Magic Online spends 22% of
   * width on two rails and about 70% of height on the boards. Neither spends any
   * *height* on an action surface, and ours used to spend up to 32% of the table
   * on one and another uncapped band on the altered-size notes. A replay frame
   * passes nothing and gets the rail it always had.
   */
  readonly rail?: ReactNode;
  /**
   * Drawn at the end of the combat band: the controls that end a declaration.
   *
   * `mtg-bz2.5`'s confirm boundary. Present means the kernel is asking this seat
   * to declare attackers, which is also what opens the band on a turn where
   * nothing has been staged yet — a player being asked for attackers has to be
   * able to see where an attacker goes before choosing one. A caller that owns
   * no session (a replay frame, a read-only render) passes nothing and gets the
   * seam it always had, exactly as `prompt`, `steps` and `rail` already work.
   *
   * The controls themselves are a caller's, because submitting is: the board
   * draws combat and decides none of it (`./CombatZone.ts`).
   */
  readonly combat?: ReactNode;
  /**
   * Drawn as the rail's first child, above the log, and drawn in both states.
   *
   * `mtg-crw`. The side panel collapses, and the control that brings it back has
   * to survive the collapse — so it cannot be one of the blocks the collapse
   * hides. A slot rather than a button this component builds, for the reason
   * `prompt` and `steps` are slots: the state it toggles belongs to whoever owns
   * the view, and a replay frame that passes nothing gets the rail it had.
   */
  readonly railHead?: ReactNode;
  /**
   * Whether the rail is drawn as a strip rather than a column.
   *
   * Written to `data-rail` on the mat rather than acted on here, because the
   * thing that changes is a grid track and the grid is this element. The rail's
   * blocks stay mounted and are hidden by the sheet, so a graveyard browser or a
   * log the player had open is still open when the panel comes back;
   * `../styles/board/rail.ts` holds the rules and says what the strip costs.
   *
   * Always written, false included, so a stylesheet can select either state and
   * a test can tell "open" from "this component never said" — the same rule
   * `data-active` on a lane already follows.
   */
  readonly railCollapsed?: boolean;
  /**
   * Whether the table is choosing a target, written to `data-aiming` on the mat.
   *
   * `mtg-bz2.6`. Written here rather than acted on, for the reason
   * `railCollapsed` above is: what changes is which cards are drawn quiet, and
   * that is a rule in `../styles/board/aim.ts` over the whole mat rather than a
   * prop each of the forty cards would have to be handed. The board still
   * decides nothing — a card is inert because its caller gave it no handler, and
   * this only says out loud why.
   *
   * Always written, false included, so a stylesheet can select either state and
   * a test can tell "not aiming" from "this component never said" — the rule
   * `data-rail` and a lane's `data-active` already follow.
   */
  readonly aiming?: boolean;
  /**
   * The rest of the table when there are more than two players, and drawn in
   * place of the opponent's pod and lane when present (`BoardPod`).
   */
  readonly pod?: BoardPod;
}

/** Which of the two seats a lane is, for a caller that treats them differently. */
export type BoardSeat = 'opponent' | 'you';

/**
 * A lane names its seat, and says whether the game is standing on it. Both
 * lanes are the same component and the same vocabulary, so nothing here reads
 * either; the played table does, because the seat you act from and the seat you
 * only read are worth different amounts of a screen (`styles/board.ts`,
 * `mtg-bc2.128`). A `key` cannot carry that — it never reaches the DOM — and
 * first-child/last-child would encode the answer in the order the divider
 * happens to sit in.
 *
 * `data-active` is the same fact `SeatPod` prints as an Active badge, at board
 * scale: `styles/board/band.ts` lifts the whole half rather than lighting a
 * badge inside it, which is `mtg-1nc`. The badge used to sit in this component
 * via `PlayerStatus`; `mtg-rgc.1` moved it to the left rail's pod, and these
 * two landed in the same merge, so the sentence is worth keeping current. Read
 * off the status props rather than
 * added to `BoardSide`, because whose turn it is is already in this component's
 * input and a second field for it would be a second thing to keep true. It is
 * always written, false included, so a stylesheet can select either state and
 * a test can tell "not active" from "this component never said".
 */
interface NearLane {
  readonly steps: ReactNode;
  readonly seam: ReactNode;
  readonly seamStyle: Readonly<Record<string, string>> | undefined;
}

function side(props: BoardSide, seat: BoardSeat, near: NearLane | null = null): ReactElement {
  return createElement(
    'div',
    {
      key: seat,
      className: 'mtg-board__side',
      'data-seat': seat,
      'data-active': props.status.active === true ? 'true' : 'false',
      // The attribute the command sheet turns the column into a grid on; absent
      // on a side with no zone so the standard table's cascade is untouched.
      ...(props.commandZone === undefined ? {} : { 'data-command-zone': 'true' }),
      // The panel column exists while either zone is drawn in it.
      ...(props.commandZone === undefined && props.avatars === undefined && props.libraryTop === undefined
        ? {}
        : { 'data-side-panel': 'true' }),
      // Written together or not at all: the attribute is what the stylesheet
      // selects on and the style is the number it reads, and a lane carrying one
      // without the other is a rule with no value or a value no rule reads.
      ...(near === null || near.seamStyle === undefined
        ? {}
        : { 'data-seam': 'true', style: near.seamStyle }),
    },
    createElement(Battlefield, props.battlefield),
    props.commandZone === undefined ? null : createElement(CommandZone, props.commandZone),
    props.avatars === undefined ? null : createElement(AvatarZone, props.avatars),
    props.libraryTop === undefined ? null : createElement(LibraryTop, props.libraryTop),
    // Between the two zones, which is the whole of `mtg-rgc.6`: the bar is the
    // seam between what is on the table and what you are holding.
    near?.steps ?? null,
    // And under the bar, on the hand's own edge, which is the edge it moves.
    near?.seam ?? null,
    props.hand === undefined ? null : createElement(Hand, props.hand),
  );
}

/**
 * A seat's graveyard and, when it owns an exiled card, its exile, each a strip
 * that opens (`./Graveyard.ts`, `./Exile.ts`). Shared by the pod column and by a
 * pod's opponent tiles, so a card sent to either place is reachable from the
 * seat that owns it wherever that seat is drawn.
 */
function zoneStrips(props: BoardSide, seat: BoardSeat): readonly ReactElement[] {
  const graveyard = props.graveyard;
  const exile = props.exile;
  return [
    ...(graveyard === undefined
      ? []
      : [createElement(Graveyard, { key: `${seat}-graveyard`, seat, ...graveyard })]),
    ...(exile === undefined ? [] : [createElement(Exile, { key: `${seat}-exile`, seat, ...exile })]),
  ];
}

/**
 * A seat's vitals, in the pod column rather than over its own lane (`mtg-rgc.1`).
 *
 * Out of `side` and into a column of its own, because the point of the
 * arrangement is that the two pods share one column: over its lane, each strip
 * cost that lane a row of the height the cards want, and the eye had to cross
 * the board to read the second player. `../styles/board/mat.ts` places the
 * column and `./SeatPod.ts` argues the block.
 *
 * **The seat's graveyard is drawn immediately under it** (`mtg-rgc.7`), which is
 * where `references/068-1083771671.png` draws it: Magic Online hangs each
 * player's zones off that player's own pod, and ours had both piles stacked at
 * the foot of a rail two columns over, so reading whose graveyard you were
 * looking at meant reading a label. Under the pod it needs no label at all —
 * the pod above it is the seat.
 *
 * It stays a `Graveyard`, which is a strip that opens rather than a list
 * (`./Graveyard.ts`), so what moved columns is one row of chrome and not a pile
 * of names. `./SeatPod.ts` still argues why the depth is not a fourth chip in
 * the pod: a chip is a number, and this is a number with the pile behind it.
 *
 * **Exile hangs under the graveyard on the same argument** (`mtg-iidz`, and
 * `./Exile.ts` for the zone itself). Two piles, one owner, one column: a card
 * this seat owns went somewhere, and both places it can have gone are reachable
 * from the seat that owns it without reading a label. It is supplied only when
 * that seat has an exiled card, so a game that exiles nothing draws exactly the
 * pod it drew before.
 */
function pod(props: BoardSide, seat: BoardSeat): readonly ReactElement[] {
  return [createElement(SeatPod, { key: seat, ...props.status, seat }), ...zoneStrips(props, seat)];
}

/**
 * The opponents of a pod, in table order, each a tile (`./PodRow.ts`).
 *
 * A tile is built from a side the way a duel's opponent lane is, so the lane's
 * arrival marks, click gestures and zoom reach every opponent through the one
 * function. `primary` is the seat the combat band was lifted out of, and it is
 * drawn from the band's remainder rather than from the position it was given:
 * the creatures the seam is holding are not also standing in the row.
 */
function opponents(table: BoardPod, primary: BoardSide): ReactElement {
  const tile = (seat: number, from: BoardSide, isPrimary: boolean): ReactElement =>
    podTile({
      seat,
      status: from.status,
      primary: isPrimary,
      body: side({ ...from, battlefield: { ...from.battlefield, tile: true } }, 'opponent'),
      zones: zoneStrips(from, 'opponent'),
    });
  const others = table.others.map((other) => tile(other.seat, other.side, false));
  return podRow([
    ...others.slice(0, table.opponentAt),
    tile(table.opponentSeat, primary, true),
    ...others.slice(table.opponentAt),
  ]);
}

export function Board(props: BoardProps): ReactElement {
  // The stack is drawn on the seam rather than in the rail, and it draws nothing
  // at all when it is empty (`./StackZone.ts`). It is handed to the band because
  // the band is the element it is positioned against; `./CombatZone.ts` says why
  // that is one arrangement rather than two. `beat` rides the same spread for
  // the same reason and is already in `props`.
  const combat = combatTable({ ...props, stack: createElement(StackZone, props.stack) });
  const table = props.pod;
  return createElement(
    'div',
    {
      className: 'mtg-board',
      'data-ask': props.askCollapsed === true ? 'shut' : 'open',
      'data-rail': props.railCollapsed === true ? 'shut' : 'open',
      'data-aiming': props.aiming === true ? 'true' : 'false',
      // Written only at a pod, so a duel's markup is the one it always was and a
      // sheet can select the arm that has a rail and a row without a class.
      ...(table === undefined ? {} : { 'data-pod': String(table.rail.seats.length) }),
    },
    createElement(
      'div',
      { className: 'mtg-board__pods' },
      props.askHead ?? null,
      // A pod's vitals are the rail, one row per player; a duel's are the two
      // pods at the ends of the column. Yours stays a pod either way, because
      // the mana pool and the zone counts under it are yours to act on.
      ...(table === undefined
        ? pod(props.opponent, 'opponent')
        : [createElement(SeatRail, { key: 'rail', ...table.rail })]),
      props.prompt ?? null,
      ...pod(props.you, 'you'),
    ),
    createElement(
      'div',
      { className: 'mtg-board__lanes' },
      // The seam holds the creatures fighting over it, so the two lanes are
      // drawn from what is left after it has taken them (`./CombatZone.ts`).
      // Combat belongs to the table rather than to either row: CR 508 declares
      // an attacker against the *defending player*, which is a fact about both
      // halves and about neither.
      table === undefined ? side(combat.opponent, 'opponent') : opponents(table, combat.opponent),
      combat.band,
      side(combat.you, 'you', {
        steps: props.steps ?? null,
        seam: props.seam ?? null,
        seamStyle: props.seamStyle,
      }),
      props.askFlyout ?? null,
    ),
    createElement('div', { className: 'mtg-board__rail' }, props.railHead ?? null, props.rail ?? null),
  );
}
