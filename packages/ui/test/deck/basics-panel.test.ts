/** The Limited mana-base control paints the shared mana vocabulary, never raw color letters. */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BASICS_CAPTION, BasicsPanel, SUGGEST_BASICS_LABEL } from '../../src/routes/deck/BasicsPanel';

const COUNTS = { W: 5, U: 4, B: 3, R: 2, G: 1 } as const;

function panel(symbols: 'original' | 'local', chosen = true): string {
  return renderToStaticMarkup(
    h(BasicsPanel, {
      deck: { lands: Array.from({ length: 15 }), manaBase: { landsByColor: COUNTS } },
      chosen,
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

/**
 * `mtg-0j5aw4`. A disabled Suggest beside the single word `suggested` gave no
 * reason; the reason is that the counts on screen already are the suggestion,
 * and the button has to carry it to a screen reader as well as to the eye.
 */
describe('the mana base suggest control', () => {
  it('says why it is disabled, in the caption and as the button description', () => {
    const html = panel('original', false);
    const button = /<button[^>]*aria-label="([^"]*)"[^>]*>Suggest<\/button>/.exec(html);
    expect(button?.[1]).toBe(SUGGEST_BASICS_LABEL);
    const tag = button?.[0] ?? '';
    expect(tag).toContain('disabled=""');
    const describedBy = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(
      `id="${describedBy ?? ''}" class="mtg-manabar__note">${BASICS_CAPTION.suggested}<`,
    );
  });

  it("describes nothing once the counts are the player's own and Suggest is live", () => {
    const html = panel('original', true);
    const tag = /<button[^>]*>Suggest<\/button>/.exec(html)?.[0] ?? '';
    expect(tag).not.toContain('disabled');
    expect(tag).not.toContain('aria-describedby');
    expect(html).toContain(`>${BASICS_CAPTION.chosen}<`);
  });
});
