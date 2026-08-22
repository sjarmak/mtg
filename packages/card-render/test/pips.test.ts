import { describe, expect, it } from 'vitest';
import { COLORS, formatManaCost, mana } from '@mtg/dsl';
import { PIP_GLYPHS, PIP_GLYPH_FOR_COLOR } from '@mtg/ui';
import type { PipGlyph } from '@mtg/ui';
import { costPips, pipRunWidth, renderCost } from '@mtg/card-render';

/** Every path of a glyph, filled outline first. */
function paths(glyph: PipGlyph): readonly string[] {
  return [glyph.fill, ...glyph.lines];
}

const OPTIONS = { radius: 15.5, gap: 3, centerY: 65, right: 592 };

/** The same run, painted with the set that draws its own outlines and numerals. */
const DRAWN = { ...OPTIONS, symbols: 'original' } as const;

describe('costPips', () => {
  it('prints X before fixed generic and colored symbols', () => {
    expect(costPips(mana({ hasX: true, generic: 2, R: 1 })).map((pip) => pip.kind)).toEqual([
      'variable',
      'generic',
      'color',
    ]);
    expect(renderCost(mana({ hasX: true, R: 2 }), DRAWN)).toContain('data-cost="{X}{R}{R}"');
  });

  it('prints the generic amount first, then WUBRG', () => {
    const pips = costPips(mana({ generic: 2, R: 1, W: 1 }));
    expect(
      pips.map((pip) =>
        pip.kind === 'generic' ? 'generic' : pip.kind === 'variable' ? 'variable' : pip.color,
      ),
    ).toEqual(['generic', 'W', 'R']);
  });

  it('agrees with the DSL printed cost, symbol for symbol', () => {
    const costs = [
      mana(),
      mana({ generic: 3 }),
      mana({ R: 1 }),
      mana({ generic: 1, R: 2 }),
      mana({ generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 }),
    ];
    for (const cost of costs) {
      const printed = formatManaCost(cost).match(/\{[^}]+\}/g) ?? [];
      expect(costPips(cost)).toHaveLength(printed.length);
    }
  });

  it('shows a zero generic pip for a free colorless cost', () => {
    expect(costPips(mana())).toEqual([{ kind: 'generic', amount: 0 }]);
  });

  it('omits the generic pip when the cost is entirely colored', () => {
    expect(costPips(mana({ B: 3 })).every((pip) => pip.kind === 'color')).toBe(true);
  });
});

describe('drawn symbols', () => {
  it('draws its own glyph for every color, so no font is needed', () => {
    for (const color of COLORS) {
      for (const path of paths(PIP_GLYPH_FOR_COLOR[color])) expect(path).toMatch(/^M /);
    }
  });

  it('gives each color a distinct shape', () => {
    const shapes = COLORS.map((color) => paths(PIP_GLYPH_FOR_COLOR[color]).join('|'));
    expect(new Set(shapes).size).toBe(COLORS.length);
  });

  it('keeps every glyph inside its authoring square', () => {
    for (const glyph of Object.values(PIP_GLYPHS)) {
      const coordinates =
        paths(glyph)
          .join(' ')
          .match(/-?\d+(?:\.\d+)?/g) ?? [];
      for (const coordinate of coordinates) {
        expect(Math.abs(Number(coordinate))).toBeLessThanOrEqual(50);
      }
    }
  });

  it('draws the crescent with arcs whose chords fit their radii', () => {
    // An arc whose chord exceeds its diameter is silently enlarged by the SVG
    // spec, which turns the crescent into a lens with no error anywhere.
    const path = PIP_GLYPHS.b.fill;
    const arcs = [
      ...path.matchAll(/A (\d+(?:\.\d+)?) \d+(?:\.\d+)? 0 \d \d (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g),
    ];
    expect(arcs).toHaveLength(2);
    const startMatch = /^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/.exec(path);
    expect(startMatch).not.toBeNull();
    let from: [number, number] = [Number(startMatch?.[1]), Number(startMatch?.[2])];
    for (const arc of arcs) {
      const radius = Number(arc[1]);
      const to: [number, number] = [Number(arc[2]), Number(arc[3])];
      const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
      expect(chord).toBeLessThanOrEqual(radius * 2);
      from = to;
    }
  });
});

describe('renderCost', () => {
  it('names the printed cost once, for assistive tech', () => {
    const markup = renderCost(mana({ generic: 1, R: 1 }), OPTIONS);
    expect(markup).toContain('aria-label="Mana cost {1}{R}"');
    expect(markup.match(/aria-label=/g)).toHaveLength(1);
  });

  it('right-aligns the run on the requested edge', () => {
    const markup = renderCost(mana({ generic: 2, U: 2 }), OPTIONS);
    const centers = [...markup.matchAll(/translate\((-?\d+(?:\.\d+)?) /g)].map((m) => Number(m[1]));
    expect(centers).toHaveLength(3);
    const last = centers[centers.length - 1] ?? 0;
    expect(last + OPTIONS.radius).toBeCloseTo(OPTIONS.right, 6);
    const first = centers[0] ?? 0;
    expect(first - OPTIONS.radius).toBeCloseTo(
      OPTIONS.right - pipRunWidth(3, OPTIONS.radius, OPTIONS.gap),
      6,
    );
  });

  it('shrinks a wide generic numeral to stay inside its disc', () => {
    // Asked for the drawn set outright. The numeral is what this file measures,
    // and a pip is only a numeral in a set that draws one — the referenced set
    // has no text in it to fit, and the printed default is the referenced one.
    const small = renderCost(mana({ generic: 1 }), DRAWN);
    const large = renderCost(mana({ generic: 16 }), DRAWN);
    const sizeOf = (markup: string): number => Number(/font-size="(\d+(?:\.\d+)?)"/.exec(markup)?.[1] ?? 0);
    expect(sizeOf(large)).toBeLessThan(sizeOf(small));
    expect(sizeOf(large)).toBeGreaterThan(0);
  });

  it('commits every numeral to a textLength so it cannot spill', () => {
    const markup = renderCost(mana({ generic: 12, G: 1 }), DRAWN);
    expect(markup).toContain('lengthAdjust="spacing"');
    const width = Number(/textLength="(\d+(?:\.\d+)?)"/.exec(markup)?.[1] ?? 0);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(OPTIONS.radius * 2);
  });
});

describe('pipRunWidth', () => {
  it('is zero for an empty run', () => {
    expect(pipRunWidth(0, 15.5, 3)).toBe(0);
  });

  it('counts one gap fewer than it counts pips', () => {
    expect(pipRunWidth(3, 10, 2)).toBe(3 * 20 + 2 * 2);
  });
});
