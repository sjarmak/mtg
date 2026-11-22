// @vitest-environment jsdom
/**
 * Reading the spell that is about to resolve.
 *
 * `mtg-mis1`. `mtg-nxh` audited the gesture row and found "tap a stack object
 * inspects the spell or ability" reaching nothing at all: the strip drew its
 * entries with no handler and no focusable element on either input model, so the
 * one object in the game whose text a player most needs mid-combat was the one
 * object they could not open.
 *
 * The fix is deliberately not a new channel. Every readable card on this table
 * writes `data-permanent-key` and the play surface hangs one delegated focus
 * handler over the lot (`src/routes/play/inspect.ts`), so the entry joins that
 * mechanism instead of growing a second: it carries the key and `tabIndex: -1`,
 * a press focuses it, and the rail's Info section draws the full face. Nothing
 * is threaded through `StackZone`.
 *
 * The two claims the bead makes are the two tests below: the object opens, and
 * the top entry's Resolve control keeps the press it already had. The second is
 * the one that could quietly break — a focus target wrapped around a button is
 * how a control stops being clicked.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState } from '@mtg/kernel';
import { humanSeat, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { RESOLVE_LABEL } from '../../src/board/StackZone';
import { SLOT_KEY_ATTRIBUTE } from '../../src/routes/play/inspect';
import { INFO_TAB } from '../../src/routes/play/PlayRail';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(() => {
  container = null;
  cleanup();
});

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

const BOLT: Card = parseCard({
  kind: 'instant',
  id: 'xmp-shock-arrow',
  name: 'Shock Arrow',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 100 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

/** One cast, so the caster keeps priority over their own object (CR 117.3c). */
function afterCast(state: GameState): GameState {
  const cast = legalActions(state).find((action) => action.type === 'castSpell');
  if (cast === undefined) throw new Error('the fixture has nothing to cast');
  return reduce(state, cast).state;
}

function onStack(): GameState {
  return afterCast(
    scenario({
      battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[BOLT, BOLT], []],
    }).state,
  );
}

function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

interface NodeLike {
  getAttribute(name: string): string | null;
}

/**
 * The rendered tree, kept so the entry can be found by class. The workspace
 * tsconfig has no `lib: dom`, so the strip is reached through the container the
 * render returns rather than through a global `document`.
 */
let container: { querySelector(selector: string): unknown } | null = null;

function renderAt(state: GameState, onChoose: (choice: Choice) => void = () => undefined): void {
  const view = render(h(PlayView, { session: sessionAt(state), viewer: 0, names: NAMES, onChoose }));
  container = view.container as unknown as { querySelector(selector: string): unknown };
}

function entry(): NodeLike {
  const found = container?.querySelector('.mtg-stack__entry') ?? null;
  if (found === null) throw new Error('the stack drew no entry');
  return found as NodeLike;
}

/** The rail's Info section itself, which `../../src/panel/ContextRail.ts` names. */
function info(): HTMLElement {
  return screen.getByRole('group', { name: INFO_TAB });
}

describe('a stack object can be read', () => {
  it('carries the key every readable card on this table writes', () => {
    // The mechanism, asserted where it is written rather than only through its
    // effect: a slot with no key is invisible to the delegated handler, and the
    // failure would be a card that silently never opens.
    renderAt(onStack());
    expect(entry().getAttribute(SLOT_KEY_ATTRIBUTE)).not.toBeNull();
    // Focusable on a press, and out of the tab order: the moves on this strip
    // are the Resolve control and the ask column, and neither of them is this.
    expect(entry().getAttribute('tabindex')).toBe('-1');
  });

  it('puts the spell in the rail Info section when it is pressed', () => {
    renderAt(onStack());
    fireEvent.click(screen.getByRole('button', { name: INFO_TAB }));
    // Nothing has been reached for yet, so the section is empty rather than
    // guessing at a card.
    expect(within(info()).queryAllByText(BOLT.name).length).toBe(0);

    // A press on a `tabIndex: -1` element focuses it, which is the event the one
    // delegated handler on the play surface reads (`4d4a2925` landed that for a
    // face with no legal move; this inherits it rather than re-arguing it).
    fireEvent.focus(entry() as unknown as Element);
    expect(within(info()).queryAllByText(BOLT.name).length).toBeGreaterThan(0);
  });

  it('leaves the top entry resolve control clickable', () => {
    // The regression a focus target wrapped around a control would cause. The
    // index it submits is `stack-resolve.test.ts`'s claim; what is asserted here
    // is only that the press still arrives.
    const submitted: Choice[] = [];
    renderAt(onStack(), (choice) => submitted.push(choice));
    fireEvent.click(screen.getByRole('button', { name: RESOLVE_LABEL }));
    expect(submitted).toHaveLength(1);
  });
});
