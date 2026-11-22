// @vitest-environment jsdom
/**
 * The frame changes without taking the screen with it.
 *
 * This is the mechanism behind a defect that made Constructed unplayable from
 * the Decks tab, on every path into a game. `ConstructedGame` holds the dealt
 * table in its own state and reports the start upward through
 * `onPlayingChange`; the route answered that by returning a different tree —
 * `builderScreen`'s four nested divs while building, a bare div with a page head
 * while playing. React reconciles by position, so a child under a different tree
 * is a different child: the component unmounted and remounted with its table
 * back to `null` in the same commit that set it. Nothing errored. The builder
 * simply redrew, which is why every test that checked the button was live
 * passed while the button did nothing.
 *
 * What is asserted here is the fix rather than the symptom: one wrapper across
 * both states, with only its classes changing, so whatever is inside keeps its
 * state across the switch. A `div` whose className changes is the same element
 * to React; a `div` at a different depth is not.
 */
import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { builderScreen } from '../../src/routes/deck/BuilderScreen';

afterEach(cleanup);

/**
 * What these assertions read off a rendered tree.
 *
 * The workspace tsconfig has no `lib: dom`, so the members are stated here the
 * way `../cards.test.ts` states them rather than borrowed from `HTMLElement`.
 */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike>;
  readonly textContent: string | null;
}

function root(container: unknown): ElementLike {
  return container as ElementLike;
}

/** A child with state of its own, and a button that both sets it and unframes. */
function Subject(): ReactElement {
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  return builderScreen({
    screen: 'mtg-builder-screen',
    framed: !playing,
    head: playing ? h('h1', { className: 'mtg-page-title' }, 'the game') : null,
    body: h(Counter, {
      count,
      onPress: (): void => {
        setCount((at) => at + 1);
        setPlaying(true);
      },
    }),
  });
}

/** Stands in for `ConstructedGame`: the state that must survive is its own. */
function Counter(props: { readonly count: number; readonly onPress: () => void }): ReactElement {
  // Deliberately local rather than lifted. This is exactly the shape of the
  // state that was being lost: held by the child, set by the same press that
  // changes the frame.
  const [dealt, setDealt] = useState(false);
  return h(
    'div',
    null,
    h('p', { className: 'mtg-probe' }, dealt ? 'dealt' : 'not dealt'),
    h(
      'button',
      {
        type: 'button',
        onClick: (): void => {
          setDealt(true);
          props.onPress();
        },
      },
      'deal',
    ),
  );
}

describe('the builder frame', () => {
  it('keeps the screen inside it mounted when the frame comes off', () => {
    const { container } = render(h(Subject));
    expect(root(container).querySelector('.mtg-probe')?.textContent).toBe('not dealt');

    fireEvent.click(screen.getByRole('button', { name: 'deal' }));

    // The frame is off and the head has arrived, which is the state change that
    // used to remount everything below it.
    expect(root(container).querySelector('.mtg-builder-screen')).toBeNull();
    expect(root(container).querySelector('.mtg-page-title')?.textContent).toBe('the game');
    // And the child still knows what it did.
    expect(root(container).querySelector('.mtg-probe')?.textContent).toBe('dealt');
  });

  it('draws the frame while it is framed, and nothing but divs when it is not', () => {
    const { container } = render(
      builderScreen({ screen: 'mtg-builder-screen', framed: true, head: null, body: 'x' }),
    );
    expect(root(container).querySelector('.mtg-builder-screen.mtg-screen')).toBeTruthy();
    expect(root(container).querySelector('.mtg-work__scroll')).toBeTruthy();

    cleanup();
    const bare = render(
      builderScreen({ screen: 'mtg-builder-screen', framed: false, head: null, body: 'x' }),
    );
    expect(root(bare.container).querySelector('.mtg-builder-screen')).toBeNull();
    expect(root(bare.container).querySelector('.mtg-work__scroll')).toBeNull();
    // Same three nested divs either way: that sameness is the whole point.
    expect(root(bare.container).querySelectorAll('div').length).toBe(4);
  });

  it('is framed by default, so no caller loses the frame by omission', () => {
    const { container } = render(builderScreen({ screen: 'mtg-deck-screen', head: null, body: 'x' }));
    expect(root(container).querySelector('.mtg-deck-screen.mtg-screen')).toBeTruthy();
  });
});
