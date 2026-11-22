/**
 * A face's type is a share of its width, and a percentage width is not a width.
 *
 * `mtg-dcxg.13` made the rules text (and the chrome around it) proportional to
 * `--card-w`, which is what stopped a 366px phone face growing a 191px rules box
 * around 42px of type. The trap it opened is a CSS one: several panels set
 * `--card-w: 100%` to make a face fill their column, and a percentage inside a
 * `font-size` is a percentage of the *parent's type*, not of any width. The
 * draft rail hit it immediately — the whole declaration went invalid, the name
 * inherited 16px, and the title bar cut a name it had drawn whole for months.
 *
 * So the rule is stated here rather than left to whoever writes the next panel:
 * a selector that gives `--card-w` a percentage pins `--rules-type` back to the
 * token in the same block. Read off the sheet's source, because that is where
 * the pairing has to hold; the browser gates
 * (`./card-fit-width.browser.test.ts`, `./draft/rail-card-phone.browser.test.ts`)
 * measure what it buys.
 */
import { describe, expect, it } from 'vitest';
import { uiStyleSheet } from '../src/styles/index';

/** One declaration block's body, for every block that sets `--card-w`. */
function blocksSettingCardWidth(sheet: string): readonly string[] {
  const blocks: string[] = [];
  for (const match of sheet.matchAll(/\{([^{}]*--card-w[^{}]*)\}/g)) {
    const body = match[1];
    if (body !== undefined) blocks.push(body);
  }
  return blocks;
}

describe('the face type channel', () => {
  const sheet = uiStyleSheet();

  it('finds the blocks it means to check', () => {
    expect(blocksSettingCardWidth(sheet).length).toBeGreaterThan(4);
  });

  it('pins the type back to the token wherever the width is a percentage', () => {
    const offenders = blocksSettingCardWidth(sheet).filter(
      (body) => /--card-w:\s*[^;]*%/.test(body) && !body.includes('--rules-type:'),
    );
    expect(
      offenders,
      `a percentage --card-w without a --rules-type beside it: ${offenders.join(' | ')}`,
    ).toEqual([]);
  });

  it('sets the channel off the width once, at the face', () => {
    expect(sheet).toContain('--rules-type: max(var(--mtg-text-sm), calc(var(--card-w) *');
  });
});
