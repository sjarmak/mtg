/**
 * Two readings on one channel, and the margin that keeps both.
 *
 * `mtg-rgc.3` wants ownership drawn into the table — the far half permanently
 * lighter than the near one, the way Magic Online has drawn it for twenty
 * years — and `mtg-1nc` wants activity drawn into it too, the half whose turn
 * it is carrying the light. Both land on the same ground, so the failure this
 * file exists to catch is one of them quietly winning: a board where you cannot
 * tell whose turn it is, or one where you cannot tell which half is yours.
 *
 * The ordering below is the whole composition stated as four numbers. Ownership
 * is the outer step and activity the inner one, so a *lit* near band must still
 * be darker than a *resting* far band; the moment the two steps are the same
 * size, the four grounds become two pairs and the reading collapses. The margin
 * is asserted rather than the values, because the values are allowed to be
 * retuned and the relation between them is not.
 *
 * Everything here is computed rather than eyeballed. The palette is OKLCH and
 * WCAG contrast is defined on sRGB relative luminance, so `../support/oklch.ts`
 * converts before comparing — the same module `../card-surfaces.test.ts` uses,
 * for the same reason. What it cannot answer is whether the bands *read*, which
 * is a browser question; `packages/ui/tools/band-panel.ts` is the measurement,
 * and the numbers it reported are quoted in the docblocks the rules sit under.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Board } from '../../src/board/Board';
import type { BoardSide } from '../../src/board/Board';
import { BOARD_CSS } from '../../src/styles/board';
import {
  COLOR_IDENTITIES,
  MAT_DARK_TOKENS,
  MAT_LIGHT_TOKENS,
  LIGHT_TOKENS,
  DARK_TOKENS,
} from '../../src/styles/tokens';
import { contrastRatio, inSrgb, tokenColor } from '../support/oklch';
import type { Oklch } from '../support/oklch';

interface Palette {
  readonly name: string;
  /** The mat block: the table, its wells, its bands and the seam. */
  readonly mat: string;
  /** The document block: the ink, the ready family and the card identities. */
  readonly root: string;
}

const PALETTES: readonly Palette[] = [
  { name: 'light', mat: MAT_LIGHT_TOKENS, root: LIGHT_TOKENS },
  { name: 'dark', mat: MAT_DARK_TOKENS, root: DARK_TOKENS },
];

/** The four grounds a seat can be drawn on, lightest first. */
const GROUNDS = [
  '--mtg-mat-band-far-lit',
  '--mtg-mat-band-far',
  '--mtg-mat-band-near-lit',
  '--mtg-mat-band-near',
] as const;

/** Each band's two grounds, and the keyline and ink that travel with them. */
const BANDS = [
  {
    seat: 'opponent',
    grounds: ['--mtg-mat-band-far', '--mtg-mat-band-far-lit'],
    edge: '--mtg-mat-band-far-edge',
    ink: '--mtg-mat-band-far-ink',
  },
  {
    seat: 'you',
    grounds: ['--mtg-mat-band-near', '--mtg-mat-band-near-lit'],
    edge: '--mtg-mat-band-near-edge',
    ink: '--mtg-mat-band-near-ink',
  },
] as const;

const BAND_SUPPORT = BANDS.flatMap((band) => [band.edge, band.ink]);

function ground(palette: Palette, token: (typeof GROUNDS)[number]): Oklch {
  return tokenColor(palette.mat, token);
}

/**
 * The step between two grounds, as a WCAG ratio.
 *
 * A ratio rather than a lightness delta because a ratio is what a person
 * actually separates two large adjacent fields by, and because every other
 * number in this file is one.
 */
function step(palette: Palette, from: (typeof GROUNDS)[number], to: (typeof GROUNDS)[number]): number {
  return contrastRatio(ground(palette, from), ground(palette, to));
}

describe('the ownership band and the activity lift', () => {
  it('orders the four grounds so ownership is the outer step', () => {
    for (const palette of PALETTES) {
      const ladder = GROUNDS.map((token) => ground(palette, token)[0]);
      for (let index = 1; index < ladder.length; index += 1) {
        expect(
          ladder[index - 1],
          `${palette.name}: ${GROUNDS[index - 1]} vs ${GROUNDS[index]}`,
        ).toBeGreaterThan(ladder[index] ?? 0);
      }
    }
  });

  /**
   * The one relation that cannot be given up. A lit near band is still the near
   * band; if it ever reached a resting far band, a player would read their own
   * turn as the opponent's half of the table.
   */
  it('keeps a lit near band under a resting far band by more than the activity step', () => {
    for (const palette of PALETTES) {
      const ownership = step(palette, '--mtg-mat-band-far', '--mtg-mat-band-near-lit');
      const activityFar = step(palette, '--mtg-mat-band-far-lit', '--mtg-mat-band-far');
      const activityNear = step(palette, '--mtg-mat-band-near-lit', '--mtg-mat-band-near');
      // A ratio starts at 1, so how much bigger one step is than another is a
      // question about the distance from 1 and not about the ratios themselves.
      expect(ownership - 1, `${palette.name}: ownership is not the outer step`).toBeGreaterThan(
        (Math.max(activityFar, activityNear) - 1) * 3,
      );
      expect(activityFar, `${palette.name}: the far lift is invisible`).toBeGreaterThan(1.02);
      expect(activityNear, `${palette.name}: the near lift is invisible`).toBeGreaterThan(1.02);
    }
  });

  it('separates the two resting bands enough to read at a glance', () => {
    for (const palette of PALETTES) {
      expect(step(palette, '--mtg-mat-band-far', '--mtg-mat-band-near'), palette.name).toBeGreaterThan(1.3);
    }
  });

  it('keeps every band inside sRGB, so nothing clips to a paler color than the sheet asked for', () => {
    for (const palette of PALETTES) {
      for (const token of [...GROUNDS, '--mtg-mat-seam', ...BAND_SUPPORT]) {
        expect(inSrgb(tokenColor(palette.mat, token)), `${palette.name}: ${token} is outside sRGB`).toBe(
          true,
        );
      }
    }
  });
});

/**
 * The band a card is drawn on, measured against the card.
 *
 * A face's outermost surface is its identity border, `--mtg-color-<id>`, so
 * that is what a ground has to stand off from — and no palette here separates
 * every identity well. On paper white sits at lightness 0.845 and the well sat
 * at 0.868, one point away, which is 1.08:1; in the dark palette every identity
 * is lighter than the table, so a band can only lose ground by rising. The bar
 * is therefore whichever is *easier* of "no worse than the well" and the
 * non-text AA floor: a band may not make a card harder to find than the surface
 * it replaced, and where the well was already comfortable a band need only stay
 * comfortable.
 */
describe('a card on a band', () => {
  function worstIdentity(palette: Palette, band: Oklch): number {
    return Math.min(
      ...COLOR_IDENTITIES.map((identity) =>
        contrastRatio(band, tokenColor(palette.root, `--mtg-color-${identity}`)),
      ),
    );
  }

  it('never sits closer to a card than the well it replaced, and never under the AA floor', () => {
    for (const palette of PALETTES) {
      const floor = Math.min(worstIdentity(palette, tokenColor(palette.mat, '--mtg-mat-well')), 3);
      for (const token of GROUNDS) {
        expect(worstIdentity(palette, ground(palette, token)), `${palette.name}: ${token}`).toBeGreaterThan(
          floor,
        );
      }
    }
  });
});

/**
 * What a moved ground takes with it.
 *
 * `--mtg-mat-edge` and `--mtg-ink-faint` were both chosen against the well, and
 * neither band is the well. Which direction costs depends on the palette — on
 * paper the near band moves toward the dark ink, in the dark palette the far
 * band does — so both bands carry their own, and both have to be better than
 * what they replace rather than merely different. `mtg-1nc` asks for a signal
 * that does not push an already-thin token further down.
 */
describe('the ink and the keyline on a band', () => {
  it('gives every band an ink at AA on both of its grounds', () => {
    for (const palette of PALETTES) {
      for (const band of BANDS) {
        const ink = tokenColor(palette.mat, band.ink);
        for (const token of band.grounds) {
          expect(contrastRatio(ground(palette, token), ink), `${palette.name}: ${token}`).toBeGreaterThan(
            4.5,
          );
        }
      }
    }
  });

  it('beats the ink the well carried, rather than merely replacing it', () => {
    for (const palette of PALETTES) {
      const onWell = contrastRatio(
        tokenColor(palette.mat, '--mtg-mat-well'),
        tokenColor(palette.root, '--mtg-ink-faint'),
      );
      for (const band of BANDS) {
        const ink = tokenColor(palette.mat, band.ink);
        for (const token of band.grounds) {
          expect(contrastRatio(ground(palette, token), ink), `${palette.name}: ${token}`).toBeGreaterThan(
            onWell,
          );
        }
      }
    }
  });

  it('gives every band a keyline no thinner than the one the well was drawn with', () => {
    for (const palette of PALETTES) {
      const onWell = contrastRatio(
        tokenColor(palette.mat, '--mtg-mat-well'),
        tokenColor(palette.mat, '--mtg-mat-edge'),
      );
      for (const band of BANDS) {
        const edge = tokenColor(palette.mat, band.edge);
        for (const token of band.grounds) {
          expect(contrastRatio(ground(palette, token), edge), `${palette.name}: ${token}`).toBeGreaterThan(
            onWell,
          );
        }
      }
    }
  });
});

/**
 * The seam: the channel that survives a viewer who cannot separate the two
 * bands by lightness at all, and the outer ring of the playable state.
 */
describe('the seam between the halves', () => {
  it('clears non-text AA against the mat and against both bands', () => {
    for (const palette of PALETTES) {
      const seam = tokenColor(palette.mat, '--mtg-mat-seam');
      expect(
        contrastRatio(tokenColor(palette.mat, '--mtg-mat'), seam),
        `${palette.name}: mat`,
      ).toBeGreaterThan(3);
      for (const token of GROUNDS) {
        expect(contrastRatio(ground(palette, token), seam), `${palette.name}: ${token}`).toBeGreaterThan(3);
      }
    }
  });

  /**
   * `--mtg-ready` is a mid amber, so how far it stands off a ground depends on
   * how light the ground is, and it cannot clear 3:1 upward from a ground that
   * is already at lightness 0.80. The seam hairline outside it is what makes
   * "you can play this" legible on a ground of any tone — WCAG 1.4.11 asks that
   * of a control whose only claim to being one is that it is drawn differently.
   */
  it('is what makes the playable ring legible on a band of any tone', () => {
    for (const palette of PALETTES) {
      const seam = tokenColor(palette.mat, '--mtg-mat-seam');
      for (const token of [...GROUNDS, '--mtg-mat-well'] as const) {
        expect(
          contrastRatio(tokenColor(palette.mat, token), seam),
          `${palette.name}: ${token}`,
        ).toBeGreaterThan(3);
      }
      expect(
        contrastRatio(tokenColor(palette.root, '--mtg-surface-rail'), seam),
        `${palette.name}: hand rail`,
      ).toBeGreaterThan(3);
    }
  });
});

/** The rules, read off the sheet that ships. */
describe('the band sheet', () => {
  /**
   * The declarations the sheet finally applies for a selector, which is the
   * *last* rule written for it and not the first. `.mtg-board__divider` is
   * declared in `./mat.ts` as well, and reading the first match would have
   * measured the rule this file exists to override.
   */
  function declaration(selector: string): string {
    const pattern = new RegExp(`\\n${selector.replace(/[.[\]*+?^${}()|\\]/g, '\\$&')} \\{([^}]*)\\}`, 'g');
    const found = [...BOARD_CSS.matchAll(pattern)];
    const last = found[found.length - 1];
    if (last === undefined) throw new Error(`no rule for ${selector}`);
    return last[1] ?? '';
  }

  it('gives each seat a resting ground and a lit one', () => {
    expect(declaration(".mtg-board__side[data-seat='opponent']")).toContain('var(--mtg-mat-band-far)');
    expect(declaration(".mtg-board__side[data-seat='opponent'][data-active='true']")).toContain(
      'var(--mtg-mat-band-far-lit)',
    );
    expect(declaration(".mtg-board__side[data-seat='you']")).toContain('var(--mtg-mat-band-near)');
    expect(declaration(".mtg-board__side[data-seat='you'][data-active='true']")).toContain(
      'var(--mtg-mat-band-near-lit)',
    );
  });

  it('rings and haloes the active side as well as lifting it', () => {
    const active = declaration(".mtg-board__side[data-active='true']");
    expect(active).toContain('var(--mtg-ready)');
    expect(active).toContain('var(--mtg-ready-soft)');
  });

  /**
   * The inactive side is left exactly as it is. A rule that reached for it at
   * all would be the dimming `mtg-1nc` rules out by name, and the cheapest way
   * to be sure is that no selector in the sheet names the state.
   */
  it('never draws the inactive side differently from the way it is drawn at rest', () => {
    expect(BOARD_CSS).not.toContain("data-active='false'");
  });

  it('draws the seam as a bar in its own color rather than as one more keyline', () => {
    const seam = declaration('.mtg-board__divider');
    expect(seam).toContain('var(--mtg-mat-seam)');
    expect(seam).not.toContain('var(--mtg-mat-edge)');
    expect(seam).toContain('height: var(--mtg-space-2)');
  });

  /**
   * One declaration rather than four. A well restating its band is a well that
   * can be left behind when the band is retuned; inheriting it cannot drift.
   */
  it('has the wells take the band rather than restating it, and leaves the hand paper', () => {
    expect(BOARD_CSS).toContain(
      ".mtg-board__side > .mtg-zone:not([data-tone='rail']) { background-color: inherit; }",
    );
  });

  /** The playable state is two rings, and the outer one is what survives a dark band. */
  it('carries the seam outside the playable ring', () => {
    const lit = declaration(".mtg-slot > .mtg-card[data-interactive='true']");
    expect(lit).toContain('var(--mtg-ready)');
    expect(lit).toContain('var(--mtg-mat-seam)');
    expect(lit).toContain('var(--mtg-ready-lift)');
  });
});

/**
 * The markup half. A stylesheet that selects `[data-active]` is worth nothing
 * if the attribute never reaches the DOM, and it has to reach it on *both*
 * seats — the failure worth catching is a board that lights the near half every
 * turn because the attribute is only ever written on one side.
 */
describe('which seat the board says is active', () => {
  function creature(): DslCard {
    const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
    if (card === undefined) throw new Error('the DSL example set has no creature');
    return card;
  }

  function seat(name: string, active: boolean): BoardSide {
    return {
      status: { name, life: 20, handCount: 7, libraryCount: 33, graveyardCount: 0, active },
      battlefield: { label: `${name} battlefield`, permanents: [{ key: `${name}-1`, card: creature() }] },
    };
  }

  function markup(activeSeat: 'you' | 'opponent'): string {
    return renderToStaticMarkup(
      h(Board, {
        opponent: seat('bot', activeSeat === 'opponent'),
        you: seat('you', activeSeat === 'you'),
        stack: { entries: [] },
      }),
    );
  }

  it('stamps the active seat and the other one, on each side in turn', () => {
    expect(markup('you')).toContain('data-seat="you" data-active="true"');
    expect(markup('you')).toContain('data-seat="opponent" data-active="false"');
    expect(markup('opponent')).toContain('data-seat="opponent" data-active="true"');
    expect(markup('opponent')).toContain('data-seat="you" data-active="false"');
  });

  /**
   * A seat whose props say nothing about the turn is not active. Written out
   * rather than left off, so the sheet can select either state and this test can
   * tell "not active" from "the component never said".
   */
  it('says false rather than nothing when the turn is not stated', () => {
    const silent = renderToStaticMarkup(
      h(Board, {
        opponent: {
          status: { name: 'bot', life: 20, handCount: 7, libraryCount: null, graveyardCount: null },
          battlefield: { label: 'bot battlefield', permanents: [] },
        },
        you: {
          status: { name: 'you', life: 20, handCount: 7, libraryCount: 33, graveyardCount: 0 },
          battlefield: { label: 'you battlefield', permanents: [] },
        },
        stack: { entries: [] },
      }),
    );
    expect(silent).toContain('data-seat="you" data-active="false"');
    expect(silent).toContain('data-seat="opponent" data-active="false"');
  });
});
