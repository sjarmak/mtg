/** Legacy Cube has no private layout vocabulary left to fall back to. */
import { describe, expect, it } from 'vitest';
import { uiStyleSheet } from '../../src/styles/index';

describe('Legacy Cube layout', () => {
  it('ships only the shared card, draft, deck, and play layouts', () => {
    const css = uiStyleSheet();
    expect(css).not.toContain(".mtg-card[data-presentation='printed-card'] > .mtg-printed-card-image");
    expect(css).toContain('.mtg-draft');
    expect(css).toContain('.mtg-builder');
    expect(css).toContain('.mtg-board');
    expect(css).not.toContain('.mtg-legacy-');
  });

  it('keeps a token of space between the Group by label and its select', () => {
    expect(uiStyleSheet()).toMatch(
      /\.mtg-deck__group\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*var\(--mtg-space-2\);/,
    );
  });
});
