/**
 * What the workbench's two rows are, and which of them a drag overrides.
 *
 * `mtg-x3yb`, widened by `mtg-d9f4`. The stylesheet sizes the deck pane to what
 * it holds so the pool is not squeezed by a deck that is not using its share,
 * and it does that with the two tracks it writes itself. Those have to lose to a
 * person who has dragged the divider, and what makes them lose is that a dragged
 * split writes *both* tracks inline: an inline custom property outranks a
 * stylesheet. So the thing worth asserting is that both are written, and that an
 * undragged workbench writes no style attribute at all rather than a half-stated
 * one.
 */
import { describe, expect, it } from 'vitest';
import { BUILDER_DEFAULT_SHARE, builderSplitStyle } from '../../src/routes/deck/builder-split';

describe('the workbench a builder is drawn on', () => {
  it('writes nothing until somebody has dragged the divider', () => {
    expect(builderSplitStyle(null)).toBeUndefined();
  });

  it('writes both rows once somebody has, so the stylesheet decides neither', () => {
    const style = builderSplitStyle(BUILDER_DEFAULT_SHARE);
    expect(style).toBeDefined();
    expect(Object.keys(style ?? {}).sort()).toEqual(['--split-a', '--split-b']);
  });

  it('clamps the dragged pool row between the floors the grid will not enforce', () => {
    const style = builderSplitStyle(0.4);
    expect(style?.['--split-a']).toContain('clamp(');
    expect(style?.['--split-a']).toContain('40.00%');
  });

  it('states the deck row as the share it would have had, not as a length', () => {
    // A length would freeze the deck at whatever the window was when the drag
    // happened; the fraction is what the stylesheet's own rule says.
    expect(builderSplitStyle(0.4)?.['--split-b']).toBe('minmax(0, 3fr)');
  });
});
