/**
 * The card face: one component, every DSL card kind.
 *
 * Text is never re-derived here. The type line comes from `renderTypeLine` and
 * the rules text from `renderOracleText`, both in `@mtg/dsl`, so the printed
 * face and the Forge export and the set report all say the same words. This
 * component's whole job is frame, layout and state.
 *
 * What the face *looks like* is not decided here either: the region order, the
 * art window ratio, the rarity seal, the collector line and the frame treatment
 * come from `./anatomy.ts`, which `@mtg/card-render` builds its printed face
 * from too (ADR-0002). This file owns the parts a printed card has no opinion
 * about — being a button, being selectable, and shrinking to a battlefield
 * thumbnail.
 */
import { Fragment, createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard, CreatureCard, Rarity, SetRef } from '@mtg/dsl';
import {
  isCastable,
  isCreature,
  isLand,
  isPlaneswalker,
  printedPowerToughness,
  renderOracleText,
  renderTypeLine,
} from '@mtg/dsl';
import {
  ART_REGIONS,
  BOARD_REGIONS,
  COMPACT_REGIONS,
  FACE_REGIONS,
  collectorLine,
  faceAttributes,
  frameTreatment,
  nameFitStep,
  rulesFitStep,
  setSealPath,
  textBoxBlocks,
  typeFitStep,
} from './anatomy';
import type { FaceRegion } from './anatomy';
import { typeBands, typeLinePieces } from './type-line';
import { lineRuns, oracleBlocks } from './text-box';
import type { TextBlock } from './text-box';
import { ManaPips, manaCostLabel } from './ManaPips';
import { symbolElement, symbolizeLine } from './SymbolText';
import { DEFAULT_SYMBOL_SET } from './symbols';
import type { SymbolSet } from './symbols';
import { ArtSlot } from './ArtSlot';
import type { CardArt } from './ArtSlot';
import { usePressGestures } from './press';

/**
 * `full` is the readable face; `board` is what a card in play wears; `compact`
 * is the art-less dense one, which belongs to deckbuilding and to nothing else;
 * `art` is the picture with a keyline round it, which the mana base wears.
 *
 * More than two sizes, because the played table and the deck builder want
 * opposite things out of the same card. On the table you are looking at
 * permanents you act on, so the picture is the fastest way to tell them apart,
 * and it shares the face with as much of the rules text as the card's height
 * can hold. In a builder you are scanning a ninety-card pool for what to cut, so
 * the picture is what stands between you and three times as many cards down the
 * page. the playtester, 2026-08-11: "I always want to be able to see the art on the
 * battlefield, the compact view should only be an option in deckbuilding."
 *
 * The second half of that first sentence used to read "and the rules text can
 * wait for the hover", which is what `mtg-u69` was filed against: a hover is one
 * card at a time and needs a pointer, and this face is worn by every card in
 * play *and* every card in hand. `./anatomy.ts`'s `BOARD_REGIONS` carries the
 * reversal.
 *
 * `art` is the same argument taken one step further for the one permanent whose
 * text a player never re-reads. the playtester, 2026-08-13: "I want the lands to
 * show up a little nicer so they are in a row below the cards in play and that
 * they just show their art no thick border and no text". It is a size rather
 * than a component of its own, because everything a caller needs off a land —
 * the button, the accessible name, the description, the identity edge, the
 * pending frame — is what this component already does, and a second face
 * component is a second copy of all of it that can drift.
 */
export type CardSize = 'full' | 'compact' | 'board' | 'art';

/**
 * The event members the context gesture reads, declared structurally.
 *
 * The workspace tsconfig has no `lib: dom` (`../mount.ts` writes out why), so
 * these are named here instead of imported. React's own event types satisfy
 * both, which is what makes the handlers below assignable to a button's props.
 */
interface GestureEvent {
  preventDefault(): void;
}

interface KeyGestureEvent extends GestureEvent {
  readonly key: string;
  readonly shiftKey: boolean;
}

/** How many presses this click is part of; 2 is the second half of a double click. */
interface ClickGestureEvent {
  readonly detail: number;
}

/**
 * The keyboard's two ways of asking for a context menu.
 *
 * `ContextMenu` is the dedicated key and `Shift+F10` is the long-standing
 * binding for keyboards without one; both are what a screen-reader user reaches
 * for. Without them the right click would be the only route to a card's menu,
 * and a gesture with no keyboard equivalent is a gesture some players do not
 * have.
 */
function isMenuKey(event: KeyGestureEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** The regions each size lays out, in the order it lays them out. */
const REGIONS_BY_SIZE: Readonly<Record<CardSize, readonly FaceRegion[]>> = {
  full: FACE_REGIONS,
  compact: COMPACT_REGIONS,
  board: BOARD_REGIONS,
  art: ART_REGIONS,
};

/**
 * What a creature's size currently is, when that is not what it printed.
 *
 * A card has printed numbers and a permanent has the numbers the layer system
 * reports, and those are two different facts that were being drawn by one field.
 * A gallery, a hand and a deck list are all looking at the card, so they hand
 * this nothing and get the print. A permanent on the played table is looking at
 * an object, and its caller reads `powerOf` / `toughnessOf` (`@mtg/kernel`) or a
 * recorded snapshot's derived pair, so an equipped or pumped creature reads as
 * what combat will actually be fought with rather than as what it was printed
 * with. This component computes neither; it draws what it is handed.
 */
export interface FaceStats {
  readonly power: number;
  readonly toughness: number;
}

export interface CardProps {
  readonly card: DslCard;
  /** `null` (or omitted) renders the labeled pending frame. */
  readonly art?: CardArt | null;
  readonly size?: CardSize;
  readonly selected?: boolean;
  /** Present makes the face a button; absent leaves it inert. */
  readonly onSelect?: (card: DslCard) => void;
  /** Moves focus to this interactive face when it mounts. */
  readonly autoFocus?: boolean;
  /**
   * A double click on the face: the caller's *default* action for this card.
   *
   * Wired only where a card is a click target for its own moves — the played
   * table — and absent everywhere else, so a gallery face publishes exactly the
   * handlers it did before. What a default is, and when a card has none, is
   * `../routes/play/default-action.ts`; this component only delivers the
   * gesture.
   */
  readonly onActivate?: (card: DslCard) => void;
  /**
   * A right click on the face, or the keyboard's own way of asking for the same
   * thing: `ContextMenu`, and `Shift+F10` for the keyboards without that key.
   *
   * Present also suppresses the browser's own menu on this element, because the
   * two menus cannot both be the answer to one gesture. Both key bindings are
   * here rather than at the call site so that no surface can wire the pointer
   * gesture and forget the keyboard one.
   */
  readonly onMenu?: (card: DslCard) => void;
  /** A line for the foot of an abbreviated face, e.g. a controller on the battlefield. */
  readonly footnote?: string;
  /** The current size of a permanent; absent prints the card's own numbers. */
  readonly stats?: FaceStats;
  /**
   * Which glyph set the rules box paints its brace tokens with. Absent takes
   * the registry's own default (`./symbols.ts`), which is what every call site
   * in the lab does; the prop exists so a caller publishing a face can ask for
   * the set with no third-party artwork in it, the way `render-set.ts` does.
   */
  readonly symbols?: SymbolSet;
}

/**
 * The box the seal is drawn in and where it sits inside it, scaled by CSS like
 * every other icon. One constant rather than four expressions, because the
 * parity test re-derives the outline from it instead of from a copy.
 */
export const SCREEN_SEAL = { box: 20, cx: 10, cy: 10, radius: 9 } as const;

/**
 * The set symbol, from the shared outline, painted in the rarity's ink.
 *
 * It always announces itself now, and used to do so only when a footnote had
 * displaced the collector line. The line was the reason: while a face printed
 * "XMP 073 · uncommon · MV 4" the seal was a second reading of a word already
 * on the card, exactly as the mana pips are a second reading of the printed
 * cost, and a second reading belongs out of the accessible tree. No face prints
 * that line any more (`./anatomy.ts`, `FACE_REGIONS`), so the seal is the only
 * thing on the card carrying either the set or the rarity, and it takes the
 * name back at every size. The `named` flag went with the argument for it.
 *
 * Both facts, in the order a collector line printed them. The mark is the set's
 * and the ink is the rarity's, and a reader who cannot see either gets the two
 * words the drawing is made of rather than the half of it that used to be
 * expressible.
 */
function raritySeal(set: SetRef, rarity: Rarity): ReactElement {
  return createElement(
    'svg',
    {
      className: 'mtg-card__seal',
      viewBox: `0 0 ${String(SCREEN_SEAL.box)} ${String(SCREEN_SEAL.box)}`,
      'data-set': set.code,
      'data-rarity': rarity,
      role: 'img',
      'aria-label': `${set.code} ${rarity}`,
    },
    createElement('path', {
      d: setSealPath(set.code, SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius),
    }),
  );
}

/**
 * `3/3` for a permanent whose caller measured it, `1/3` for a card nobody has
 * put into play. One function, so the foot and the accessible name cannot end
 * up quoting different numbers off one face.
 */
function sizeText(card: CreatureCard, stats?: FaceStats): string {
  if (stats === undefined) return printedPowerToughness(card);
  return `${String(stats.power)}/${String(stats.toughness)}`;
}

function oracleLines(card: DslCard): readonly string[] {
  const text = renderOracleText(card);
  return text.length === 0 ? [] : text.split('\n');
}

/**
 * Everything an abbreviated face drops, as one string.
 *
 * The face's accessible description, and the whole of the text on faces that cut
 * it. A `title` costs no layout, is announced by a screen reader, and cannot
 * intercept the click that plays the card, because it is an attribute and not an
 * element.
 *
 * This docblock used to say that on a touch screen "the rules text of a
 * permanent is not reachable from the table at all", because the visual detail
 * channel was the hover zoom in `../board/CardSlot.ts` and there is no hover on
 * a finger. That is the sentence `mtg-u69` was filed on, and it is no longer
 * true of the `board` face: that face prints as many lines of its rules box as
 * its height holds, with no pointer event involved (`./anatomy.ts`,
 * `BOARD_REGIONS`). What this string is for at that size is the rest — a line
 * past the clip, a name or type line the bar cut — and at `compact`, which draws
 * no rules box at all, it is still the only copy.
 *
 * It reaches a screen reader as the *description* rather than as the name,
 * which is why it may be a paragraph. The explicit name did not buy that, and
 * an earlier revision of this docblock claimed it did. Chromium maps `title` to
 * the accessible description whenever the name comes from any source but the
 * title, and a name concatenated out of the face's own contents is such a
 * source. Measured in chrome-headless-shell 151.0.7922.47 over
 * `Accessibility.getFullAXTree`, the board face at merge-base `09ada43` already
 * answered `desc="Swamp Basic Land — Swamp {T}: Add {B}."`, and under the
 * `aria-label` it answers with the same string. What is new is `compact`, which
 * carried no `title` at all and so had nothing to promote.
 *
 * **The collector line is the fourth field, and it is why the `full` face now
 * carries this attribute too.** That face used to print "XMP 073 · uncommon ·
 * MV 4" in a bar of its own and carry no detail text at all; the bar is gone
 * (`./anatomy.ts`, `FACE_REGIONS`) and the words have to be somewhere, because
 * a board screenshot and a proxy sheet have to identify the printing. So it
 * moved here, where it costs no layout on a face whose rules box was the region
 * paying for the bar. The printed face keeps drawing the bar, because paper has
 * no hover. A full face does now say its rules text twice — once in the box it
 * prints and once in this string — which is the price of the line having one
 * home on screen rather than two.
 *
 * The name and the type line are here even though the face prints both, because
 * the face prints them into a box narrow enough to ellipsize; this is the copy
 * that is never cut. Measured at the same version in the 68.47 x 95.64px slot
 * `../../test/board-face-cost.test.ts` takes its arithmetic from, Skywatch
 * Sentinel's board face paints `Skywat` then `…` for its name and `Crea` then
 * `…` for its type line, so this string is the only whole copy of either. Kept
 * from `ui/board-face` (7737dbd), and renamed off `boardHoverText` when the compact
 * face was given the same attribute: compact drops the rules box too, and the
 * sealed builder draws its whole pool at that size with no zoom and no preview
 * beside it, so a printed ability was unreachable there by pointer, by finger
 * and by screen reader alike.
 *
 * `../../test/card-face-detail.test.ts` holds the three fields against written
 * sentences rather than against this function's own output.
 */
export function faceDetailText(card: DslCard): string {
  return [card.name, renderTypeLine(card), ...oracleLines(card), collectorLine(card)]
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * What the whole face is called, as one spoken line.
 *
 * Five regions are laid out here and until this function nothing said what
 * their sum should be called, so the name a screen reader read was whatever the
 * region order and the descendants' own labels happened to concatenate to.
 * Measured in Chromium 151 on the played table, a Swamp in play answered to
 *
 *     Art pending for slc-swamp Swamp Basic Land — Swamp common
 *
 * and a face with no `onSelect` answered to nothing at all, because a `div`
 * carrying no role is not an object the accessibility tree keeps.
 *
 * **The decision.** A face is named the way a player reads a card aloud, in
 * printed order: the name, the cost, the type line, and the stats a creature
 * carries. Four fields, and deliberately not one more.
 *
 * - The art window is a picture *of* the card rather than part of what the card
 *   is, and while there is no picture it shows a production status, which
 *   belongs on the screen and not in the card's name. It keeps its own label
 *   (`./ArtSlot.ts`), which both renderers publish and `@mtg/card-render`'s
 *   parity suite pins, so nothing is lost by leaving it out of this one.
 * - The card id is not printed on a card at all. It reached the name through
 *   that same art label, and it is the field that made the leak obvious.
 * - The rarity is a fact about the printing. The seal announces it and the
 *   collector line in the description spells it; saying it a third time turns
 *   the card's name into a database row.
 * - The rules text is a paragraph, and a name is what focus repeats every time
 *   it lands. Every size gets those words back as the face's *description*,
 *   from `faceDetailText` in `title`. At `full` that description now doubles
 *   the box the face prints, which is new and is the price of the collector
 *   line having one home on screen: measured in chrome-headless-shell
 *   151.0.7922.47, the box's spans stay in the tree as `StaticText` with
 *   `ignored=false` inside the face even when the face is a `button`, so at
 *   that size the rules text is reachable both by moving through the card and
 *   by landing on it. Name, description and content are three different places,
 *   and the rules text is in the second everywhere and in the third at `full`.
 *
 * The cost is in, though the pip run already names itself, because on the board
 * face the pips are `aria-hidden` and the hover text has never carried a cost:
 * without this the one number that decides whether a card is castable reaches
 * nobody who cannot see it. That premise is `cornerCost` below, and
 * `../../test/card-face-detail.test.ts` fails if the `aria-hidden` goes. At
 * `full` and `compact` the pip run is not hidden, so those two faces do say the
 * cost twice, once as part of this name and once as the run's own; the
 * concatenated name they had before said it twice as well.
 *
 * `stats` is the fourth field's other source, for a creature. The name says the
 * size the face draws, so a creature carrying a weapon is announced at the size
 * the layer system reports it at, exactly as the foot prints it. Saying 1/3
 * into an ear while the same face shows 3/3 to an eye is the one version of
 * this that is indefensible. A planeswalker's fourth field is its own printed
 * number instead — `stats` carries no loyalty, because loyalty has no layer
 * system pumping it the way power and toughness do (`FaceStats` above), so the
 * name always says what the corner badge says.
 */
export function faceAccessibleName(card: DslCard, stats?: FaceStats): string {
  const fields = [card.name];
  if (isCastable(card)) fields.push(manaCostLabel(card.manaCost));
  fields.push(renderTypeLine(card));
  if (isCreature(card)) fields.push(sizeText(card, stats));
  if (isPlaneswalker(card)) fields.push(`Loyalty ${String(card.startingLoyalty)}`);
  return `${fields.join('. ')}.`;
}

/**
 * The class the roman run of a reminder line is set in: the keyword, which is
 * rules text, ahead of the italic gloss the sheet sets the rest of the line in.
 *
 * A nested element rather than a line of its own, because the keyword and its
 * parenthetical are one sentence that has to wrap into itself the way a printed
 * card's does. Where the roman run ends is `./text-box.ts`'s call, not this
 * file's, so the two faces cannot put the boundary in different places.
 */
const REMINDER_KEYWORD_CLASS = 'mtg-card__reminder-keyword';

/**
 * The class the gloss on a *rules* line is set in: the reminder text a sentence
 * carries, italic inside a line the sheet otherwise sets roman.
 *
 * The mirror of the class above, and it exists for the same reason in the
 * opposite direction. A block's face comes from `data-block`, so a run that
 * departs from it needs a class of its own: a reminder block is italic and its
 * keyword departs upright, a rules block is upright and its gloss departs
 * italic. Where the departure begins is `./text-box.ts`'s `roman` boundary in
 * both cases, so the two faces cut the line in one place.
 */
const GLOSS_CLASS = 'mtg-card__gloss';

/**
 * The cost badge at the head of a loyalty ability's row, or nothing.
 *
 * Inside the row rather than beside it, which is what makes the box readable in
 * printed order: a screen reader moving through the rules text hears "+1" and
 * then the ability it buys, in the order a player reads them off the card. It
 * is the mirror of `cornerStats`' argument one level down — that badge is a
 * *sibling* of the regions precisely because it is not part of what the box
 * says, and this one is a child precisely because it is.
 *
 * A run of nodes rather than a node, so a row with no cost spreads to nothing
 * and its text starts at the left margin with no empty element in front of it.
 */
function loyaltyBadge(block: TextBlock): readonly ReactNode[] {
  const cost = block.loyaltyCost;
  if (cost === undefined) return [];
  return [createElement('span', { key: 'loyalty', className: 'mtg-card__loyalty' }, cost)];
}

/** One line of the box as nodes: its roman run, if it has one, then the rest. */
function lineContent(block: TextBlock, symbols: SymbolSet): readonly ReactNode[] {
  const { roman, rest } = lineRuns(block, block.text);
  const painted = symbolizeLine(rest, symbols);
  if (roman.length === 0) return painted;
  if (block.kind !== 'rules') {
    return [createElement('span', { key: 'roman', className: REMINDER_KEYWORD_CLASS }, roman), ...painted];
  }
  // The roman run of a rules line is a whole sentence rather than a keyword, so
  // it goes through `symbolizeLine` as well: `{T}: Put a gloom counter on target
  // creature. (…)` prints its tap symbol on the side of the boundary the
  // sentence is on.
  return [
    ...symbolizeLine(roman, symbols),
    createElement('span', { key: 'gloss', className: GLOSS_CLASS }, ...painted),
  ];
}

/**
 * The rules box. Each printed line goes through `symbolizeLine`, so a brace
 * token arrives as a painted abbreviation rather than as three characters of
 * text — and as an abbreviation that still carries `{T}` as its own content, so
 * the line reads the same to a screen reader, a find-in-page and this package's
 * own parity assertions as it did when it was set as plain text.
 *
 * `data-fit` is the step the shared ladder put this card on
 * (`./anatomy.ts`, `rulesFitStep`), and `../styles/card.ts` keys a font size off
 * it. The attribute is what makes the fit testable: a size resolved by CSS is
 * something only a browser knows, and a step written into the markup is
 * something jsdom, a proof sheet and the parity suite can all read.
 *
 * The step is the *card's*, not the box's, so it is published at every size and
 * the board face overrides the size it implies. A ladder whose floor is 0.78
 * cannot describe a battlefield thumbnail's box, and `BOARD_RULES_CQW` in the
 * sheet says what that face does instead and why pretending otherwise would be
 * worse than clipping.
 *
 * The keyword line is first because `renderOracleText` prints it first, and on
 * the board face that ordering is load-bearing rather than cosmetic: the box
 * there clips at a stated number of lines, so the line that survives is the one
 * a block is decided on.
 *
 * **What the box holds is `./text-box.ts`'s call, not this function's.** A full
 * face draws the rules text, the reminder text its keywords print and the flavor
 * text when there is room; a `board` face draws the rules blocks and nothing
 * else. That file carries both reasons — a clipped box spends its lines on the
 * words combat turns on, and `../../test/play/seat-voice.test.ts` fails a
 * hotseat table on any second-person word, which two of the eight reminders
 * contain. Each block declares its kind and the sheet italicizes the two that
 * are not rules text.
 *
 * A `data-block` attribute rather than a class per kind for the same reason
 * `data-fit` is an attribute: it is a fact about the line that jsdom, a proof
 * sheet and the parity suite can all read without resolving a stylesheet.
 */
function textBox(card: DslCard, symbols: SymbolSet, size: CardSize): ReactElement {
  const blocks = size === 'board' ? oracleBlocks(card) : textBoxBlocks(card);
  const keyworded = card.kind !== 'land' && card.keywords.length > 0;
  const children = blocks.map((block, index) =>
    createElement(
      'span',
      {
        key: `${index}`,
        className:
          keyworded && index === 0 && block.kind === 'rules'
            ? 'mtg-card__line mtg-card__keywords'
            : 'mtg-card__line',
        'data-block': block.kind,
        // The row's own cost, published for the reason `data-block` is: the
        // sheet rules a line above a costed row and lays it out in two columns,
        // and a step resolved by CSS is something only a browser knows. Absent
        // on a row that carries none, so `[data-loyalty]` in the sheet is the
        // whole selector and a full-width row needs no second attribute to say
        // so.
        ...(block.loyaltyCost === undefined ? {} : { 'data-loyalty': block.loyaltyCost }),
      },
      ...loyaltyBadge(block),
      ...lineContent(block, symbols),
    ),
  );
  return createElement(
    'span',
    {
      className: 'mtg-card__text',
      'data-region': 'rules',
      'data-fit': String(rulesFitStep(card)),
    },
    ...children,
  );
}

/**
 * The mana cost, drawn inside the art window's upper-right corner on a board
 * face and on the title row everywhere else.
 *
 * Inside the window rather than over the face, because `.mtg-art` is
 * `overflow: hidden`: a badge pinned there is clipped by the picture and can
 * never be drawn on the name or the type line underneath, whatever height the
 * window ends up with.
 *
 * `aria-hidden`, because `faceAccessibleName` spells the cost and this run
 * would say it a second time inside the same button. Not the hover text: that
 * is `faceDetailText`, which carries the name, the type line and the rules
 * lines and has never carried a cost. Measured in chrome-headless-shell
 * 151.0.7922.47, a board face publishes an `image` child for its art window and
 * none for its cost, while a full or compact face publishes
 * `image name="Mana cost {1}{W}"`. Taking the attribute off is what
 * `../../test/card-face-detail.test.ts` fails on, because the name above is
 * argued from it.
 */
function cornerCost(card: DslCard, symbols: SymbolSet): ReactNode {
  if (!isCastable(card)) return null;
  return createElement(
    'span',
    { className: 'mtg-card__corner', 'aria-hidden': true },
    createElement(ManaPips, { cost: card.manaCost, symbols }),
  );
}

/**
 * The mana a land makes, drawn large over the corner of an art tile.
 *
 * The playtester, 2026-08-14: "I want the lands to show up a bit bigger too so it's
 * obvious they're lands". A tile has no words on it by construction, so what
 * says land has to be a picture, and both land references she filed use the same
 * one — a mana symbol, in the text box on the standard basic and floating over
 * the art on the full-art one. The tile has no text box, so it takes the
 * full-art placement.
 *
 * Through `symbolElement` rather than `pipArt`, which is the rule
 * `./anatomy.ts`'s `pipToken` docblock states for the cost line and this is the
 * same rule one surface further out: `./symbols.ts` is the one registry, so a
 * launcher that staged the real symbols paints this one too and a tile's drop
 * is the same drop the rules box prints. `producesMana` is the DSL's own field,
 * so nothing here reads a land's oracle text to work out what it taps for.
 *
 * `aria-hidden`, because `faceAccessibleName` already says the card's name and
 * its type line, and a screen reader that hears "Island. Basic Land — Island."
 * does not need "one blue mana" appended to it. Multi-color lands would draw
 * one symbol each; `checkLandColors` allows only the one a basic type produces
 * today, so the run is a run of one in every set this checkout can build.
 */
function landPip(card: DslCard, symbols: SymbolSet): ReactNode {
  if (!isLand(card) || card.producesMana.length === 0) return null;
  return createElement(
    'span',
    { className: 'mtg-card__mana', 'aria-hidden': true },
    ...card.producesMana.map((color, index) => symbolElement(`m${String(index)}`, color, symbols)),
  );
}

/**
 * The corner badge, wherever it is mounted: a creature's power/toughness, or a
 * planeswalker's starting loyalty. One element per kind, so the two mounts
 * agree, and the two kinds share this function because CR 613's later-layer
 * numbers a creature carries have no planeswalker equivalent — `FaceStats` is
 * the shape of a live-state override and `startingLoyalty` is always the
 * printed number, never one.
 *
 * **They no longer share an element, and the reason is that they are not the
 * same badge.** A printed creature's power and toughness sit in a small rounded
 * plate on the frame; a planeswalker's starting loyalty is a shield, larger
 * than the cost badges inside its text box and hanging off the corner of the
 * frame — the number a reader looks for first on that card. Drawing both as
 * `mtg-card__pt` said they were one mark set in two numbers, which is exactly
 * what a reader comparing the two faces would deny. `mtg-card__shield` is the
 * planeswalker's, `../styles/card.ts` gives it `LOYALTY_SHIELD_POINTS`, and the
 * creature's element is unchanged down to its class name so no rule, test or
 * printed face that was reading it had to move.
 */
function statBadge(card: DslCard, stats: FaceStats | undefined): ReactNode {
  if (isCreature(card)) return createElement('span', { className: 'mtg-card__pt' }, sizeText(card, stats));
  if (isPlaneswalker(card)) {
    return createElement('span', { className: 'mtg-card__shield' }, String(card.startingLoyalty));
  }
  return null;
}

/**
 * The foot of an abbreviated face: the corner badge, and a caller's footnote
 * beside it.
 *
 * The collector line used to lead this row and no longer appears on any face at
 * all — `./anatomy.ts`'s `FACE_REGIONS` has the argument and where the words
 * went. What is left is what changes during a game, and `compact` is the one
 * face that still spends a row on it: a deckbuilding thumbnail has no picture
 * for the row to take anything from.
 *
 * On a `board` face the badge has left this row for the card's own corner, so
 * what is left here is the caller's footnote alone — and a permanent with no
 * footnote draws no foot at all, which is the ordinary case and is height the
 * picture gets. `size` is what decides that, so it is a parameter rather than
 * something inferred from the card.
 */
function footRow(
  card: DslCard,
  size: CardSize,
  footnote: string | undefined,
  stats: FaceStats | undefined,
): ReactNode {
  const pt = size === 'board' ? null : statBadge(card, stats);
  if (footnote === undefined && pt === null) return null;
  return createElement(
    'span',
    { className: 'mtg-card__foot', 'data-region': 'footer' },
    footnote === undefined ? null : createElement('span', { className: 'mtg-card__collector' }, footnote),
    pt,
  );
}

/**
 * The full face's corner badge, in the card's own bottom-right corner.
 *
 * Out of flow rather than in a row, which is the whole reason the full face
 * could drop its footer: a badge that costs the column no height cannot be the
 * region the rules box is competing with. It is the same arrangement
 * `cornerCost` uses for the board face's mana cost and the same one a printed
 * card has used since 1993 — the badge overlaps the foot of the text box rather
 * than sitting under it.
 *
 * A sibling of the regions rather than a child of the rules box, and that is
 * load-bearing rather than tidy: inside the box it would be part of the rules
 * text to a screen reader, to a find-in-page, and to the parity suite's reading
 * of what words the card prints.
 */
function cornerStats(card: DslCard, stats: FaceStats | undefined): ReactNode {
  const pt = statBadge(card, stats);
  if (pt === null) return null;
  return createElement('span', { className: 'mtg-card__stats' }, pt);
}

/** A DSL card, rendered. Every kind, every color identity, art or no art. */
export function Card(props: CardProps): ReactElement {
  const { card } = props;
  const size = props.size ?? 'full';
  const art = props.art ?? null;
  const onSelect = props.onSelect;
  // The touch half of the three gestures (`mtg-yg8`, `./press.ts`). Called
  // unconditionally, because a hook must be, and it arms nothing for a face
  // that passed neither callback — the handlers are spread onto the element
  // only where they have something to reach.
  const press = usePressGestures({
    ...(props.onMenu === undefined ? {} : { onMenu: (): void => props.onMenu?.(card) }),
    ...(props.onActivate === undefined ? {} : { onActivate: (): void => props.onActivate?.(card) }),
  });
  // Read once and handed to every region that paints a mana symbol. The rules
  // box and the cost line used to resolve it separately, and only the rules box
  // resolved it at all; see `./ManaPips.ts`.
  const symbols = props.symbols ?? DEFAULT_SYMBOL_SET;

  // The cost shares the title row at the two sizes a card is read at. On a
  // `board` face it has left for the window's corner and the name has the row
  // to itself, which is the whole point of that size (`./anatomy.ts` has the
  // arithmetic); on an `art` tile the row is drawn only when there is no
  // picture, and a cost is not what identifies the card in that state. Both
  // sizes still spell the cost in `faceAccessibleName`, so nobody loses it.
  const costOnTitleRow = size === 'full' || size === 'compact';
  // `data-fit` on the name is the title ladder's step (`./anatomy.ts`,
  // `nameFitStep`), published for the reason the rules box publishes its own: a
  // size resolved by the sheet is something only a browser knows, and a step
  // written into the markup is something jsdom, a proof sheet and the parity
  // suite can all read. It is the card's step and every size takes it — the
  // sheet decides what each face does with it.
  const titleBar = createElement(
    'span',
    { className: 'mtg-card__bar', 'data-region': 'title' },
    createElement('span', { className: 'mtg-card__name', 'data-fit': String(nameFitStep(card)) }, card.name),
    costOnTitleRow && isCastable(card) ? createElement(ManaPips, { cost: card.manaCost, symbols }) : null,
  );

  // A caller's own line for the foot of an abbreviated face: a controller on
  // the battlefield, "in deck" in the sealed builder. It used to displace the
  // collector line and now shares the row with nothing, because that line has
  // left the face.
  const footnote = props.footnote;

  // Three spans rather than one string, because a board face drops the parts of
  // a type line from the right as it narrows and a phrase can only be dropped
  // whole if it is an element. Concatenated they are `renderTypeLine(card)`
  // character for character — `./type-line.ts` keeps the space and the em dash
  // inside the part that would leave without them — so the element's text is
  // still the card's text at every size, and no face but `board` hides any of
  // them.
  const pieces = typeLinePieces(card);
  const typeBar = createElement(
    'span',
    { className: 'mtg-card__bar', 'data-region': 'type' },
    createElement(
      'span',
      { className: 'mtg-card__type', 'data-fit': String(typeFitStep(card)) },
      pieces.supertypes === ''
        ? null
        : createElement('span', { className: 'mtg-card__type-super' }, pieces.supertypes),
      createElement('span', { className: 'mtg-card__type-kind' }, pieces.types),
      pieces.subtypes === ''
        ? null
        : createElement('span', { className: 'mtg-card__type-sub' }, pieces.subtypes),
    ),
    raritySeal(card.set, card.rarity),
  );

  // Which regions a face carries, and in what order, is the specification's
  // call rather than this file's: a region added there appears here. Thunks
  // rather than nodes, so a compact thumbnail never lays out the rules text it
  // is about to drop — the battlefield re-renders on every kernel decision.
  const regions: Readonly<Record<FaceRegion, () => ReactNode>> = {
    title: () => titleBar,
    // The two overlays the window carries are chosen by size rather than
    // combined, because they answer different sizes' questions: a board face
    // needs its cost where no text can be under it, and a tile needs the one
    // fact its missing regions used to carry.
    art: () =>
      createElement(ArtSlot, {
        art,
        subject: card.id,
        ...(size === 'board'
          ? {
              overlay: createElement(
                Fragment,
                null,
                cornerCost(card, symbols),
                cornerStats(card, props.stats),
              ),
            }
          : {}),
        ...(size === 'art' ? { overlay: landPip(card, symbols) } : {}),
      }),
    type: () => typeBar,
    rules: () => textBox(card, symbols, size),
    footer: () => footRow(card, size, footnote, props.stats),
  };
  // The corner badge is what the full face has instead of a footer region, and
  // it is appended rather than laid out: it takes the column no height, which is
  // the whole reason that face could give the bar's space to its rules box.
  //
  // The board face takes it out of flow too, and for the same arithmetic one
  // size down. the playtester, 2026-08-14: "its art is all smushed". Measured over
  // `../../tools/hand-scale.ts`, a creature's foot row was about 15px of a
  // 115.4px face at 1280x800 and the picture was the region paying for it, so
  // the badge left the flow and `footRow` is left with the caller's footnote —
  // which almost no permanent has. `./anatomy.ts`'s `BOARD_REGIONS` carries the
  // trade. `compact` keeps its foot, because it has no picture to protect and
  // its rows are all it has.
  //
  // **Where it goes out of flow to is not the same on the two faces**
  // (`mtg-kcv2`). On the full face it sits over the card's own bottom-right
  // corner, and measured there it collides with nothing: ten full faces at
  // 214px, a 12/12 on every creature, zero pairs. On a board face the same
  // corner is the foot of a three-line rules box, and the badge is opaque, so it
  // painted over the words — 20 pairs at four permanents a side and 1280x800,
  // 69 at sixteen and 1440x900. It joins the cost inside the art window instead,
  // which is the answer this face already gives for the cost and for the same
  // stated reason: the window is `overflow: hidden`, so a badge there is clipped
  // by the picture rather than drawn on the text below it, and it still costs
  // the column no height. `../styles/card.ts` places it.
  const body: ReactNode[] = [
    ...REGIONS_BY_SIZE[size].map((region) => regions[region]()),
    ...(size === 'full' ? [cornerStats(card, props.stats)] : []),
  ];

  // The face root publishes the specification's whole vocabulary, not a subset
  // this component happened to need: the printed face writes the same record,
  // and a fact one face keeps to itself is a fact the two can drift on. The
  // three that follow are this medium's own, and ADR-0002 §2.2 says why.
  const treatment = frameTreatment(card);
  // Which face widths this card's type line gives a part up at (`mtg-mq81`).
  // Published at every size for the reason the whole record is: a fact one face
  // keeps to itself is a fact the two can drift on. Only the board face's rules
  // read them, and an absent part publishes no attribute at all rather than a
  // rung no rule should ever fire at. `./type-line.ts` is the ladder and the
  // argument for it.
  const bands = typeBands(card);
  const shared = {
    className: 'mtg-card',
    ...faceAttributes(card, treatment),
    ...(bands.subtypes === null ? {} : { 'data-type-sub': bands.subtypes }),
    ...(bands.supertypes === null ? {} : { 'data-type-super': bands.supertypes }),
    'data-type-hide': bands.hidden,
    'data-size': size,
    'data-selected': props.selected === true,
    'data-interactive': onSelect !== undefined,
    // The face states its own name rather than leaving one to be concatenated
    // out of its regions and their labels; `faceAccessibleName` is both the
    // decision and the argument for it.
    'aria-label': faceAccessibleName(card, props.stats),
    // Every size, including `full`, which used to be the exception because it
    // printed both the rules box and the collector line and so owed nothing.
    // It prints the box and no longer prints the line, so it takes the detail
    // text too; `faceDetailText` has the trade that buys.
    title: faceDetailText(card),
  };

  // The inert face is a `group` rather than a bare `div`, because a name needs
  // something to attach to: a generic element is dropped from the accessibility
  // tree whatever it is labeled, so the gallery and the deck builder published
  // loose runs of text where a card should have been. A button already has a
  // role, and takes the same name.
  //
  // And it takes a pointer's focus, which is the whole of what makes it
  // readable on a phone. `../styles/card.ts`'s coarse arm reveals the zoom
  // panel on `:focus-within` and suppresses the hover, because on a touch
  // screen `:hover` means "last pressed" rather than "pointing at" — so a face
  // that cannot be focused answers a tap with nothing. That is most of the
  // cards on a played table most of the time: an opponent's permanents,
  // anything with no legal move, and every card on the board while the game is
  // paused. Measured in chrome-headless-shell at 844x390 with a real emulated
  // tap: zero panels before this attribute, one after it.
  //
  // `-1` rather than `0` on purpose. A pointer press focuses either one in
  // Chrome, and that is the gesture being served; `0` would additionally put
  // every card on the table into the tab order, which is a keyboard cost paid
  // for a touch fix. The keyboard already reaches a card that has a move,
  // because that face is a button.
  if (onSelect === undefined)
    return createElement('div', { ...shared, role: 'group', tabIndex: -1 }, ...body);
  const onActivate = props.onActivate;
  const onMenu = props.onMenu;
  return createElement(
    'button',
    {
      ...shared,
      type: 'button',
      autoFocus: props.autoFocus === true,
      'aria-pressed': props.selected === true,
      // The touch stream, wired whenever either gesture has somewhere to go.
      // One recognizer over `pointer*` rather than a `touch*` branch beside the
      // mouse's: `./press.ts` argues that, and refuses to arm for a mouse so the
      // two handlers below keep the pointer model whole.
      ...(onMenu === undefined && onActivate === undefined
        ? {}
        : {
            onPointerDown: press.onPointerDown,
            onPointerMove: press.onPointerMove,
            onPointerUp: press.onPointerUp,
            onPointerCancel: press.onPointerCancel,
          }),
      onClick: (event: ClickGestureEvent): void => {
        // A click a gesture already answered is spent. A long press opened the
        // menu on the way down and the release must not then select the card
        // under it; a repeat press played the default move and the release must
        // not then close the panel. Same refusal as the `detail >= 2` guard
        // below, arriving from the other input model.
        if (press.consumeClick()) return;
        // The second press of a double click is not a second instruction.
        //
        // Measured in chrome-headless-shell 151.0.7922.47: a real double click
        // on a button delivers `click` with `detail: 1`, `click` with
        // `detail: 2`, then `dblclick`. So a face wired for both gestures would
        // hear the first click, act, and then hear a second click against
        // whatever the board became — on the played table that is a hand that
        // has already re-flowed, and the card that slid into the gap is not the
        // card anybody pointed at. Dropping the repeat is the whole fix, and it
        // needs no timer swallowing the ordinary single click.
        //
        // Only where a double click means something. A face with no
        // `onActivate` has no second gesture to protect, so two quick clicks
        // there stay two clicks.
        if (onActivate !== undefined && event.detail >= 2) return;
        onSelect(card);
      },
      // Each handler is omitted rather than wired to a no-op when its prop is
      // absent, so a face outside the played table carries exactly the handlers
      // it always did and nothing on it swallows a browser menu.
      ...(onActivate === undefined
        ? {}
        : {
            onDoubleClick: (): void => {
              onActivate(card);
            },
          }),
      ...(onMenu === undefined
        ? {}
        : {
            onContextMenu: (event: GestureEvent): void => {
              // The browser's menu and this card's menu are two answers to one
              // gesture, and the page's is the one that knows what the card can
              // do.
              event.preventDefault();
              onMenu(card);
            },
            onKeyDown: (event: KeyGestureEvent): void => {
              if (!isMenuKey(event)) return;
              // `Shift+F10` is a browser binding too, and F10 alone reaches the
              // menu bar on some hosts; the card's menu is what was asked for.
              event.preventDefault();
              onMenu(card);
            },
          }),
    },
    ...body,
  );
}
