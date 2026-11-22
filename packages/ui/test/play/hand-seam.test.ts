// @vitest-environment jsdom
/**
 * What the played table remembers about its own seam, and what it calls it.
 *
 * `mtg-7rhk`. `./hand-seam.browser.test.ts` measures what a dragged seam is
 * worth in pixels and needs a browser to do it; these two claims need a store
 * and a render, and jsdom has both.
 *
 * **It survives a reload.** The bead asks for a share that persists per player,
 * and the mechanism is `../../src/panel/split.ts`'s store rather than anything
 * this route owns -- but the wiring is this route's, and a share written under
 * one name and read under another is a preference that silently forgets. A
 * fresh mount over a seeded store is exactly the reload: React state is gone,
 * the store is not.
 *
 * **It does not leak between surfaces.** The same bead's second half. Three
 * splits are live in this app and each keeps its own share; the play table's
 * name is asserted against the other two rather than against a string, so a
 * later rename that collides fails here instead of handing the builder's
 * divider to the hand.
 *
 * **The name it announces agrees with the seat.** A two-human table's near seat
 * is `Player one`, and `./seat-voice.test.ts` sweeps the whole surface for a
 * second person it has no right to. That sweep reads accessible names, so the
 * handle was in it the day it was drawn; this file states the rule the sweep
 * enforces, which is the possessive `../../src/routes/play/position.ts` names
 * every other zone the near seat owns with.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { createSession, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { HAND_SEAM_NAME, handSeamStyle } from '../../src/routes/play/hand-seam';
import { builderSplitName } from '../../src/routes/deck/builder-split';
import { DRAFT_SPLIT } from '../../src/routes/draft/DraftPack';
import { splitStoreKey } from '../../src/panel/split';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const TWO_HUMAN: SeatNames = ['Player one', 'Player two'];

/** The store as a page would have left it, and nothing carried between tests. */
function store(seed: Readonly<Record<string, string>> = {}): Map<string, string> {
  const kept = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => kept.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        kept.set(key, value);
      },
    },
  });
  return kept;
}

beforeEach(() => {
  store();
});

/** The table, mounted the way a person arriving at it mounts it. */
function table(names: SeatNames): ContainerLike {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: names[0], opponentName: names[1] });
  const session = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
  const view = render(
    h(PlayView, {
      session,
      viewer: 0,
      names,
      onChoose: vi.fn(),
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: vi.fn(),
      onYield: vi.fn(),
    }),
  );
  return view.container as unknown as ContainerLike;
}

/**
 * The near lane, which is the element that carries the seam.
 *
 * Cast structurally rather than typed as an `Element`: the workspace tsconfig
 * has no `lib: dom` (`../../src/mount.ts` says why), so what a render hands back
 * carries no DOM types and every test on this route reaches a node this way.
 */
interface LaneLike {
  getAttribute(name: string): string | null;
}

interface ContainerLike {
  querySelector(selector: string): LaneLike | null;
}

function nearLane(container: ContainerLike): LaneLike {
  const found = container.querySelector(".mtg-board__side[data-seat='you']");
  if (found === null) throw new Error('the table drew no near lane');
  return found;
}

describe('the table opens where it was left', () => {
  it('draws no seam at all for a player who has never dragged one', () => {
    const lane = nearLane(table(NAMES));
    expect(lane.getAttribute('data-seam')).toBeNull();
    expect(lane.getAttribute('style')).toBeNull();
  });

  it('reads a stored share back onto the lane on a fresh mount', () => {
    store({ [splitStoreKey(HAND_SEAM_NAME)]: '0.5000' });
    const lane = nearLane(table(NAMES));
    expect(lane.getAttribute('data-seam')).toBe('true');
    // The property the stylesheet reads is the hand's height, so the stored
    // battlefield share arrives as its complement — the same arithmetic
    // `handSeamStyle` does, asserted against that function rather than against
    // a typed-out string, since which zone carries the number is the decision.
    const expected = handSeamStyle(0.5)?.['--hand-seam'];
    expect(expected).toBeDefined();
    expect(lane.getAttribute('style')).toContain(String(expected));
  });

  it('keeps its share under a name no other divider in the app answers to', () => {
    const names = [HAND_SEAM_NAME, builderSplitName('sealed'), builderSplitName('constructed'), DRAFT_SPLIT];
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names.map(splitStoreKey)).size).toBe(names.length);
  });
});

describe('the divider says whose hand it is moving', () => {
  it('speaks in the second person to the seat called You', () => {
    table(NAMES);
    expect(screen.getByRole('separator', { name: 'Resize the table and your hand' })).toBeDefined();
  });

  it('names the seat instead on a two-human table', () => {
    table(TWO_HUMAN);
    expect(screen.getByRole('separator', { name: "Resize the table and Player one's hand" })).toBeDefined();
  });
});
