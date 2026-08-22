/**
 * The side panel's open state: where it lives, what holds it open, and the one
 * control that changes it.
 *
 * The playtester, 2026-08-14: "I want the side panel to be expandable and collapsible
 * so we can regain more of the gameboard space". The side panel is the right-hand
 * rail, which since `mtg-rgc.7` is the game log and nothing else, and it is the
 * column worth collapsing because it is the only one on the table holding
 * *reference* material. The pod column two tracks over holds the current ask,
 * which is the thing a player is deciding from, and `mtg-euc` says that column is
 * already short of room rather than long of it.
 *
 * # Why a preference and not game state
 *
 * The played surface's whole record is a seed plus a list of chosen indices
 * (`@mtg/kernel`'s `replaySession`), so anything that enters `choices` or
 * `GameState` changes what a replay is. Whether a panel is open is not a move.
 * It is not a `SessionOptions` field either — that is where the *stop set* and
 * the combat pause live, because those change what the kernel asks, and this
 * changes nothing the kernel can see. So it is view state, held by the view, and
 * written to `localStorage` so it outlives a reload the way a player expects a
 * panel they shut to stay shut.
 *
 * The storage is reached through a structural interface and runtime-checked,
 * because the workspace tsconfig has no `lib: dom` (`../../app/mount.ts` records
 * why) — and because a page in a private window can *throw* from
 * `localStorage.setItem` rather than merely returning nothing. A store that
 * cannot be read or written is not an error worth surfacing: the panel simply
 * opens the way it always did, which is the state a first-ever visit is in.
 *
 * # Nothing holds it open any more
 *
 * A non-empty stack used to. The argument was that the stack is where a spell you
 * may respond to lives and a player who cannot see what is about to resolve
 * cannot decide whether to answer it, so while the stack held anything the panel
 * was forced open and the control that would shut it was disabled with the reason
 * beside it. Every word of that is still true and none of it is this column's
 * problem: `mtg-rgc.7` moved the stack onto the seam between the seats
 * (`../../styles/board/stack.ts`), where it is drawn whether this panel is open,
 * shut, or collapsed to a 44px strip. A panel forced open to reveal something
 * that is no longer in it would have been taking the board's width for nothing.
 *
 * So the hook has one input, the player's own preference, and the disclosure has
 * no disabled state and no note under it. That also settles the sentence this
 * docblock used to end with — that the board reflowed rather than the stack
 * drawing over it, left as `mtg-bc2.138`'s second lever. It is built, and it is
 * built without the occlusion Arena's own 2025.47.00 patch had to fix: the strip
 * sits in a band of the seam that was measured to hold no click target at any
 * viewport, and `../../../test/play/stack-seam.browser.test.ts` re-measures it.
 */
import { createElement, useEffect } from 'react';
import type { ReactElement } from 'react';
import { CRAMPED_TABLE_QUERY } from '../../styles/board/geometry';
import { useCollapsePreference } from './collapse-preference';
import type { CollapsePreference } from './collapse-preference';

/**
 * What the control is called, in both states.
 *
 * A disclosure's name says what it discloses and `aria-expanded` says which way
 * it is currently pointing, so the name is stable and the state is not in it —
 * ARIA's own disclosure pattern, and the reason a name like "Collapse side
 * panel" would be wrong is that half the time it would be a lie about what the
 * press will do.
 *
 * "Side panel" rather than "Rail" because it is the word the person who asked
 * for it used, and because `rail` is this codebase's own name for two different
 * columns.
 */
export const SIDE_PANEL_LABEL = 'Side panel';

/**
 * The key that toggles it, and the one design decision in binding a key at all.
 *
 * `b` for board, which is what the press asks for. It is bare rather than
 * modified because every other shortcut on this route is (`./pass-key.ts` takes
 * Space and Enter, `./dismiss.ts` takes Escape), and it is checked against those
 * three plus `../../card/Card.ts`'s ContextMenu and Shift+F10 — no collision.
 */
export const SIDE_PANEL_KEY = 'b';

/** Where the preference is kept, namespaced so it cannot collide with a lane's. */
const STORE_KEY = 'mtg.play.side-panel';

/** The parts of a keyboard event this needs, and nothing else. */
interface KeyPress {
  readonly key: string;
  readonly repeat?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly target?: unknown;
}

interface KeyHost {
  addEventListener(type: 'keydown', handler: (event: KeyPress) => void): void;
  removeEventListener(type: 'keydown', handler: (event: KeyPress) => void): void;
}

/** Elements that answer a bare letter themselves; a shortcut must not steal it. */
const TYPING: readonly string[] = ['INPUT', 'SELECT', 'TEXTAREA'];

function keyHost(): KeyHost | null {
  const host = globalThis as { readonly document?: unknown };
  const document = host.document;
  if (typeof document !== 'object' || document === null) return null;
  const partial = document as Partial<KeyHost>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  return document as KeyHost;
}

/** The shared shape, under this column's own name for the callers that use it. */
export type RailCollapse = CollapsePreference;

/**
 * The preference, the viewport it falls back to, and the key that changes it.
 *
 * The player's answer wins outright wherever there is one. It took a `stackDepth`
 * until `mtg-rgc.7` and derived `collapsed` from both, so that a non-empty stack
 * could force the column open; the stack is drawn on the board now and the
 * override has nothing left to reveal. What replaced it is not an override: the
 * viewport is only consulted when the player has said nothing, which is why the
 * disclosure never has a disabled state and never lies about what a press does.
 *
 * The first press writes, so the fallback stops applying from then on. That is
 * the behavior a person expects of a panel they shut on a phone and then opened
 * again: it stays where they put it.
 */
export function useRailCollapse(): RailCollapse {
  const { collapsed, toggle } = useCollapsePreference(STORE_KEY, CRAMPED_TABLE_QUERY);
  useEffect((): (() => void) | undefined => {
    const host = keyHost();
    if (host === null) return undefined;
    const onKeyDown = (event: KeyPress): void => {
      if (event.key.toLowerCase() !== SIDE_PANEL_KEY) return;
      if (event.repeat === true || event.altKey === true) return;
      if (event.ctrlKey === true || event.metaKey === true) return;
      const target = event.target;
      const tag =
        typeof target === 'object' && target !== null
          ? (target as { readonly tagName?: unknown }).tagName
          : undefined;
      if (typeof tag === 'string' && TYPING.includes(tag.toUpperCase())) return;
      toggle();
    };
    host.addEventListener('keydown', onKeyDown);
    return (): void => {
      host.removeEventListener('keydown', onKeyDown);
    };
  }, [toggle]);
  return { collapsed, toggle };
}

/**
 * The control, drawn at the top of the panel in both states.
 *
 * At the top of the panel rather than in the toolbar, because a disclosure that
 * sits immediately before the thing it discloses needs no `aria-controls` to be
 * followed — the DOM order is the relationship. It is the one child of the rail
 * a shut rail still draws, which is what makes the shut state a strip with a way
 * out rather than a column that has vanished.
 *
 * The chevron is the state and the word is the name, so the word is `aria-hidden`
 * and the button carries the name outright: a shut strip has no room to print
 * "Side panel" and a name that disappeared with the text would leave a screen
 * reader on an unlabeled button exactly when it is the only control in the column.
 */
export function railToggle(state: RailCollapse): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-rail__head' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-rail__toggle',
        'aria-label': SIDE_PANEL_LABEL,
        'aria-expanded': !state.collapsed,
        onClick: state.toggle,
      },
      createElement(
        'span',
        { className: 'mtg-rail__chevron', 'aria-hidden': true },
        state.collapsed ? '‹' : '›',
      ),
      createElement('span', { className: 'mtg-rail__toggle-label', 'aria-hidden': true }, SIDE_PANEL_LABEL),
    ),
  );
}
