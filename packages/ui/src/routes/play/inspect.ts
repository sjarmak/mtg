/**
 * Which card is being read, as a key and a lookup rather than as an overlay.
 *
 * `mtg-aqxi.1`. Reading a card on this table was `../../card/ZoomPanel.ts` and
 * nothing else: a `position: fixed` panel over the board, revealed by hover on a
 * mouse and, since 2026-08-22, by focus on a finger. The finger arm is the
 * problem the epic is about. A phone in landscape is about 390px tall and the
 * panel is a full face at 20rem, so a routine read covers the board with the one
 * card being read, and the player loses the thing they were reading it *against*
 * — which is the whole reason to read it mid-combat.
 *
 * So the card goes in the rail's INFO section, beside the board rather than over
 * it, and this file is the two halves that makes that possible without a fifth
 * card renderer:
 *
 *  1. `inspectedKey` reads which slot a focus landed inside. One delegated
 *     handler on the play surface rather than a prop threaded through the
 *     battlefield, the hand and two piles: focus bubbles, every slot already
 *     writes `data-permanent-key` (`../../board/CardSlot.ts`), and a prop on
 *     four zones would be four chances for one of them to be forgotten. It is
 *     also why this works for a card with no legal move — that face is a `div`
 *     with `tabIndex={-1}`, which a press focuses, which is the fix 4d4a2925
 *     landed for the zoom and is inherited here rather than re-argued.
 *  2. `findInspected` turns that key into the card, which the projection
 *     (`./position.ts`) already built. Nothing here reads the kernel, derives a
 *     name or judges a legality; a key that names nothing on the table is
 *     `null`, never a guess.
 *
 * # The stack is covered too, and it took a bead to see why (`mtg-mis1`)
 *
 * This file used to end by arguing the opposite: a stack entry is not a slot,
 * the rail's STACK section already answers "what is about to resolve", and two
 * sections answering one question in one column is a worse column. What that
 * missed is that the two questions are different. STACK says *what is on the
 * stack and in what order* — a list, drawn `aria-hidden` beside the strip that
 * announces it, with no control anywhere in it. INFO says *what this card
 * does*, at full size, which for the spell that is about to resolve is the
 * question a player has mid-combat and could not ask: `mtg-nxh` found the
 * gesture row "tap a stack object inspects the spell or ability" reaching
 * nothing at all, on either input model.
 *
 * So a stack entry carries `data-permanent-key` like every other readable card
 * on this table, and `findInspected` looks in the stack after both seats. No new
 * plumbing and no fifth renderer: the one delegated handler above already turns
 * a press into a focus into a key, which is the whole point of it being
 * delegated. What the lookup returns for an activated ability is the permanent
 * it was printed on (CR 113.7a), which is what the strip draws for it and the
 * only card there is to show.
 */
import { useCallback, useRef, useState } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import type { CardArt } from '../../card/ArtSlot';
import type { BoardProps, BoardSide } from '../../board/Board';
import type { StackItem } from '../../board/StackZone';
import type { FaceStats } from '../../card/Card';

/** The attribute every card slot on this table already writes. */
export const SLOT_KEY_ATTRIBUTE = 'data-permanent-key';

export interface InspectedCard {
  readonly key: string;
  readonly card: DslCard;
  readonly art: CardArt | null;
  /**
   * The permanent's current size, when it has one.
   *
   * Taken from the projection rather than off the printed card, which is the
   * rule `../../card/ZoomPanel.ts` states and is the reason this lookup returns
   * a record instead of a card: a detail channel that reverts to the print
   * disagrees with the thing it is a detail of, and this is where a player
   * checks a creature before deciding a block.
   */
  readonly stats?: FaceStats;
}

/** The shape this file needs off a focus target; the workspace has no `lib: dom`. */
interface TargetLike {
  readonly closest: (selector: string) => AttributedLike | null;
}

interface AttributedLike {
  readonly getAttribute: (name: string) => string | null;
}

/**
 * The key of the slot a focus landed inside, or `null` when it landed elsewhere.
 *
 * `closest` rather than a check on the target itself, because the focusable
 * element is the button *inside* the slot whenever the card has a move to make
 * and is the slot itself when it does not.
 */
export function inspectedKey(target: unknown): string | null {
  if (target === null || target === undefined) return null;
  const slot = (target as TargetLike).closest(`[${SLOT_KEY_ATTRIBUTE}]`);
  return slot === null ? null : slot.getAttribute(SLOT_KEY_ATTRIBUTE);
}

function fromSide(side: BoardSide, key: string): InspectedCard | null {
  for (const permanent of side.battlefield.permanents) {
    if (permanent.key !== key) continue;
    return {
      key,
      card: permanent.card,
      art: permanent.art ?? null,
      ...(permanent.stats === undefined ? {} : { stats: permanent.stats }),
    };
  }
  // The three zones that hold a card rather than a permanent, which are the same
  // shape as each other (`../../board/ZoneBrowser.ts`'s `BrowserCard`) and carry
  // no size: a card in a pile or in hand is a card again, so the printed numbers
  // are the true ones and passing none is what says so.
  for (const zone of [side.hand, side.graveyard, side.exile]) {
    for (const entry of zone?.cards ?? []) {
      if (entry.key === key) return { key, card: entry.card, art: entry.art ?? null };
    }
  }
  return null;
}

/**
 * An object on the stack, which is a card again for reading purposes: no size,
 * for `fromSide`'s reason about a pile. An entry for an activated ability
 * carries the permanent it was printed on, so this returns that card and says
 * nothing about the ability, which is all there is to say (CR 113.7a).
 */
function fromStack(entries: readonly StackItem[], key: string): InspectedCard | null {
  for (const entry of entries) {
    if (entry.key === key) return { key, card: entry.card, art: entry.art ?? null };
  }
  return null;
}

/**
 * The card a key names, looked up in the projection the board is already drawn
 * from.
 *
 * The stack is searched last, after both seats, because a key that names a
 * permanent should read as that permanent whatever else is in flight.
 */
export function findInspected(position: BoardProps, key: string | null): InspectedCard | null {
  if (key === null) return null;
  return (
    fromSide(position.you, key) ?? fromSide(position.opponent, key) ?? fromStack(position.stack.entries, key)
  );
}

export interface Inspection {
  readonly key: string | null;
  /** Changes on every explicit context-menu inspection, even for the same card. */
  readonly reveal: string | null;
  /** Delegated: hung on the play surface once, and reads its own target. */
  readonly onFocus: (event: { readonly target: unknown }) => void;
  /** Delegated explicit inspection; used by controls such as the stack-card name. */
  readonly onInspect: (event: { readonly target: unknown }) => void;
  /** Delegated right-click inspection; the browser menu is replaced by the card reader. */
  readonly onContextMenu: (event: { readonly target: unknown; preventDefault: () => void }) => void;
}

/**
 * The inspected key, kept current by whatever the player last focused.
 *
 * A focus that lands outside every slot leaves the last card in the rail rather
 * than clearing it. That is deliberate: pressing a move in the ask column, or
 * the tab in the rail that shows the card, both move focus off the table, and a
 * panel that emptied itself the moment you reached for it would be a panel you
 * could never read.
 */
export function useInspection(): Inspection {
  const [key, setKey] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const revealSequence = useRef(0);
  const onFocus = useCallback((event: { readonly target: unknown }): void => {
    const found = inspectedKey(event.target);
    if (found !== null) setKey(found);
  }, []);
  const revealTarget = useCallback((target: unknown): void => {
    const found = inspectedKey(target);
    if (found === null) return;
    setKey(found);
    revealSequence.current += 1;
    setReveal(`${found}:${String(revealSequence.current)}`);
  }, []);
  const onInspect = useCallback(
    (event: { readonly target: unknown }): void => {
      revealTarget(event.target);
    },
    [revealTarget],
  );
  const onContextMenu = useCallback(
    (event: { readonly target: unknown; preventDefault: () => void }): void => {
      if (inspectedKey(event.target) === null) return;
      event.preventDefault();
      revealTarget(event.target);
    },
    [revealTarget],
  );
  return { key, reveal, onFocus, onInspect, onContextMenu };
}
