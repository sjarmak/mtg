// @vitest-environment jsdom
/**
 * The card being read, and the one lookup that answers what it is.
 *
 * `mtg-aqxi.1`. Reading a card on the played table was the fixed zoom panel and
 * nothing else: `../../src/card/ZoomPanel.ts` over the board, revealed by hover
 * on a mouse and by focus on a finger since 2026-08-22. On a phone that is the
 * whole board covered for a routine read, which is the complaint the epic
 * exists to answer.
 *
 * So the rail's INFO section holds the card instead, and this file is the two
 * halves that make it possible without a fifth card renderer: reading which slot
 * a focus landed in, and turning that key into the card the projection already
 * built. Neither half decides anything about the game — a key that names nothing
 * on the table is `null`, not a guess.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { cleanup } from '@testing-library/react';
import type { BoardProps } from '../../src/board/Board';
import { findInspected, inspectedKey } from '../../src/routes/play/inspect';

afterEach(cleanup);

/**
 * A detached element to hang markup on. Reached structurally, because the
 * workspace tsconfig has no `lib: dom` — the same reason `./rail-split.test.ts`
 * declares its own element shape rather than importing one.
 */
interface HostLike {
  innerHTML: string;
  readonly querySelector: (selector: string) => unknown;
}

function host(): HostLike {
  const document = (globalThis as { document?: { createElement: (tag: string) => HostLike } }).document;
  if (document === undefined) throw new Error('this test needs a jsdom document');
  return document.createElement('div');
}

function card(index: number) {
  const found = EXAMPLE_CARDS[index];
  if (found === undefined) throw new Error('the example set is too small');
  return found;
}

function position(): BoardProps {
  const side = (keyStem: string, offset: number) => ({
    status: { name: keyStem, life: 20, seat: 0 as const, library: 30, hand: 2 },
    battlefield: {
      label: `${keyStem}'s battlefield`,
      permanents: [{ key: `${keyStem}-field`, card: card(offset), stats: { power: 4, toughness: 5 } }],
    },
    hand: { label: `${keyStem}'s hand`, cards: [{ key: `${keyStem}-hand`, card: card(offset + 1) }] },
    graveyard: {
      label: `${keyStem}'s graveyard`,
      cards: [{ key: `${keyStem}-yard`, card: card(offset + 2) }],
    },
  });
  return {
    you: side('you', 0),
    opponent: side('them', 3),
    stack: { entries: [] },
  } as unknown as BoardProps;
}

describe('which card is being read', () => {
  it('finds a permanent, a card in hand and a card in a pile, on either side', () => {
    const board = position();
    for (const key of ['you-field', 'you-hand', 'you-yard', 'them-field', 'them-hand', 'them-yard']) {
      expect(findInspected(board, key), key).not.toBeNull();
    }
  });

  /**
   * The stats the projection already carried, rather than the printed numbers.
   * `../../src/card/ZoomPanel.ts` states the rule this keeps: a detail channel
   * that reverts to the print disagrees with the thing it is a detail of, and
   * this is where a player checks a creature before combat.
   */
  it('carries the permanent current size rather than the print', () => {
    const found = findInspected(position(), 'you-field');
    expect(found?.stats).toEqual({ power: 4, toughness: 5 });
  });

  it('answers null for a key nothing on the table has', () => {
    expect(findInspected(position(), 'nothing-here')).toBeNull();
    expect(findInspected(position(), null)).toBeNull();
  });

  it('reads the key off the slot a focus landed inside', () => {
    const root = host();
    root.innerHTML = '<div class="mtg-slot" data-permanent-key="you-field"><button>Cast</button></div>';
    const button = root.querySelector('button');
    if (button === null) throw new Error('no button');
    expect(inspectedKey(button)).toBe('you-field');
    expect(inspectedKey(root)).toBeNull();
    expect(inspectedKey(null)).toBeNull();
  });
});
