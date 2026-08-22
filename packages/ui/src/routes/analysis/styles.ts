/**
 * The analysis route's own sheet.
 *
 * Shipped as a `<style>` this route mounts rather than folded into
 * `uiStyleSheet()`, because the shell package owns that file and this route is
 * a tenant in it. Same rules apply: class names and `data-` attributes only, no
 * color literal anywhere (`test/tokens.test.ts` scans this file too), and only
 * `--mtg-*` tokens the token sheet declares.
 *
 * Mark colors come from exactly two places and never from a third:
 *
 *  - `--mtg-accent` for data marks. One series, one hue — the "emphasis" form,
 *    which is the honest default when a chart has one thing to say. Measured
 *    against `--mtg-surface-raised`: 6.79:1 light, 7.61:1 dark.
 *  - `--mtg-positive` / `--mtg-negative` / `--mtg-pending` when the value's
 *    meaning is a *state* (inside a band, outside it, no evidence). Those are
 *    status tokens with reserved meaning and they always ship beside a word,
 *    never as color alone. Measured: 5.15 / 5.36 / 3.33 light, 7.48 / 6.12 /
 *    8.21 dark.
 *
 * The five color-identity tokens are deliberately **not** used as a chart
 * palette. Run the data-viz validator on them and they fail three of the six
 * checks in both themes — white sits at OKLCH L 0.876 (1.43:1 on paper), black
 * at 0.396, colorless at chroma 0.012, and green/red collapse to ΔE 4.2-5.3
 * under simulated deuteranopia. They are semantic: white *is* pale and
 * colorless *is* gray, so they cannot be re-stepped into a safe categorical
 * ramp without ceasing to mean what they mean. They appear here only as a
 * labeled `.mtg-swatch` chip beside a row's name, where the text carries the
 * identity and the color merely agrees with it.
 */

const CHART = `
.mtg-chart { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-chart + .mtg-chart { margin-top: var(--mtg-space-5); }
.mtg-chart__head { display: flex; flex-direction: column; gap: 2px; }
.mtg-chart__title { font-size: var(--mtg-text-sm); font-weight: 600; letter-spacing: -0.005em; }
.mtg-chart__sample {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
  font-variant-numeric: tabular-nums;
}
.mtg-chart__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); max-width: var(--mtg-measure); }
.mtg-chart__body { width: 100%; }
.mtg-chart__data { font-size: var(--mtg-text-sm); }
.mtg-chart__data > summary {
  cursor: pointer; color: var(--mtg-ink-muted); font-size: var(--mtg-text-xs);
  padding: var(--mtg-space-1) 0;
}
.mtg-chart__data[open] > summary { color: var(--mtg-ink); }
.mtg-chart__legend { display: flex; flex-wrap: wrap; gap: var(--mtg-space-1) var(--mtg-space-4); }
.mtg-key { display: inline-flex; align-items: center; gap: var(--mtg-space-2); font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-key__mark {
  width: 14px; height: 8px; border-radius: var(--mtg-radius-sm);
  background: var(--mtg-accent); flex: none;
}
.mtg-key[data-tone='target'] .mtg-key__mark { background: var(--mtg-ink-faint); width: 2px; height: 12px; border-radius: 0; }
.mtg-key[data-tone='band'] .mtg-key__mark { background: var(--mtg-surface-inset); height: 12px; width: 18px; }
.mtg-key[data-tone='negative'] .mtg-key__mark { background: var(--mtg-negative); }
.mtg-key[data-tone='pending'] .mtg-key__mark { background: var(--mtg-pending); }
.mtg-key[data-tone='positive'] .mtg-key__mark { background: var(--mtg-positive); }
`;

const PLOT = `
.mtg-plot { display: block; width: 100%; height: auto; overflow: visible; }
.mtg-plot text { font-family: var(--mtg-font-ui); fill: var(--mtg-ink-muted); }
.mtg-plot__label { font-size: 11px; fill: var(--mtg-ink); }
.mtg-plot__tick { font-size: 10px; fill: var(--mtg-ink-faint); font-variant-numeric: tabular-nums; }
.mtg-plot__value { font-size: 11px; fill: var(--mtg-ink); font-variant-numeric: tabular-nums; }
.mtg-plot__grid { stroke: var(--mtg-line); stroke-width: 1; }
.mtg-plot__axis { stroke: var(--mtg-line-strong); stroke-width: 1; }
.mtg-plot__band { fill: var(--mtg-surface-inset); }
.mtg-plot__band-edge { stroke: var(--mtg-line-strong); stroke-width: 1; }
.mtg-plot__mark { fill: var(--mtg-accent); transition: opacity var(--mtg-duration-fast) var(--mtg-ease); }
.mtg-plot__mark[data-tone='negative'] { fill: var(--mtg-negative); }
.mtg-plot__mark[data-tone='pending'] { fill: var(--mtg-pending); }
.mtg-plot__mark[data-tone='positive'] { fill: var(--mtg-positive); }
.mtg-plot__mark[data-tone='muted'] { fill: var(--mtg-ink-faint); }
.mtg-plot__mark:hover { opacity: 0.78; }
.mtg-plot__target { stroke: var(--mtg-ink-faint); stroke-width: 2; }
.mtg-plot__whisker { stroke: var(--mtg-accent); stroke-width: 2; }
.mtg-plot__whisker[data-tone='negative'] { stroke: var(--mtg-negative); }
.mtg-plot__ring { stroke: var(--mtg-surface-raised); stroke-width: 2; }
`;

const FIGURES = `
.mtg-stats { display: flex; flex-wrap: wrap; gap: var(--mtg-space-5); }
.mtg-stat { display: flex; flex-direction: column; gap: 2px; min-width: 8rem; }
.mtg-stat__label { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-stat__value { font-size: var(--mtg-text-lg); font-weight: 600; letter-spacing: -0.01em; }
.mtg-stat__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-stat[data-tone='negative'] .mtg-stat__value { color: var(--mtg-negative); }
.mtg-stat[data-tone='positive'] .mtg-stat__value { color: var(--mtg-positive); }
.mtg-stat[data-tone='pending'] .mtg-stat__value { color: var(--mtg-pending); }

.mtg-meter { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--mtg-space-1) var(--mtg-space-3); align-items: center; }
.mtg-meter__label { font-size: var(--mtg-text-sm); color: var(--mtg-ink); }
.mtg-meter__value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-size: var(--mtg-text-sm); text-align: right; }
.mtg-meter__track {
  grid-column: 1 / -1; position: relative; height: 10px;
  background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-pill); overflow: hidden;
}
.mtg-meter__fill { position: absolute; inset-block: 0; left: 0; background: var(--mtg-accent); border-radius: var(--mtg-radius-pill); }
.mtg-meter[data-tone='negative'] .mtg-meter__fill { background: var(--mtg-negative); }
.mtg-meter[data-tone='pending'] .mtg-meter__fill { background: var(--mtg-pending); }
.mtg-meter[data-tone='positive'] .mtg-meter__fill { background: var(--mtg-positive); }
.mtg-meter__limit { position: absolute; inset-block: 0; width: 2px; background: var(--mtg-ink-faint); }
.mtg-meter__caption { grid-column: 1 / -1; font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }

.mtg-evidence {
  display: flex; flex-direction: column; gap: 2px; margin: 0;
  padding: var(--mtg-space-3);
  background: var(--mtg-surface-sunken);
  border-radius: var(--mtg-radius-sm);
}
.mtg-evidence__title { font-size: var(--mtg-text-sm); font-weight: 600; color: var(--mtg-pending); }
.mtg-evidence__body { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); max-width: var(--mtg-measure); }
.mtg-evidence__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); font-variant-numeric: tabular-nums; }

.mtg-rowbar { display: inline-flex; align-items: center; gap: var(--mtg-space-2); width: 100%; }
.mtg-rowbar__track {
  position: relative; height: 6px; flex: 1; min-width: 3rem;
  background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-pill); overflow: hidden;
}
.mtg-rowbar__fill { position: absolute; inset-block: 0; left: 0; background: var(--mtg-accent); border-radius: var(--mtg-radius-pill); }
.mtg-rowbar[data-tone='negative'] .mtg-rowbar__fill { background: var(--mtg-negative); }
.mtg-rowbar[data-tone='positive'] .mtg-rowbar__fill { background: var(--mtg-positive); }
.mtg-rowbar__value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-size: var(--mtg-text-sm); }
.mtg-withheld { color: var(--mtg-pending); font-size: var(--mtg-text-sm); }

.mtg-delta { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; }
.mtg-delta[data-direction='up'] { color: var(--mtg-positive); }
.mtg-delta[data-direction='down'] { color: var(--mtg-negative); }
.mtg-delta[data-direction='flat'] { color: var(--mtg-ink-faint); }
.mtg-delta[data-direction='none'] { color: var(--mtg-pending); }
`;

const LAYOUT = `
.mtg-subnav { display: flex; flex-wrap: wrap; gap: var(--mtg-space-1); }
.mtg-subnav__item {
  appearance: none; border: 0; cursor: pointer; font: inherit;
  font-size: var(--mtg-text-sm); font-weight: 500;
  padding: var(--mtg-space-1) var(--mtg-space-3);
  color: var(--mtg-ink-muted); background: transparent;
  border-radius: var(--mtg-radius-pill);
  transition: color var(--mtg-duration-fast) var(--mtg-ease), background var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-subnav__item:hover { color: var(--mtg-ink); background: var(--mtg-surface-sunken); }
.mtg-subnav__item[aria-current='page'] { color: var(--mtg-accent-ink); background: var(--mtg-accent); }
.mtg-analysis { display: flex; flex-direction: column; gap: var(--mtg-space-5); }
/* 40rem is the plots' design width: a column narrower than that scales a
   chart down bodily, type and all, so the row stays single-column until two
   plots fit side by side at full size. */
.mtg-analysis__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 40rem), 1fr)); gap: var(--mtg-space-4); align-items: start; }
.mtg-swatch-row { display: inline-flex; align-items: center; gap: var(--mtg-space-2); }
.mtg-swatch-row__name { font-size: var(--mtg-text-sm); }
.mtg-matchup-table { min-width: 48rem; }
.mtg-matchup { min-width: 10rem; vertical-align: top; }
.mtg-matchup__rate { display: flex; flex-direction: column; gap: 2px; font-weight: 650; }
.mtg-matchup__interval, .mtg-matchup__record, .mtg-matchup__plan {
  display: block; margin-top: 2px; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  font-weight: 400; font-variant-numeric: tabular-nums;
}
.mtg-matchup[data-tone='negative'] .mtg-matchup__rate { color: var(--mtg-negative); }
.mtg-matchup[data-tone='healthy'] .mtg-matchup__rate { color: var(--mtg-positive); }
.mtg-matchup--diagonal { text-align: center; color: var(--mtg-ink-faint); }
`;

/*
 * The verdict block.
 *
 * The three state tokens carry the tone, and every one of them sits beside the
 * word it means — `data-tone` never says anything the text does not, so the
 * block reads the same with color removed. The answer is set at display size
 * because it is the one thing on the page somebody came for; everything under
 * it is ordinary body type.
 */
const FAIRNESS = `
.mtg-fairness { display: flex; flex-direction: column; gap: var(--mtg-space-4); }
.mtg-verdict {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  padding: var(--mtg-space-4) var(--mtg-space-5);
  border-radius: var(--mtg-radius-lg);
  background: var(--mtg-surface-sunken);
  border-left: 4px solid var(--mtg-line);
}
.mtg-verdict[data-tone='positive'] { border-left-color: var(--mtg-positive); }
.mtg-verdict[data-tone='negative'] { border-left-color: var(--mtg-negative); }
.mtg-verdict[data-tone='pending'] { border-left-color: var(--mtg-pending); }
.mtg-verdict__ask { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-verdict__answer { font-size: var(--mtg-text-xl); font-weight: 650; line-height: 1.1; }
.mtg-verdict[data-tone='positive'] .mtg-verdict__answer { color: var(--mtg-positive); }
.mtg-verdict[data-tone='negative'] .mtg-verdict__answer { color: var(--mtg-negative); }
.mtg-verdict[data-tone='pending'] .mtg-verdict__answer { color: var(--mtg-pending); }
.mtg-verdict__note { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }

.mtg-readings { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
.mtg-reading {
  padding: var(--mtg-space-3) var(--mtg-space-4);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised);
}
.mtg-reading__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-2); }
.mtg-reading__ask { margin: 0; font-size: var(--mtg-text-md); font-weight: 550; }
.mtg-reading__census { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); margin-left: auto; }

.mtg-finding-list { list-style: none; margin: var(--mtg-space-3) 0 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-finding {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  padding: var(--mtg-space-2) var(--mtg-space-3);
  border-radius: var(--mtg-radius-sm); background: var(--mtg-surface-sunken);
}
.mtg-finding__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-2); }
.mtg-finding__name { font-weight: 550; font-size: var(--mtg-text-sm); }
.mtg-finding__body { font-size: var(--mtg-text-sm); }
.mtg-finding__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
`;

/** The whole route sheet, in cascade order: chart chrome, plot marks, figures, layout. */
export const ANALYSIS_CSS = `${CHART}${PLOT}${FIGURES}${LAYOUT}${FAIRNESS}`;
