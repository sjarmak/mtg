/**
 * The turn indicator, the bar it now rides on, and the dealer's strip.
 *
 * **`mtg-rgc.13` put the turn text on the bar.** Magic Online writes
 * `Turn 18: BswizzM…` at the left-hand end of the step bar and says nothing
 * about the turn anywhere else; all three captures in `references/` are that one
 * row. Ours drew the bar under the near battlefield (`mtg-rgc.6`) and the badge
 * two columns away at the head of the ask, which is one fact in two places on a
 * screen whose whole problem is that there are too many places.
 *
 * **The disclosure lives on the bar and only on the bar**, which is what makes
 * the panel's geometry one case rather than three. The badge is not a label — it
 * is the head of the auto-pass disclosure (`mtg-6ce`, `TurnStops.ts`) and the
 * panel is anchored to it, so where the head goes the panel follows, and
 * `styles/views.ts` argues where that panel opens now that the head sits between
 * a battlefield and a hand. A caller that owns no settings gets no bar, and a
 * finished game gets no bar either (`mtg-a1d6`); both of those keep a plain
 * badge in game details, where the turn and the step are a fact rather than a
 * control. `playDetails` is *told* which of the two it is drawing rather than
 * re-deriving it, because `PlayView` is the one place that knows whether the bar
 * was built.
 *
 * What is left above the table is the dealer's strip, and only the dealer's:
 * a seed, a reshuffle, a way back to deckbuilding (`precon-strip.ts`). One strip
 * rather than two rows — a second row is a whole card's worth of height on a
 * screen that has to hold two boards, two hands and every legal move at once
 * (`mtg-bc2.128`) — and a caller that deals nothing draws no strip at all.
 *
 * The bar and the disclosure both need `autoPass` and `onAutoPass` before they
 * can be drawn at all, because a set of controls nobody is listening to would be
 * a screen that lies about what it controls. The disclosure needs `onYield` as
 * well, since half of what is left in its panel is the two yields — a caller
 * with settings but no yield gets the turn text on the bar as a plain badge,
 * rather than a disclosure with one dead half. The beat toggle answers to the
 * same rule one level down: it is drawn only for a caller that passes `onBeats`,
 * which `@mtg/netplay` deliberately does not.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { AutoPassSettings, BeatSet, Step, YieldBoundary } from '@mtg/kernel';
import { PhaseBar } from './PhaseBar';
import { TurnStops } from './TurnStops';

/**
 * What the step bar needs: where the game is, whose turn it is, and what it may
 * stop for.
 *
 * The turn text joined this input in `mtg-rgc.13` rather than reaching the bar
 * through `PlayView`, because the head and the nodes write the same
 * `AutoPassSettings` and a control whose two halves were composed in two files
 * is a control neither file describes.
 */
export interface StepBarInput {
  /** Where the game is, so the bar can mark the node it is in. */
  readonly step: Step;
  /** The turn and whose it is; `prompt.ts`'s `describeTurn` writes it. */
  readonly turnText: string;
  /** The whole sentence including the step, which stays in the badge's name. */
  readonly stepText: string;
  readonly autoPass?: AutoPassSettings | undefined;
  readonly onAutoPass?: ((next: AutoPassSettings) => void) | undefined;
  /** A yield is a run of passes, so it needs a pass to start from. */
  readonly canYield: boolean;
  readonly onYield?: ((boundary: YieldBoundary) => void) | undefined;
  /** Which combat moments the game pauses at, and how to change them. */
  readonly beats?: BeatSet | undefined;
  readonly onBeats?: ((next: BeatSet) => void) | undefined;
}

/** What game details draw beside the ask, once the turn text has left them. */
export interface PlayDetailsInput {
  /**
   * The whole sentence, step included, drawn only when no bar is carrying the
   * turn.
   *
   * The fuller sentence rather than `turnText` on purpose: this is the fallback,
   * and a fallback that dropped the step would leave a finished game and a
   * settings-less caller with less than either had before the turn text moved.
   */
  readonly stepText: string;
  /** How many choices the player has made, which is the game's own odometer. */
  readonly choicesMade: number;
  /** Whether the step bar is drawn, which is where the turn text lives when it is. */
  readonly stepsDrawn: boolean;
}

/**
 * The step bar with the turn at its left-hand end, or nothing for a caller that
 * owns no stop set.
 *
 * Null rather than a bar of thirteen inert nodes: the rule is the one this file
 * has always applied to the disclosure, and it is what keeps a replay frame and
 * a read-only render of `PlayView` from drawing a control that answers to
 * nobody.
 */
export function stepBar(input: StepBarInput): ReactElement | null {
  const settings = input.autoPass ?? null;
  const { onAutoPass, onYield } = input;
  if (settings === null || onAutoPass === undefined) return null;
  const head =
    onYield === undefined
      ? createElement('span', { className: 'mtg-badge' }, input.turnText)
      : createElement(TurnStops, {
          label: input.turnText,
          detail: input.stepText,
          settings,
          onChange: onAutoPass,
          canYield: input.canYield,
          onYield,
        });
  return createElement(PhaseBar, {
    settings,
    onChange: onAutoPass,
    step: input.step,
    head,
    ...(input.beats === undefined ? {} : { beats: input.beats }),
    ...(input.onBeats === undefined ? {} : { onBeats: input.onBeats }),
  });
}

/**
 * The odometer, and the turn badge on the two renders that have no bar.
 *
 * The odometer stayed here when the turn text left (`mtg-rgc.13`). It is the
 * game's own record — seed plus the choice list is the whole of a kernel game
 * (`packages/engine/src/determinism.ts`) — and this column is where the choices
 * are made, so the count sits beside the thing it counts. It also costs the
 * cards nothing: the ask column spends the width axis, which is the axis this
 * table is not short of, and the bar spends the height axis, which is the one it
 * is.
 */
export function playDetails(input: PlayDetailsInput): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-play-meta' },
    input.stepsDrawn ? null : createElement('span', { className: 'mtg-badge' }, input.stepText),
    createElement('span', { className: 'mtg-page-note' }, `${String(input.choicesMade)} choices made`),
  );
}

/** Dealer-owned controls remain above the table; routine game metadata does not. */
export function playToolbar(extra: ReactNode): ReactElement | null {
  return extra === undefined || extra === null
    ? null
    : createElement('div', { className: 'mtg-toolbar' }, extra);
}
