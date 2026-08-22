/**
 * A gallery of one full card face per identity, in both themes, as static HTML.
 *
 * The running app cannot show the dark palette: every route registers the paper
 * palette for both themes (`SCOPED_PALETTES` in `../src/styles/tokens.ts`), which
 * is the decision `mtg-bc2.46` took and not something to work around in the
 * browser. So a frame review that has to see both halves of the palette renders
 * the real `Card` component through the real `uiStyleSheet()` into a page with
 * nothing else on it, and pins the theme on the root element the way a viewer's
 * `data-theme` would.
 *
 * Node-only, like everything else under `tools/`. Writes files and opens no
 * browser; the reviewer points one at the output.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { uiStyleSheet } from '../src/styles/index';
import { COLOR_IDENTITIES, IDENTITY_LABELS } from '../src/styles/tokens';
import type { ColorIdentity } from '../src/styles/tokens';
import type { ArtResolver } from '../src/lab/art-manifest';
import { readFrameReviewArgs } from './frame-review-args';
import { artResolverFor, facesOf } from './frame-review-faces';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const FIXTURE = join(REPO_ROOT, 'packages', 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json');

function page(
  theme: 'light' | 'dark',
  cards: ReadonlyMap<ColorIdentity, DslCard>,
  art: ArtResolver | null,
): string {
  const tiles = COLOR_IDENTITIES.map((identity) => {
    const card = cards.get(identity);
    const label = `<p class="frame-review__label">${IDENTITY_LABELS[identity]}</p>`;
    const face =
      card === undefined
        ? '<p class="frame-review__missing">no card of this identity in the set</p>'
        : renderToStaticMarkup(createElement(Card, { card, art: art?.(card) ?? null }));
    return `<div class="frame-review__tile">${label}${face}</div>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head><meta charset="utf-8"><title>Frame review, ${theme}</title>
<style>${uiStyleSheet()}
body { margin: 0; padding: 24px; background: var(--mtg-surface-page); color: var(--mtg-ink);
  font-family: var(--mtg-font-ui); }
.frame-review { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.frame-review__tile { display: flex; flex-direction: column; gap: 8px; }
.frame-review__label { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.frame-review__missing { margin: 0; color: var(--mtg-ink-faint); }
</style></head>
<body><div class="frame-review">${tiles}</div></body></html>
`;
}

const args = readFrameReviewArgs(process.argv.slice(2));
const out = args.out ?? join(REPO_ROOT, 'out', 'frame-review');
const setPath = args.set ?? FIXTURE;
// The tool used to review `tideglass-reach.set.json` regardless of what a
// caller passed, and said nothing — its report read like a real review of
// whatever set was named. Printing the resolved path on every run, including
// the unstated default, is what makes that silent substitution loud instead.
console.log(`reviewing frames for ${setPath}${args.set === undefined ? ' (default set, none named)' : ''}`);
mkdirSync(out, { recursive: true });
const cards = facesOf(JSON.parse(readFileSync(setPath, 'utf8')), setPath);
const art =
  args.artManifest === undefined
    ? null
    : artResolverFor(JSON.parse(readFileSync(args.artManifest, 'utf8')), args.artManifest);
for (const theme of ['light', 'dark'] as const) {
  const file = join(out, `gallery-${theme}.html`);
  writeFileSync(file, page(theme, cards, art), 'utf8');
  console.log(`wrote ${file}`);
}
console.log(
  `identities found: ${[...cards.keys()].join(' ')}`,
  `missing: ${COLOR_IDENTITIES.filter((identity) => !cards.has(identity)).join(' ') || 'none'}`,
);
