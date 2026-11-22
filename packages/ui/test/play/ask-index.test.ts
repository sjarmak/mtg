// @vitest-environment jsdom
/**
 * The ask says which kinds of move it is holding, above the fold.
 *
 * `mtg-euc`. The fold reading in `../../tools/rail-split.ts`, at four viewports
 * on a sixteen-move priority: 9 of 16 moves on screen at 1440x900, 7 at
 * 1280x800, 5 at 1024x768, 7 at 810x1080, and the groups named at the last three
 * were `Play` and nothing else. Under `@media (pointer: coarse)`
 * `../../src/styles/touch.ts` floors a move button at 44px and
 * `../../tools/touch-targets.ts` then reads 2 of 17 wholly visible at 1024x768.
 * Nothing is clipped and the column scrolls; what a tablet player cannot see is
 * that a `Mana` section exists at all, because the only group heading above the
 * fold is the first one.
 *
 * A taller column is not on offer — the height is the board's — so what this
 * adds is the one thing that costs no space in the scroller: the panel head
 * already sits outside it (`.mtg-prompt .mtg-panel__head` is `flex: none`), and
 * it now names every group the body drew, with each group's count. The head is
 * on screen whatever the fold does, so the enumeration's shape is readable
 * without scrolling and the scroll is a thing the player chooses knowing what is
 * down there.
 *
 * It is `aria-hidden`, for `./rail-tabs.test.ts`'s reason: every group title it
 * names is already a heading in the list below it, and a second announced copy
 * would have a screen reader read the shape of the list twice before reaching
 * the first move. The line is for the eye that cannot see past the fold, so it
 * is found here by its class rather than by a name, exactly as the hidden stack
 * copy in the play rail is.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState } from '@mtg/kernel';
import { humanSeat, ownedDecision, scenario } from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import { ASK_INDEX_CLASS } from '../../src/routes/play/rail';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(() => {
  panel = null;
  cleanup();
});

const LASH = exampleCard('slc-lightning-lash');
const MOUNTAIN = exampleCard('slc-mountain');
const WARDEN = exampleCard('slc-emberflow-raider');
const GUARDIAN = exampleCard('slc-thornhide-guardian');

const SEATS: SeatNames = ['You', 'Bot'];

/** The structural reading this file needs; the workspace has no `lib: dom`. */
interface NodeLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly closest: (selector: string) => NodeLike | null;
  readonly querySelector: (selector: string) => NodeLike | null;
}

/**
 * The one index line on the panel, read structurally off the render's own
 * container: this workspace has no `lib: dom`, so `document` is not a name here,
 * and the line is `aria-hidden`, so no role or name query reaches it.
 */
let panel: NodeLike | null = null;

function askIndex(): NodeLike {
  const found = panel?.querySelector(`.${ASK_INDEX_CLASS}`) ?? null;
  if (found === null) throw new Error('the ask drew no group index');
  return found;
}

function text(node: unknown): string {
  return (node as NodeLike).textContent ?? '';
}

/**
 * A priority in more than one group: lands to play, a spell to cast, mana to
 * make, and abilities to activate. A single-group position would leave the rule
 * true by having nothing to name.
 */
function manyGroupState(): GameState {
  return scenario({
    seed: 'test/play/ask-index/many-groups',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: WARDEN, controller: 0, summoningSick: false },
      { card: WARDEN, controller: 0, summoningSick: false, damage: 1 },
      { card: GUARDIAN, controller: 1 },
    ],
    hands: [[LASH, MOUNTAIN], []],
    active: 0,
    turn: 4,
  }).state;
}

function session(state: GameState): GameSession {
  const pending = ownedDecision(state);
  if (pending === null) throw new Error('that board left nobody to ask');
  return {
    seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function play(state: GameState): void {
  const view = render(
    h(PlayView, { session: session(state), viewer: 0, names: SEATS, onChoose: () => undefined }),
  );
  panel = view.container as unknown as NodeLike;
}

function groupTitles(): readonly string[] {
  return screen
    .getAllByText((_content, node) => {
      const element = node as unknown as NodeLike;
      return (element.getAttribute('class') ?? '') === 'mtg-choices__group-title';
    })
    .map((node) => text(node));
}

describe('the ask names the groups it is holding, outside the scroller', () => {
  it('names every group the list drew, and only those', () => {
    play(manyGroupState());
    const index = askIndex();
    const titles = groupTitles();
    expect(titles.length).toBeGreaterThan(1);
    for (const title of titles) expect(text(index)).toContain(title);
    // And nothing the list did not draw: a group named in the head with no
    // section under it is a promise the scroll cannot keep.
    for (const word of ['Hand', 'Game', 'Other']) {
      if (titles.includes(word)) continue;
      expect(text(index)).not.toContain(word);
    }
  });

  it('draws concession in the Game group, whose count cannot read as a turn number', () => {
    play(manyGroupState());
    const button = screen.getByRole('button', { name: 'Concede' }) as unknown as NodeLike;
    expect(groupTitles()).toContain('Game');
    expect(text(askIndex())).toContain('Game 1');
    expect(text(askIndex())).not.toMatch(/Turn \d/u);
    expect(button.getAttribute('data-kind')).toBe('concede');
    expect(text(button.closest('.mtg-choices__group'))).toContain('Game');
  });

  it('counts each group, so the shape of the list is readable without scrolling', () => {
    play(manyGroupState());
    const index = text(askIndex());
    const counted = [...index.matchAll(/([A-Za-z]+)\s(\d+)/gu)].map((match) => Number(match[2]));
    expect(counted.length).toBe(groupTitles().length);
    // The parts sum to the list, which is not the same number as the head's
    // `N legal` beside them and must not be asserted against it: the pass has
    // left the enumeration for a fixed home in the foot (`UNLISTED` in
    // `../../src/routes/play/rail.ts`) while the note still counts every legal
    // move. The line indexes what a scroll can reach.
    const total = counted.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(
      screen.getAllByRole('button').filter((node) => {
        const element = node as unknown as NodeLike;
        return (element.getAttribute('class') ?? '').split(' ').includes('mtg-choice');
      }).length,
    );
  });

  it('is drawn beside the head, not inside the body that scrolls', () => {
    play(manyGroupState());
    const index = askIndex();
    expect(index.closest('.mtg-panel__head')).not.toBeNull();
    expect(index.closest('.mtg-panel__body')).toBeNull();
  });
});
