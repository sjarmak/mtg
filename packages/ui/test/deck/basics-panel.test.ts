/** The Limited mana-base control paints the shared mana vocabulary, never raw color letters. */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BasicsPanel } from '../../src/routes/deck/BasicsPanel';

const COUNTS = { W: 5, U: 4, B: 3, R: 2, G: 1 } as const;

function panel(symbols: 'original' | 'local'): string {
  return renderToStaticMarkup(
    h(BasicsPanel, {
      deck: { lands: Array.from({ length: 15 }), manaBase: { landsByColor: COUNTS } },
      chosen: true,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      symbols,
    }),
  );
}

describe('the mana-base land identities', () => {
  it('uses the five drawn offline mana glyphs with complete land names', () => {
    const html = panel('original');
    for (const [color, land] of [
      ['W', 'Plains'],
      ['U', 'Island'],
      ['B', 'Swamp'],
      ['R', 'Mountain'],
      ['G', 'Forest'],
    ] as const) {
      expect(html).toContain(`data-symbol="{${color}}"`);
      expect(html).toContain(`aria-label="${land}"`);
      expect(html).not.toContain(`class="mtg-manabar__pip">${color}<`);
    }
  });

  it('uses the staged local symbol set through the same control', () => {
    const html = panel('local');
    for (const color of ['W', 'U', 'B', 'R', 'G'] as const) {
      expect(html).toContain(`symbols/${color}.svg`);
    }
  });
});
