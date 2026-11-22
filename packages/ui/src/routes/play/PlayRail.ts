/**
 * The side rail, as three sections rather than one: the stack, an inspected
 * card, and the history.
 *
 * `mtg-aqxi.2`. The rail was `../../log/GameLog.ts` and nothing else, so of the
 * three questions a player asks in the middle of a decision it answered one.
 * "What is about to resolve" is answered by the strip on the seam, which spends
 * width and ellipsizes each name to stay one row deep; "what does this card
 * actually say" is answered by covering the board with a zoom. Both of those are
 * the thing `mtg-aqxi` exists to stop, and this column has height nobody is
 * spending: measured before this change at 710.2 / 742.2 / 842.2px of rail at
 * 1024x768 / 1280x800 / 1440x900 (`../../styles/board/rail.ts`), all of it the
 * log's, of which an 89-line log painted two to three lines.
 *
 * # Built on `ContextRail`, which is why this file is short
 *
 * `../../panel/ContextRail.ts` already owns the furniture — the buttons and why
 * they are buttons rather than `role="tab"`, the ids, the pinned foot, and the
 * rule that an empty section draws a sentence instead of disappearing. Its
 * docblock named this surface as the second consumer before there was one. What
 * is left here is what the *played table* puts in the sections, which is this
 * file and nothing else.
 *
 * # The stack is drawn twice and announced once
 *
 * `../../board/StackZone.ts`'s strip stays. It is the at-a-glance stack, it is
 * measured, and it is complete: one labeled group in resolution order, each entry
 * naming its controller and what it is aimed at, with the resolve control on the
 * top entry, which is the one entry that can resolve. A second list here with the
 * same contents would be read as a second stack, which is the hazard the bead
 * names outright.
 *
 * So the copy in this rail is `aria-hidden`, on the same argument
 * `../../card/ZoomPanel.ts` is: it carries no control of its own, states no fact
 * the strip does not already carry, and exists because the strip is one row deep
 * and this column is not. A player with a deep stack reads it here without
 * hovering seven ellipses; a player with a screen reader reads the strip, once,
 * and `STACK_ELSEWHERE` is the sentence that says where.
 *
 * That is also why nothing in the rail's stack is a button. The moment one is,
 * this stops being a second drawing of one list and becomes a second door to a
 * move, and the rule `../../board/StackZone.ts` states — a second door to one
 * index, never a second list — would have to be argued again here.
 *
 * # INFO is empty on purpose
 *
 * `mtg-aqxi.1` is the card detail that fills it. The section exists now because
 * a control that appears when its subject does moves every control beside it,
 * which is the rule `ContextRail` was written around; the sentence it draws is
 * the draft rail's, one surface over, for the same reason.
 */
import { createElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { formatManaCost, isCastable } from '@mtg/dsl';
import type { PlayerId } from '@mtg/kernel';
import type { GameEvent } from '@mtg/kernel';
import { ContextRail } from '../../panel/ContextRail';
import type { RailSection } from '../../panel/ContextRail';
import type { StackItem } from '../../board/StackZone';
import { Card } from '../../card/Card';
import type { InspectedCard } from './inspect';
import { GameLog } from '../../log/GameLog';
import { useLogOpen } from './log-open';
import type { LogNames } from '../../log/narrate';

/** Names the whole rail, and how a test finds the column. */
export const PLAY_RAIL_LABEL = 'Game context';

export const STACK_TAB = 'Stack';
export const INFO_TAB = 'Info';
export const LOG_TAB = 'Log';

/** What the stack section says when the stack is empty, which is most of a game. */
export const STACK_EMPTY = 'Nothing is on the stack.';

/** Where the spoken copy of this list is, said once, above the drawn one. */
export const STACK_ELSEWHERE = 'Also on the board, between the seats, where it can be resolved.';

/** What the info section says before a card has been touched. */
export const INFO_EMPTY = 'Choose a card on the table to read it here.';

export interface PlayRailProps {
  /** The stack, bottom-first, exactly as `../../board/StackZone.ts` takes it. */
  readonly entries: readonly StackItem[];
  readonly events: readonly GameEvent[];
  readonly names: LogNames;
  readonly viewer: PlayerId;
  /**
   * The card being read, or `null` before one has been touched (`mtg-aqxi.1`).
   *
   * A record rather than a card, because a permanent's current size is part of
   * what is being read; `./inspect.ts` says why it may not fall back to print.
   */
  readonly inspected?: InspectedCard | null;
  /**
   * A card the surface wants read, named by its key.
   *
   * The rail shows INFO when this *changes*, which is not the same as being
   * told to stay there: a player who taps a card and then presses LOG has said
   * something, and a lock would answer by putting the card back. A coarse
   * pointer is the caller that passes it, because there the tap is the whole
   * gesture and a card arriving in a section nobody is looking at is a tap that
   * answered with nothing. A fine pointer passes nothing and the column stays
   * where the player put it: the hover zoom has already answered, and moving the
   * rail out from under them would be the surface inferring intent it was not
   * given.
   */
  readonly reveal?: string | null;
  /**
   * Where the log says which objects a line names (`./pointing.ts`, `mtg-47o`).
   *
   * A pass-through: the rail decides nothing about pointing, and passing nothing
   * leaves the log the plain list of sentences it was, which is what a surface
   * with no board beside it wants.
   */
  readonly onPoint?: (objects: readonly string[] | null) => void;
}

export interface PlayContextRailProps {
  /** The stack, bottom-first, exactly as `../../board/StackZone.ts` takes it. */
  readonly entries: readonly StackItem[];
  readonly history: ReactNode;
  readonly inspected?: InspectedCard | null;
  readonly reveal?: string | null;
}

/**
 * One entry, at the depth a column can afford: what it is, whose it is, what it
 * costs, and what it is aimed at, each on its own line rather than ellipsized
 * into the one row the strip has.
 *
 * `order` counts down from the top of the stack, matching the strip's numbering
 * and the reticles `../../board/Battlefield.ts` paints, so the two drawings of
 * one stack cannot disagree about which entry is which.
 */
function entryNode(entry: StackItem, order: number): ReactElement {
  // An activation is not paid with the source's mana cost and a land has none,
  // so both draw no cost rather than a wrong one. This is the same pair
  // `../../board/StackZone.ts` handles on the strip, for the same reason.
  const cost = entry.ability === true || !isCastable(entry.card) ? null : formatManaCost(entry.card.manaCost);
  return createElement(
    'li',
    { key: entry.key, className: 'mtg-rail-stack__entry' },
    createElement('span', { className: 'mtg-rail-stack__order' }, String(order)),
    createElement(
      'div',
      { className: 'mtg-rail-stack__body' },
      createElement('span', { className: 'mtg-rail-stack__name' }, entry.card.name),
      createElement(
        'span',
        { className: 'mtg-rail-stack__meta' },
        entry.ability === true ? `${entry.controller}'s ability` : entry.controller,
        cost === null || cost === '' ? null : ` · ${cost}`,
      ),
      // The chosen mode reads as its own line rather than as a clause of the
      // aim, for `StackZone`'s reason: a modal spell with a target says two
      // things, and this rail has the height to print both.
      entry.modeLabel === undefined
        ? null
        : createElement('span', { className: 'mtg-rail-stack__mode' }, entry.modeLabel),
      entry.targetLabel === undefined
        ? null
        : createElement('span', { className: 'mtg-rail-stack__target' }, `Aimed at ${entry.targetLabel}`),
    ),
  );
}

function stackSection(entries: readonly StackItem[]): RailSection {
  const top = entries.length;
  return {
    name: STACK_TAB,
    count: top,
    empty: STACK_EMPTY,
    render: (): ReactNode =>
      top === 0
        ? null
        : createElement(
            'div',
            { className: 'mtg-rail-stack-block' },
            createElement('p', { className: 'mtg-rail-stack__note' }, STACK_ELSEWHERE),
            createElement(
              'ol',
              // Hidden from the accessible tree, not from the page: the strip on
              // the seam is the announced copy and this one adds no fact to it.
              // The docblock above carries the argument and the condition it
              // rests on, which is that nothing in here is a control.
              { className: 'mtg-rail-stack', 'aria-hidden': true },
              ...entries.map((entry, index) => entryNode(entry, top - index)).reverse(),
            ),
          ),
  };
}

export function PlayContextRail(props: PlayContextRailProps): ReactElement {
  // The last key the surface asked to have read, so a *change* is the signal and
  // a steady value is not. Adjusting state during render rather than in an
  // effect is React's own answer for a prop-derived reset, and it is the right
  // one here: an effect would paint the old section for one frame, which on the
  // surface this exists for is a tap that visibly answers with the log first.
  // Deliberately null rather than the reveal this rail mounted with, so the
  // first tap of a session is a change and opens Info. Seeding it from the prop
  // made the opening tap the one tap the rail ignored.
  const [revealed, setRevealed] = useState<string | null>(null);
  // The log to begin with, because that is what this rail was before it had tabs
  // and a player who never touches the controls should find the column unchanged.
  const [section, setSection] = useState(LOG_TAB);
  // The log's disclosure outlives the game, so the rail resolves it and the log
  // draws it. `./log-open.ts` says why it is kept and what opening by default
  // costs.
  const asked = props.reveal ?? null;
  if (asked !== null && asked !== revealed) {
    setRevealed(asked);
    setSection(INFO_TAB);
  }
  const inspected = props.inspected ?? null;
  const sections: readonly RailSection[] = [
    stackSection(props.entries),
    {
      name: INFO_TAB,
      empty: INFO_EMPTY,
      // The face every other surface draws, at the size the draft rail reads its
      // chosen card at (`../draft/DraftPack.ts`, `mtg-aqxi.12`): `full` is the
      // one that goes back to step 0 of the fit ladder, which is what makes this
      // a read rather than a smaller copy of the card already on the table.
      render: (): ReactNode =>
        inspected === null || inspected === undefined
          ? null
          : createElement(Card, {
              key: inspected.key,
              card: inspected.card,
              art: inspected.art,
              size: 'full',
              ...(inspected.stats === undefined ? {} : { stats: inspected.stats }),
            }),
    },
    {
      name: LOG_TAB,
      render: (): ReactNode => props.history,
    },
  ];
  return createElement(ContextRail, {
    label: PLAY_RAIL_LABEL,
    className: 'mtg-rail--play',
    sections,
    active: section,
    onSelect: setSection,
  });
}

export function PlayRail(props: PlayRailProps): ReactElement {
  const disclosure = useLogOpen();
  return createElement(PlayContextRail, {
    entries: props.entries,
    ...(props.inspected === undefined ? {} : { inspected: props.inspected }),
    ...(props.reveal === undefined ? {} : { reveal: props.reveal }),
    history: createElement(GameLog, {
      events: props.events,
      names: props.names,
      viewer: props.viewer,
      disclosure,
      ...(props.onPoint === undefined ? {} : { onPoint: props.onPoint }),
    }),
  });
}
