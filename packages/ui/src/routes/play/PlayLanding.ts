/**
 * The shape every Play landing has, and the furniture it is built out of.
 *
 * `mtg-a982g.5`. the playtester's report was that the landing looked like a
 * different program per set: Amonkhet offered a bare *Start draft* and no
 * choice of opponent, the Legacy Cube offered *New Legacy Cube draft* under a
 * page title of its own, and the staged set offered the boxed section with the
 * two cells that the rest were supposed to look like. "They should all look
 * like the XMP one basically" is one component rather than three agreements, so
 * the order is fixed here and every landing is drawn through it:
 *
 *   the set's name and what kind of set it is,
 *   the sets this section can play (`./SourceChoice.ts`),
 *   the two ways to play it (`./OpponentChoice.ts`),
 *   the open column's body.
 *
 * Once a game is on, the first two go: page furniture does not belong over a
 * board, which is the rule `playSection` already followed for its heading. The
 * first and the third also go on a landing that states `cells: false`, which is
 * the Commander one, for the reason that prop gives.
 *
 * `./PlayChooser.ts` is this frame with the staged set's bodies in it, and the
 * printed and cube landings are the same frame with theirs.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { OpponentChoice } from './OpponentChoice';
import { SourceChoice } from './SourceChoice';
import type { AvailabilityFacts, Opponent, PlayFormat, SetKind } from './availability';
import type { PlaySource } from './sources';

/** What a set header says when the page knows nothing about which set this is. */
export const PLAY_UNNAMED_SET = 'This set';

/** The set this page is about, named and placed. */
export function playHeader(setName: string | undefined, setLabel: string | undefined): ReactElement | null {
  if (setName === undefined && setLabel === undefined) return null;
  return createElement(
    'div',
    { className: 'mtg-playhead' },
    createElement('h1', { className: 'mtg-playhead__name' }, setName ?? PLAY_UNNAMED_SET),
    setLabel === undefined ? null : createElement('span', { className: 'mtg-playhead__kind' }, setLabel),
  );
}

/**
 * One named part of a landing.
 *
 * `titled` is false once a game is on, and the heading becomes `null` rather
 * than the section becoming its own child: the Decks section holds a component
 * that turns into a live table, and a wrapper that changes shape underneath it
 * is a remount, which is a game thrown away mid-turn. So the element stays and
 * loses its label, which is also what the playtester asked for on its own terms --
 * page furniture does not belong over a board.
 *
 * It gains `data-playing` in the same breath, and that is the layout half of
 * the same fact: `.mtg-play-route` hands its leftover height to one child, and
 * a section that is now a table has to be the one that takes it. Read off an
 * attribute rather than off the missing `aria-label`, because a stylesheet
 * inferring state from the absence of a name is a rule nobody can find later.
 *
 * `boxed` is every landing that offers one press. A set with preconstructed
 * decks draws them as cards and then ends with a label, a line and a button
 * loose on the background; a set that has none, which Magic 2011 is, draws only
 * that, and a 1440px window under it read as a page that had not finished
 * loading.
 */
export interface SectionOptions {
  readonly label: string;
  /** False once a game is on; the section keeps its element and loses its name. */
  readonly titled: boolean;
  /** Drawn as a card at reading width rather than as controls loose on a page. */
  readonly boxed: boolean;
}

export function playSection(
  options: SectionOptions,
  ...body: readonly (ReactElement | null)[]
): ReactElement {
  const { label, titled } = options;
  return createElement(
    'section',
    {
      className: 'mtg-playsection',
      key: label,
      ...(options.boxed ? { 'data-boxed': 'true' } : {}),
      ...(titled ? { 'aria-label': label } : { 'data-playing': 'true' }),
    },
    titled ? createElement('h2', { className: 'mtg-playsection__title' }, label) : null,
    ...body,
  );
}

/** A line of a section's copy. */
export function playBlurb(line: ReactNode): ReactElement {
  return createElement('p', { className: 'mtg-playsection__blurb' }, line);
}

/** One of a section's controls; `primary` is the press the section exists for. */
export function playButton(label: string, variant: string | null, onPress: () => void): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      ...(variant === null ? {} : { 'data-variant': variant }),
      onClick: onPress,
    },
    label,
  );
}

export interface PlayLandingProps {
  /** The set's own name, when the page knows which set it is showing. */
  readonly setName?: string;
  /** What kind of set that is, in the words a person reads: `Custom set`, `Magic set`. */
  readonly setLabel?: string;
  /** Which of the three source kinds this is, for `./availability.ts`. */
  readonly setKind: SetKind;
  /** Which game this page is choosing for: the sub off the hash. */
  readonly format: PlayFormat;
  /** What this section can be played with (`./sources.ts`). */
  readonly sources: readonly PlaySource[];
  /** Which of them is showing, by stem. */
  readonly selected: string | null;
  readonly onSource: (stem: string) => void;
  readonly opponent: Opponent;
  readonly onOpponent: (opponent: Opponent) => void;
  readonly facts: AvailabilityFacts;
  /** True once a game is on: the furniture goes and the body keeps the page. */
  readonly playing: boolean;
  readonly bot: ReactElement | null;
  readonly lan: ReactElement | null;
  /**
   * Whether the two opponent cells and the set's own header are drawn at all;
   * they are unless a landing says otherwise.
   *
   * `mtg-r9vgk`, the playtester 2026-09-17. A landing whose own body carries both
   * presses has no use for the choice above it, and a cell whose column can no
   * longer be opened is a control that does nothing. The Commander landing is
   * the one that says false: its route draws `Play Forge match` and `Play LAN
   * match` side by side in its own head bar
   * (`../printed/PrintedPreconRoute.ts`). It takes the header with it, because
   * the spot the header holds is the spot she asked those presses to move into;
   * the source chips still say which set is showing. Optional because
   * `PlayLandingProps` is public through `../../index.ts`, so the other three
   * landings keep their cells and their header without being edited.
   */
  readonly cells?: boolean;
}

export function PlayLanding(props: PlayLandingProps): ReactElement {
  return createElement(
    Fragment,
    null,
    // `mtg-r9vgk`, the playtester 2026-09-17: "rather than keeping the Starter
    // Commander Decks 2022 ... in the upper left we should move the play forge
    // match, play LAN match and back to commander decks to that spot". The
    // format's name was the thing being displaced, so a landing that states
    // `cells: false` drops the header as well as the cells, and the presses its
    // own body draws are what stands in the upper left. Every other landing
    // still names its set: there the header is the only thing that does.
    props.playing || props.cells === false ? null : playHeader(props.setName, props.setLabel),
    props.playing
      ? null
      : createElement(SourceChoice, {
          sources: props.sources,
          selected: props.selected,
          onSource: props.onSource,
        }),
    // The choice stays mounted while a game is on and only loses its cells, for
    // the reason `playSection` keeps its element: the decks section under it
    // becomes the table, and a wrapper that changes shape underneath it is a
    // remount. A landing that has no cells at all draws its body where the
    // choice would have been, so nothing wraps it either.
    props.cells === false
      ? props.bot
      : createElement(OpponentChoice, {
          setKind: props.setKind,
          format: props.format,
          opponent: props.opponent,
          onOpponent: props.onOpponent,
          facts: props.facts,
          playing: props.playing,
          bot: props.bot,
          lan: props.lan,
        }),
  );
}
