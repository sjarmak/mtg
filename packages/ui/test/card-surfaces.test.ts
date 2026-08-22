/**
 * The card's interior carries its color, and still carries its text.
 *
 * Every panel of every card used to be `--mtg-surface-raised` and every art
 * window `--mtg-surface-sunken`, so the only colored thing on a face was its
 * ground and the hairline round each box — and the ground sat between 0.906 and
 * 0.958 in lightness against a 0.973 page, which is paper on paper. A hand read
 * as white rectangles with colored rims. `--mtg-frame-<id>-panel` and
 * `--mtg-frame-<id>-well` are the fix, and this file is what keeps them honest
 * in both directions: deep enough to be seen, light enough to be read.
 *
 * The second half of that arrangement is the *band*: the ground the boxes are
 * printed on, which used to sit 0.030 above the boxes and now sits at least 0.12
 * below them, because four surfaces within a rounding error of each other read
 * as one flat wash rather than as a frame. That delta is what takes the band out
 * of the legible range for good, so this file asks the two remaining surfaces
 * for ratios and asks the sheet, separately, to keep every word off the band.
 *
 * Everything below is computed, not eyeballed. The palette is written in OKLCH
 * and WCAG contrast is defined on sRGB relative luminance, so `./support/oklch.ts`
 * converts before comparing; the same conversion answers whether a value is
 * inside sRGB at all, which matters because a color outside it does not fail —
 * it clips, and what reaches the screen is paler and less saturated than the
 * sheet asked for. That is the exact defect being fixed, arriving by the back
 * door.
 *
 * Read off `COLOR_IDENTITIES` and the two palette blocks rather than listed, so
 * an eighth identity or a re-valued token is covered without anyone coming back.
 */
import { describe, expect, it } from 'vitest';
import { COLOR_IDENTITIES, DARK_TOKENS, LIGHT_TOKENS } from '../src/styles/tokens';
import type { ColorIdentity } from '../src/styles/tokens';
import { uiStyleSheet } from '../src/styles/index';
import { contrastRatio, inSrgb, oklabDistance, tokenColor } from './support/oklch';
import type { Oklch } from './support/oklch';

/** The three surfaces an identity paints inside its own border. */
const SURFACES = ['', '-panel', '-well'] as const;

/**
 * The two of them that carry text.
 *
 * The band — `--mtg-frame-<id>`, the empty suffix — is not one, and cannot be:
 * body ink clears 7:1 only above lightness 0.735 on paper, the box has to stay
 * above 0.848 for muted ink to clear 4.5:1, and the band is at least 0.12 under
 * the box. No band satisfying that is legible, so the face was drawn to print
 * nothing on it rather than the palette tuned toward a ratio it cannot reach.
 * `prints no text straight onto the band` below is the other half of this: the
 * floors here are only honest while that stays true.
 */
const TEXT_SURFACES = ['-panel', '-well'] as const;

/** How far the band sits under the box, which is what makes a frame a frame. */
const BAND_DELTA = 0.12;

interface Palette {
  readonly name: string;
  readonly block: string;
  readonly ink: Oklch;
  readonly inkMuted: Oklch;
  readonly page: Oklch;
  readonly raised: Oklch;
  readonly sunken: Oklch;
}

function palette(name: string, block: string): Palette {
  return {
    name,
    block,
    ink: tokenColor(block, '--mtg-ink'),
    inkMuted: tokenColor(block, '--mtg-ink-muted'),
    page: tokenColor(block, '--mtg-surface-page'),
    raised: tokenColor(block, '--mtg-surface-raised'),
    sunken: tokenColor(block, '--mtg-surface-sunken'),
  };
}

const PALETTES: readonly Palette[] = [palette('light', LIGHT_TOKENS), palette('dark', DARK_TOKENS)];

function surfaceColor(block: string, identity: ColorIdentity, surface: string): Oklch {
  return tokenColor(block, `--mtg-frame-${identity}${surface}`);
}

/** Every card surface in a palette, named for a failure message. */
function everySurface(p: Palette): readonly (readonly [string, Oklch])[] {
  return COLOR_IDENTITIES.flatMap((identity) =>
    SURFACES.map(
      (surface) =>
        [`${p.name} --mtg-frame-${identity}${surface}`, surfaceColor(p.block, identity, surface)] as const,
    ),
  );
}

/** The subset of them a word is ever printed on. */
function everyTextSurface(p: Palette): readonly (readonly [string, Oklch])[] {
  return COLOR_IDENTITIES.flatMap((identity) =>
    TEXT_SURFACES.map(
      (surface) =>
        [`${p.name} --mtg-frame-${identity}${surface}`, surfaceColor(p.block, identity, surface)] as const,
    ),
  );
}

describe('the ink a card prints on its own surfaces', () => {
  it('finds three surfaces for every identity in both palettes', () => {
    // Forty-two colors. A conversion bug or a narrowed loop would make every
    // assertion below vacuous, so the count is asserted before it is used.
    const found = PALETTES.flatMap(everySurface);
    expect(found).toHaveLength(COLOR_IDENTITIES.length * SURFACES.length * PALETTES.length);
    expect(found).toHaveLength(42);
  });

  /**
   * The floor the deepening had to respect, and the one that moved to let it.
   * Body text is 4.5:1. `--mtg-ink` clears it with room to spare everywhere;
   * `--mtg-ink-muted` is the tight one, because it carries the collector line
   * and the pending note, and it is why the light value came down from 0.52 to
   * 0.460 rather than the frames going back up (measured worst: 4.71, dark
   * `--mtg-frame-m-panel`).
   */
  it('clears WCAG AA on every one of them, in both palettes', () => {
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const [name, color] of everyTextSurface(p)) {
        for (const [ink, inkName] of [
          [p.ink, '--mtg-ink'],
          [p.inkMuted, '--mtg-ink-muted'],
        ] as const) {
          const ratio = contrastRatio(ink, color);
          if (ratio < 4.5) failures.push(`${inkName} on ${name}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('leaves the body ink a clear margin rather than sitting on the line', () => {
    const ratios = PALETTES.flatMap((p) =>
      everyTextSurface(p).map(([, color]) => contrastRatio(p.ink, color)),
    );
    expect(Math.min(...ratios)).toBeGreaterThan(7);
  });

  /**
   * The band bears no words, asserted against the sheet rather than promised in
   * a docblock. Every run of text on the face names the surface under it, and
   * the collector line is the one that had to move: it was set straight onto the
   * ground, and the ground is now deep enough that muted ink reads at 1.3:1 on
   * green. A rule that dropped the ground back under it would put a line of
   * unreadable text on every card and pass every other check in this file.
   */
  it('prints no text straight onto the band', () => {
    const collector = /\.mtg-card__collector \{[^}]*\}/.exec(uiStyleSheet())?.[0] ?? '';
    expect(collector, '.mtg-card__collector has no rule').not.toBe('');
    expect(collector, 'the collector line is set on the card ground').toContain('background: var(--panel)');
  });
});

describe('the color a card surface carries', () => {
  /**
   * The defect this whole change is about, stated as a number a future palette
   * cannot drift back through. 0.04 in OKLab is comfortably above the
   * just-noticeable difference on a large flat area; the shipped palette's
   * closest pair is the dark black band against the dark page at 0.042, and
   * black is the identity that is *meant* to sit down beside the ground.
   */
  it('separates every panel and well from the neutral page', () => {
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const [name, color] of everySurface(p)) {
        const distance = oklabDistance(color, p.page);
        if (distance < 0.04) failures.push(`${name} is ${distance.toFixed(3)} from the page`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('separates them from the neutral panel and window they replaced', () => {
    // `--mtg-surface-raised` was every panel and `--mtg-surface-sunken` every art
    // window. A palette that quietly reverted would land back on top of these.
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const [name, color] of everySurface(p)) {
        for (const [neutral, neutralName] of [
          [p.raised, '--mtg-surface-raised'],
          [p.sunken, '--mtg-surface-sunken'],
        ] as const) {
          const distance = oklabDistance(color, neutral);
          if (distance < 0.025) failures.push(`${name} is ${distance.toFixed(3)} from ${neutralName}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * Colorless is exempt by name: `c` is the pale-stone identity and reads as one
   * by lightness, which the separation above already holds it to. The other six
   * have to be their color, and chroma is what says so — a surface can be a long
   * way from the page in OKLab on lightness alone.
   */
  it('gives the six colored identities real chroma on every surface', () => {
    const colored = COLOR_IDENTITIES.filter((identity) => identity !== 'c');
    expect(colored).toHaveLength(6);
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const identity of colored) {
        for (const surface of SURFACES) {
          const [, chroma] = surfaceColor(p.block, identity, surface);
          if (chroma < 0.03) {
            failures.push(`${p.name} --mtg-frame-${identity}${surface} chroma ${chroma.toFixed(3)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * A color outside sRGB is not rejected by anything: it clips on the way to the
   * screen, and clipping desaturates. Two of the frames this change replaced were
   * outside — light `--mtg-frame-u` and `--mtg-frame-r` — so the two colors with
   * the least chroma headroom at high lightness were the two being displayed
   * paler than they were written.
   */
  it('keeps every one of them inside sRGB, so none of them clips paler', () => {
    const outside = PALETTES.flatMap((p) =>
      everySurface(p)
        .filter(([, color]) => !inSrgb(color))
        .map(([name]) => name),
    );
    expect(outside).toEqual([]);
  });

  /**
   * The box is the lightest surface, the window a step under it, the band well
   * below both — a colored frame with a printing area laid into it, which is
   * what a printed Magic card is. The ordering used to run panel, frame, well
   * across a span of 0.06, and a frame whose four surfaces are within a
   * rounding error of each other reads as one flat wash.
   */
  it('lays the box over the window over the band', () => {
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const identity of COLOR_IDENTITIES) {
        const [frame] = surfaceColor(p.block, identity, '');
        const [panel] = surfaceColor(p.block, identity, '-panel');
        const [well] = surfaceColor(p.block, identity, '-well');
        if (!(panel > well && well > frame)) {
          failures.push(`${p.name} ${identity}: panel ${panel} well ${well} frame ${frame}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The ask this palette was rebuilt for, as a number rather than as a look:
   * The playtester, 2026-08-13, on a frame whose band sat 0.030 under its box. 0.12
   * is four times that and reads as two materials rather than as one surface
   * with a seam. It is also the constraint that makes the band unwritable —
   * `TEXT_SURFACES` has the arithmetic — so a palette that quietly closed the
   * gap again would be legal only because nothing prints on the band any more.
   */
  it('sets the band at least 0.12 in lightness under the box', () => {
    const failures: string[] = [];
    for (const p of PALETTES) {
      for (const identity of COLOR_IDENTITIES) {
        const [frame] = surfaceColor(p.block, identity, '');
        const [panel] = surfaceColor(p.block, identity, '-panel');
        const delta = panel - frame;
        if (delta < BAND_DELTA) failures.push(`${p.name} ${identity}: ${delta.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('the two renderers paint those surfaces from the same tokens', () => {
  const SHEET = uiStyleSheet();

  it('resolves a panel and a well channel for every identity', () => {
    for (const identity of COLOR_IDENTITIES) {
      expect(SHEET, `identity ${identity} panel channel`).toContain(
        `--panel: var(--mtg-frame-${identity}-panel)`,
      );
      expect(SHEET, `identity ${identity} well channel`).toContain(
        `--well: var(--mtg-frame-${identity}-well)`,
      );
    }
  });

  it('spends those channels on the bars, the rules box, the badge and the window', () => {
    for (const selector of ['.mtg-card__bar', '.mtg-card__text', '.mtg-card__pt']) {
      const rule = new RegExp(`\\${selector} \\{[^}]*\\}`).exec(SHEET)?.[0] ?? '';
      expect(rule, `${selector} has no rule`).not.toBe('');
      expect(rule, `${selector} still paints neutral paper`).toContain('background: var(--panel)');
    }
    const art = /\.mtg-art \{[^}]*\}/.exec(SHEET)?.[0] ?? '';
    expect(art).toContain('background: var(--well)');
  });

  /**
   * The exception, in the sheet rather than only in the docblock. A window with
   * no picture yet prints `--mtg-pending` amber, which sits at 2.9:1 on the
   * neutral sunken ground and 2.2:1 on a tinted well; the notice that exists to
   * be noticed is the wrong place to spend contrast.
   */
  it('leaves the pending window neutral, and says so in both sheets', () => {
    const pending = /\.mtg-art\[data-art-state='pending'\] \{[^}]*\}/.exec(SHEET)?.[0] ?? '';
    expect(pending).not.toBe('');
    expect(pending).toContain('background-color: var(--mtg-surface-sunken)');
  });
});
