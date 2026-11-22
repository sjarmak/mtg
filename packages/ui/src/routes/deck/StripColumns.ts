/**
 * A deck, drawn the way the MTGO captures draw one: count-headed columns of
 * overlapping name-and-cost strips, one strip per copy.
 *
 * The same component wherever cards are organized — the deck editor's deck
 * region, its pool region, and the draft pool under the pack — for `./DeckCard.ts`'s
 * reason: three surfaces drawing one arrangement from three implementations is
 * three places for the count above a column to stop agreeing with the count in
 * the pane's own header, and that invariant is the whole point of the drawing.
 *
 * The arithmetic is not here. `./grouping.ts` decides what the columns are and
 * `./strips.ts` decides how far apart the strips sit; this file positions what
 * they computed and attaches the gestures. That split is what keeps the layout
 * testable without a browser, which matters because the pitch is the part that
 * can silently be wrong.
 *
 * # The tint is never alone
 *
 * A strip is filled from the same seven-way identity mapping the card face and
 * the deck tile read (`../../styles/card.ts`'s `FRAMED_SELECTORS`, which this
 * component's class is a member of), and it also prints the card's real mana
 * cost through the same symbol registry the face uses. So the color is said
 * twice, once as a fill and once as a glyph, and WCAG 1.4.1 is satisfied by
 * something the card already had rather than by an added badge. Turn the fill
 * off and the column still reads.
 *
 * # A foil copy is marked, and the mark does not sweep
 *
 * `mtg-p3g5`. A strip carries `data-foil` wherever the pane knows the answer,
 * and at compact it says so three ways: a star in the bar, a wash behind it, and
 * the word in `stripLabel`'s spoken name. Three because the section above is
 * this section's own rule -- a wash is a color, and a mark carried by color
 * alone is one a reader who cannot separate pearl from panel does not get.
 *
 * The wash is `../../styles/deck.ts` painting the compact bar with the same two
 * token stops `../../styles/card.ts`'s sheen uses -- held still. That is
 * deliberately the
 * *reduced-motion frame* of the face's treatment rather than the treatment: the
 * sheen is a highlight traveling over a picture of a card, and a strip is a row
 * in a list. Eight foil copies in one column would be eight bars sweeping at
 * once behind eight card names, which is a list nobody can read down. The face's
 * own docblock already argues that the still frame carries the whole of the
 * information and none of the movement, which is exactly what is wanted here.
 *
 * At the full density nothing is painted here, because the strip *is* a face and
 * the face draws its own sheen. The attribute is still written at both, because
 * it states what the pane knows rather than what the pane draws.
 *
 * # A click selects; the header acts
 *
 * `./ConstructedBuilder.ts` established the grammar this replaces: a click plays
 * one more copy, a right click cuts one, and both are also a named button under
 * every face, because a right click is neither a keyboard move nor a touch move.
 * A strip is a name bar with no room under it for a button, so the named buttons
 * move to the header and the strip's own gesture becomes selection: a click
 * selects that copy and the header's action group acts on it.
 *
 * The two accelerators are optional and a pane that has no move does not pass
 * them. `onActivate` is the double click and plays the pane's own move — cutting
 * a copy in a deck pane, which is what the client this is drawn from does with
 * that gesture. `onMenu` is the right click and the context key, and it plays
 * the reverse. Both are accelerators for a labeled button that is already in
 * the pane's header, which is the rule the original grammar was protecting:
 * nothing here is reachable only by a gesture a keyboard cannot make, and a
 * touch screen that has neither gesture still has both buttons.
 *
 * The `detail >= 2` guard on the click is `../../card/Card.ts`'s and it is
 * needed for the same measured reason: a real double click delivers `click`,
 * `click`, `dblclick`, so a strip wired for both would select on the first,
 * select again on the second, and then act — against a column the first two
 * clicks may have re-flowed. It is applied only where there is a double click
 * to protect, so a pane with no `onActivate` keeps two quick clicks as two.
 */
import { createElement } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { symbolizeLine } from '../../card/SymbolText';
import { isMenuKey } from '../../card/gesture';
import type { ClickGestureEvent, GestureEvent, KeyGestureEvent } from '../../card/gesture';
import type { Group } from './grouping';
import { groupHeadLabel, groupHeadToken } from './grouping';
import { identityOf } from './DeckTile';
import type { StackBox, Strip, StripDensity, StripFacts } from './strips';
import {
  DECK_STACK_BOX,
  fullColumnWidth,
  fullStackBox,
  openedStack,
  stackMetrics,
  stripLabel,
  stripsOf,
} from './strips';
import { boxFromRoom, useStackRoom } from './stack-box';

/**
 * A strip's own right edge, halfway down -- the anchor a floating preview
 * places itself against. `./ConstructedBuilder.ts`'s `edgeOf` computes the
 * same point off a card face; this is that function's other caller, one
 * layer down, where the button is a name bar instead of a face.
 */
export interface StripAnchor {
  readonly x: number;
  readonly y: number;
}

/**
 * The one shape this file reads off a hover or focus event: an element with
 * its own box. Spelled out rather than imported, for `./ConstructedBuilder.ts`'s
 * own reason -- the workspace tsconfig has no `lib: dom`.
 */
interface StripBoxed {
  readonly currentTarget: {
    readonly getBoundingClientRect: () => {
      readonly right: number;
      readonly top: number;
      readonly height: number;
    };
  };
}

function stripEdge(element: StripBoxed['currentTarget']): StripAnchor {
  const box = element.getBoundingClientRect();
  return { x: box.right, y: box.top + box.height / 2 };
}

export interface StripColumnsProps<T> {
  /** Already grouped and already sorted; see `./grouping.ts`. */
  readonly groups: readonly Group<T>[];
  readonly factsOf: (member: T) => StripFacts;
  /** The `Strip.key` of the selected copy, if any. */
  readonly selectedKey?: string | undefined;
  readonly onSelect: (strip: Strip<T>) => void;
  /**
   * Reports pointer or keyboard inspection without selecting or moving a
   * card. `at` is the strip's own anchor and is only meaningful while
   * `hovered` is `true`; a caller placing a floating preview reads it the
   * way `./ConstructedBuilder.ts`'s `cardFace` reads its own `onPoint`.
   */
  readonly onHover?: ((strip: Strip<T>, hovered: boolean, at: StripAnchor) => void) | undefined;
  /**
   * The double click: the pane's own move on this copy. A pane that reads a
   * finished deck has none and passes nothing, and two quick clicks there stay
   * two selections.
   */
  readonly onActivate?: ((strip: Strip<T>) => void) | undefined;
  /** The right click and the context key: the reverse of `onActivate`. */
  readonly onMenu?: ((strip: Strip<T>) => void) | undefined;
  /**
   * What a strip draws at the `full` density, and nothing else consults it.
   *
   * It draws *every* strip rather than one of them, and it draws the whole
   * face: the second argument is what the strip would otherwise have put on its
   * own button, handed over so the face can carry it. See `StripFaceGestures`.
   *
   * A compact region draws name bars and nothing else since `mtg-mxkrk` —
   * The playtester, 2026-09-17, "the compact view needs to just show the titles not
   * the card images" — so the bottom strip of a compact column is one more bar
   * and there is no slot here for a picture to go into. A pane that never draws
   * the full density therefore passes none of these at all.
   */
  readonly renderFace?: ((member: T, gestures: StripFaceGestures) => ReactNode) | undefined;
  /**
   * Which density this region is drawn at. `compact` is the name-and-cost bar
   * this component was written as and stays the default, so a caller that says
   * nothing draws what it has always drawn.
   */
  readonly density?: StripDensity | undefined;
  /** Overridable so a test can measure a box it chose. */
  readonly box?: StackBox | undefined;
  /** Names the whole region for a screen reader. */
  readonly label: string;
}

/**
 * The head above a column: what it is, and how many cards are under it.
 *
 * Under mana value the value is a pip rather than a number, which is
 * `./columns.ts`'s argument and survives the redrawing intact — a bare `3` above
 * a column of three-drops is ambiguous between the value and the count, and the
 * capture gets away with it only because none of its six counts could be
 * mistaken for a mana value. Every other axis names itself in a word, which
 * cannot be mistaken for a count at all.
 *
 * The count is the visible number in both cases, because it is the number that
 * sums to the pane's header.
 *
 * # The lone column keeps its name and loses its number
 *
 * A count exists to be compared with the counts beside it and to sum to the
 * pane; with one column there is nothing to compare and the sum is a number the
 * pane's own title already prints three lines above. That rule is `../DeckRoute.ts`'s
 * and it predates the strips, but it used to drop the whole head. It now drops
 * only the number, because the head no longer says one thing: under three of the
 * four axes it names the column in a word, and a pane grouped by color that
 * cannot say `White` has lost the answer the reader changed the control to get.
 * The redundant thing was always the number.
 */
function columnHead<T>(group: Group<T>, counted: boolean): ReactElement {
  // Hidden whole, because the column itself carries the sentence. A pip's
  // accessible name is the pip, a bare count announces as a number with no
  // noun, and the two of them read together as "3 5" — which is why the spoken
  // form is composed rather than assembled out of what is drawn.
  // Which buckets are a symbol is `./grouping.ts`'s call rather than this
  // file's, since `mtg-84703` gave the color axis the same treatment on the
  // other head drawing (`./CurveColumns.ts`) and two answers to one question is
  // two spellings of Multicolor.
  const token = groupHeadToken(group);
  return createElement(
    'div',
    { className: 'mtg-strips__head', 'aria-hidden': true },
    token === null
      ? createElement('span', { className: 'mtg-strips__what' }, group.label)
      : createElement('span', { className: 'mtg-strips__what' }, ...symbolizeLine(token)),
    counted ? createElement('span', { className: 'mtg-strips__count' }, String(group.cards)) : null,
  );
}

/**
 * What a full-density face is handed, so that the face is the button.
 *
 * At `compact` the strip owns a `<button>` and puts a name bar inside it. At
 * `full` what goes inside is a whole card face, and a card face is already a
 * button on every surface in this app -- so the strip becomes a positioned
 * `<div>` and hands the gestures down instead. That is a content-model decision
 * before it is a taste one: `button` takes phrasing content, which is why
 * `../../card/ArtSlot.ts` is built out of spans, and a face nested inside a
 * strip button would be the first thing on this screen to break the rule that
 * file follows.
 *
 * The strip still *composes* the gestures. Which click selects, which one is the
 * pane's move and which is its reverse is decided here for both densities; the
 * caller only decides what draws.
 */
export interface StripFaceGestures {
  readonly selected: boolean;
  /**
   * This face is showing whole rather than banded: the bottom of the column, or
   * the one somebody opened.
   */
  readonly open: boolean;
  readonly onSelect: () => void;
  readonly onActivate?: (() => void) | undefined;
  readonly onMenu?: (() => void) | undefined;
}

/**
 * Where a strip sits, given how far the strips below an open one have slid.
 *
 * `--strip-push` is written on the stack rather than multiplied in here for the
 * same reason `--strip-pitch` is: one number per column, and the drawing does
 * the arithmetic in the units it lays out in.
 */
function stripTop(index: number, pushed: boolean): string {
  const stacked = `calc(var(--strip-pitch) * ${String(index)}`;
  return pushed ? `${stacked} + var(--strip-push))` : `${stacked})`;
}

/**
 * The foil answer as the markup states it: `true`, `false`, or nothing at all.
 *
 * Three states rather than two, and the same three the card face writes, because
 * a pane whose pool never measured the question has to be able to say so. `mtg-jpbv`
 * argues it on the face; `./strips.ts`'s `Strip.foil` carries it here.
 */
function foilAttribute(foil: boolean | undefined): string | undefined {
  if (foil === undefined) return undefined;
  return foil ? 'true' : 'false';
}

function stripElement<T>(
  strip: Strip<T>,
  index: number,
  props: StripColumnsProps<T>,
  openIndex: number | null,
): ReactElement {
  const selected = props.selectedKey === strip.key;
  const activate = props.onActivate;
  const menu = props.onMenu;
  const hover = props.onHover;
  const style: CSSProperties = {
    top: stripTop(index, openIndex !== null && index > openIndex),
  };
  if (props.density === 'full') {
    const open = strip.full || selected;
    const gestures: StripFaceGestures = {
      selected,
      open,
      onSelect: (): void => {
        props.onSelect(strip);
      },
      ...(activate === undefined
        ? {}
        : {
            onActivate: (): void => {
              activate(strip);
            },
          }),
      ...(menu === undefined
        ? {}
        : {
            onMenu: (): void => {
              menu(strip);
            },
          }),
    };
    return createElement(
      'div',
      {
        key: strip.key,
        className: 'mtg-strips__card',
        style,
        'data-identity': identityOf(strip.colorIdentity),
        'data-foil': foilAttribute(strip.foil),
        'data-full': strip.full ? 'true' : undefined,
        'data-open': open ? 'true' : undefined,
        'data-selected': selected ? 'true' : undefined,
        ...(hover === undefined
          ? {}
          : {
              onMouseEnter: (event: StripBoxed): void => hover(strip, true, stripEdge(event.currentTarget)),
              onMouseLeave: (): void => hover(strip, false, { x: 0, y: 0 }),
              onFocus: (event: StripBoxed): void => hover(strip, true, stripEdge(event.currentTarget)),
              onBlur: (): void => hover(strip, false, { x: 0, y: 0 }),
            }),
      },
      props.renderFace?.(strip.member, gestures) ?? null,
    );
  }
  return createElement(
    'button',
    {
      key: strip.key,
      type: 'button',
      className: 'mtg-strips__card',
      style,
      'data-identity': identityOf(strip.colorIdentity),
      'data-foil': foilAttribute(strip.foil),
      'data-full': strip.full ? 'true' : undefined,
      'data-selected': selected ? 'true' : undefined,
      'aria-pressed': selected,
      'aria-label': stripLabel(strip),
      onClick: (event: ClickGestureEvent) => {
        // The second press of a double click is not a second selection. See the
        // docblock; the measurement behind it is `../../card/Card.ts`'s.
        if (activate !== undefined && event.detail >= 2) return;
        props.onSelect(strip);
      },
      ...(hover === undefined
        ? {}
        : {
            onMouseEnter: (event: StripBoxed): void => hover(strip, true, stripEdge(event.currentTarget)),
            onMouseLeave: (): void => hover(strip, false, { x: 0, y: 0 }),
            onFocus: (event: StripBoxed): void => hover(strip, true, stripEdge(event.currentTarget)),
            onBlur: (): void => hover(strip, false, { x: 0, y: 0 }),
          }),
      // Each handler is omitted rather than wired to a no-op when its pane has
      // no move, so a strip in a pane that only reads carries exactly the one
      // handler it always did and nothing on it swallows the browser's menu.
      ...(activate === undefined
        ? {}
        : {
            onDoubleClick: (): void => {
              activate(strip);
            },
          }),
      ...(menu === undefined
        ? {}
        : {
            onContextMenu: (event: GestureEvent): void => {
              event.preventDefault();
              menu(strip);
            },
            onKeyDown: (event: KeyGestureEvent): void => {
              if (!isMenuKey(event)) return;
              event.preventDefault();
              menu(strip);
            },
          }),
    },
    createElement(
      'span',
      { className: 'mtg-strips__bar' },
      createElement('span', { className: 'mtg-strips__name', title: strip.name }, strip.name),
      // Hidden from the reading, because `stripLabel` already puts the word in
      // the strip's accessible name and a star announced beside it would be the
      // same fact twice under a name nobody chose. Drawn only for `true`: an
      // ordinary copy is the unmarked case and an unmeasured pool is not a
      // claim.
      strip.foil === true
        ? createElement('span', { className: 'mtg-strips__foil', 'aria-hidden': true }, '\u2605')
        : null,
      // The printed cost, through the registry the card face uses. A token no
      // set states stays printed as written, which is `symbolizeLine`'s own rule
      // and right here: `{W/U}` reads as `{W/U}` rather than as a blank.
      strip.manaCost === null || strip.manaCost === ''
        ? null
        : createElement('span', { className: 'mtg-strips__cost' }, ...symbolizeLine(strip.manaCost)),
    ),
  );
}

function column<T>(
  group: Group<T>,
  props: StripColumnsProps<T>,
  box: StackBox,
  counted: boolean,
): ReactElement {
  const strips = stripsOf(group.members, props.factsOf);
  const metrics = stackMetrics(strips.length, box);
  // The strip somebody opened, which slides the ones under it down. Only at the
  // full density: a compact strip is a name bar and has nothing more of itself
  // to show, which is `mtg-mxkrk` from the other side.
  const openIndex =
    props.density === 'full' && props.selectedKey !== undefined
      ? strips.findIndex((strip) => strip.key === props.selectedKey)
      : -1;
  const opened = openedStack(metrics, box, strips.length, openIndex < 0 ? null : openIndex);
  const style: CSSProperties = {
    '--strip-pitch': `${String(metrics.pitch)}px`,
    // The open strip's height, and only the full density has one to state: there
    // the strip is a whole card and the drawing has to be told how tall, because
    // a face left to its own aspect ratio resolves against the column's width
    // and comes out taller than the `faceHeight` every pitch in the column was
    // computed against, so both ends of the stack disagree about where the
    // column ends and it runs out of its box. At compact there is no picture to
    // size -- the bottom strip is one more name bar since `mtg-mxkrk` -- so the
    // property is not written and no sheet rule reads it.
    ...(props.density === 'full' ? { '--strip-face': `${String(box.faceHeight)}px` } : {}),
    '--strip-push': `${String(opened.push)}px`,
    blockSize: `${String(opened.height)}px`,
  } as CSSProperties;
  return createElement(
    'div',
    {
      key: group.key,
      className: 'mtg-strips__col',
      role: 'group',
      'aria-label': groupHeadLabel(group),
    },
    columnHead(group, counted),
    createElement(
      'div',
      {
        className: 'mtg-strips__stack',
        style,
        // A column past the pitch floor is taller than its box and is clipped by
        // it. Said in the markup rather than left to the eye, so the sheet can
        // mark it and a test can find it. `./strips.ts` argues the floor.
        'data-clipped': opened.clipped ? 'true' : undefined,
      },
      ...strips.map((strip, index) => stripElement(strip, index, props, openIndex < 0 ? null : openIndex)),
    ),
  );
}

/**
 * The region: every column, side by side, in a box of a fixed height.
 *
 * It never wraps and it scrolls sideways, which is the second decision of
 * 2026-08-29 and the reason the whole arrangement holds together — the count row
 * is always one line and the box is the same height at pick 1 and at pick 45, so
 * nothing below it walks down the page as a deck fills up.
 */
export function StripColumns<T>(props: StripColumnsProps<T>): ReactElement {
  const { room, ref } = useStackRoom();
  // At `full` the box is derived from the *width* the pane turns out to have,
  // divided by the columns it is holding: the playtester asked for cards sized so a
  // deck can be read without scrolling, and a named width cannot answer that on
  // two different desks. At `compact` the box the caller states is the floor and
  // `./stack-box.ts` raises it to the pane's height, which is every surface that
  // drew this region before `mtg-rgc.21`.
  const columnWidth =
    props.density === 'full' ? fullColumnWidth(room?.scrollportWidth ?? null, props.groups.length) : null;
  const base = columnWidth === null ? (props.box ?? DECK_STACK_BOX) : fullStackBox(columnWidth);
  const box = room === null ? base : boxFromRoom(base, room);
  const style: CSSProperties = {
    '--strip-box': `${String(box.boxHeight)}px`,
    ...(columnWidth === null ? {} : { '--strip-width': `${String(columnWidth)}px` }),
  } as CSSProperties;
  return createElement(
    'div',
    {
      className: 'mtg-strips',
      style,
      ref,
      role: 'group',
      'aria-label': props.label,
      'data-density': props.density ?? 'compact',
    },
    ...props.groups.map((group) => column(group, props, box, props.groups.length > 1)),
  );
}
