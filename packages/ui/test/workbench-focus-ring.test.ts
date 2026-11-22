/**
 * The workbench's two scrollports, and the three pixels they used to eat.
 *
 * Found by the playtester clicking into the prompt box on the running lab: the blue
 * focus ring was closed on the top, right and bottom and flat on the left.
 * `.mtg-workbench__left` and `.mtg-workbench__right` declare `overflow-y: auto`,
 * which forces the *used* `overflow-x` to `auto` as well — a box cannot clip one
 * axis and overflow the other — so each column clips its own inline start edge.
 * Every control in the column sits flush against that edge, and `base.ts` draws
 * a 2px ring at a 1px offset, so exactly 3px of it fell outside the box and was
 * cut. Measured on the running lab at 1600x1000: the textarea's border box began
 * at x=21 and so did the pane's content box.
 *
 * jsdom lays nothing out, so this file does not measure the ring; it checks the
 * two facts a sheet can state and a browser cannot re-derive for us — that the
 * scrollport pads its start edge at all, and that what it pads is at least as
 * wide as the ring that has to fit there. The second half is the one worth
 * having: a ring widened in `base.ts` would silently start clipping again, and
 * this fails naming both numbers instead.
 */
import { describe, expect, it } from 'vitest';
import { BASE_CSS } from '../src/styles/base';
import { WORKBENCH_CSS } from '../src/styles/workbench';
import { TOKEN_CSS } from '@mtg/render-spec';

/** The one root font size every rem in this workspace is resolved against. */
const ROOT_PX = 16;

function declarationsOf(sheet: string, selector: string): string {
  // The selector as it is written, then the block that follows it. Anchored on
  // the brace so a selector that is a prefix of another one cannot match it.
  const at = sheet.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = sheet.indexOf('{', at);
  const close = sheet.indexOf('}', open);
  if (close < 0) throw new Error(`unterminated rule for ${selector}`);
  return sheet.slice(open + 1, close);
}

/** A space token's value in CSS pixels, read off the scale rather than assumed. */
function spacePx(token: string): number {
  const found = new RegExp(`--${token}:\\s*([0-9.]+)rem`).exec(TOKEN_CSS);
  if (found?.[1] === undefined) throw new Error(`no --${token} in the token scale`);
  return Number(found[1]) * ROOT_PX;
}

/** How far outside its border box a focused input's ring reaches. */
function ringReachPx(): number {
  const block = declarationsOf(BASE_CSS, '.mtg-input:focus-visible');
  const width = /outline:\s*([0-9.]+)px/.exec(block);
  const offset = /outline-offset:\s*([0-9.]+)px/.exec(block);
  if (width?.[1] === undefined || offset?.[1] === undefined) {
    throw new Error(`.mtg-input:focus-visible no longer states a width and an offset: ${block}`);
  }
  return Number(width[1]) + Number(offset[1]);
}

describe('the workbench scrollports', () => {
  it('pad both inline sides, because each side clips something different', () => {
    // The end pads the scrollbar and always did. The start pads the ring, and
    // its absence is the whole defect: `padding-inline-end` alone reads as
    // complete and leaves the other edge at zero.
    const block = declarationsOf(WORKBENCH_CSS, '.mtg-workbench__left,\n.mtg-workbench__right');

    expect(block).toContain('overflow-y: auto');
    expect(/padding-inline:\s*var\(--mtg-space-\d\)\s+var\(--mtg-space-\d\)/.test(block)).toBe(true);
  });

  it('pad the start edge by at least as much as a focus ring reaches', () => {
    // Both halves are read rather than written down: widen the ring in
    // `base.ts` or shrink the token here and this fails with both numbers in it.
    const block = declarationsOf(WORKBENCH_CSS, '.mtg-workbench__left,\n.mtg-workbench__right');
    const start = /padding-inline:\s*var\(--(mtg-space-\d)\)/.exec(block);
    if (start?.[1] === undefined) throw new Error(`no padding-inline start token: ${block}`);

    expect(spacePx(start[1])).toBeGreaterThanOrEqual(ringReachPx());
  });
});
