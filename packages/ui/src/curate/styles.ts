/**
 * The grid's own sheet, deliberately not the lab's.
 *
 * `styles/index.ts` is the shell's cascade and every token in it is measured by
 * `test/theme.test.ts` per route. This page is not a route: it is a tool one
 * person opens on a tablet to look at 423 pictures, it mounts its own document,
 * and folding it into the shell's sheet would put a curation control in every
 * palette assertion the lab makes about the play surface.
 *
 * The colors are still the lab's, drawn from `TOKEN_CSS` and named through
 * `var()` rather than written out here. `test/tokens.test.ts` refuses a raw
 * color literal anywhere under `src/`, and it is right to: a second palette is
 * how a tool page ends up light where the rest of the build is dark, and this
 * one is looked at beside the cards it is choosing pictures for.
 *
 * Sized for a thumb rather than a pointer. The tap targets are the thumbnails
 * themselves at 260px of source served into a 150px-minimum cell, and the two
 * per-card controls are 44px tall, which is the floor a finger needs.
 */
import { TOKEN_CSS } from '../styles/tokens';

const LAYOUT_CSS = `
:root { color-scheme: light dark; }
body {
  margin: 0; font: 15px/1.4 system-ui, sans-serif;
  background: var(--mtg-surface-page); color: var(--mtg-ink);
}
.curate__bar {
  position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center;
  padding: 10px 14px; background: var(--mtg-surface-rail);
  border-bottom: 1px solid var(--mtg-line);
}
.curate__title { font-weight: 600; margin-right: auto; }
.curate__button {
  min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--mtg-line-strong);
  background: var(--mtg-surface-raised); color: inherit; font: inherit; cursor: pointer;
}
.curate__button[disabled] { opacity: 0.45; cursor: default; }
.curate__status {
  padding: 8px 14px; background: var(--mtg-surface-inset);
  border-bottom: 1px solid var(--mtg-negative); color: var(--mtg-ink);
}
.curate__cards { display: grid; gap: 18px; padding: 14px; }
.curate__card {
  border: 1px solid var(--mtg-line); border-radius: 10px; padding: 10px;
  background: var(--mtg-surface-raised);
}
.curate__name { font-weight: 600; margin: 0 0 8px; }
.curate__candidates { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.curate__candidate { position: relative; }
.curate__pick {
  display: block; width: 100%; padding: 0; border: 2px solid transparent; border-radius: 8px;
  background: none; cursor: pointer; overflow: hidden;
}
.curate__pick[aria-pressed='true'] { border-color: var(--mtg-accent); }
.curate__pick img { display: block; width: 100%; height: auto; border-radius: 6px; }
.curate__rank {
  position: absolute; top: 6px; left: 6px; min-width: 26px; height: 26px; border-radius: 13px;
  background: var(--mtg-accent); color: var(--mtg-accent-ink); font-weight: 700;
  display: grid; place-items: center;
}
.curate__compare {
  position: absolute; right: 6px; bottom: 6px; min-height: 34px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--mtg-line-strong); background: var(--mtg-surface-raised);
  color: inherit; font: inherit; cursor: pointer;
}
.curate__full {
  position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; gap: 12px;
  background: var(--mtg-surface-sunken); padding: 16px;
}
.curate__full img { max-width: 100%; max-height: 80vh; }
.curate__empty { padding: 24px 14px; }
.curate__picker {
  margin-top: 10px; padding: 10px; border-radius: 8px; border: 1px solid var(--mtg-line-strong);
  background: var(--mtg-surface-inset); display: grid; gap: 10px;
}
.curate__causes { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.curate__cause {
  min-height: 44px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--mtg-line-strong);
  background: var(--mtg-surface-raised); color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.curate__cause[aria-pressed='true'] { border-color: var(--mtg-accent); background: var(--mtg-accent); color: var(--mtg-accent-ink); }
.curate__note-label { font-weight: 600; }
.curate__note { min-height: 60px; padding: 8px; border-radius: 8px; border: 1px solid var(--mtg-line-strong); font: inherit; }
.curate__picker-actions { display: flex; flex-wrap: wrap; gap: 8px; }
`;

/** The palette this page shares with the lab, then the grid's own arrangement. */
export const CURATE_CSS = `${TOKEN_CSS}${LAYOUT_CSS}`;
