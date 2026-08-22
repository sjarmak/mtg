// @vitest-environment jsdom
/**
 * The board's corner marks: what each one draws, and what each one is called.
 *
 * Two of these were reported from play. The summoning-sick mark printed the
 * word SICK and is an hourglass now; the marks that say a face is not showing
 * the card's own numbers did not exist, so a creature holding a weapon was a
 * 3/3 whose card said 1/3 and nothing on screen admitted the difference.
 *
 * Every assertion about a name goes through the accessible tree rather than
 * through the `title` attribute, and that is the point of the file. A badge with
 * a tooltip and no role is a `span`, and a `span` carrying no role is dropped
 * from the tree whatever it is labeled — the same defect `card-face-a11y` found
 * one element up. An icon with no name is that defect made total, because there
 * is not even a word left to fall back to.
 *
 * `play/haste.test.ts` owns the other half of the sick mark, which is the input
 * it reads. This file changes the glyph and never the question.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Battlefield, SICK_MARK_LABEL, permanentMarks } from '../src/board/Battlefield';
import { uiStyleSheet } from '../src/styles/index';
import type { BoardPermanent } from '../src/board/Battlefield';

afterEach(cleanup);

/** 3/5 with reach and trample, so a granted keyword is one it does not print. */
function guardian(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.name === 'Thornhide Guardian');
  if (card === undefined) throw new Error('the DSL example set has no Thornhide Guardian');
  return card;
}

function permanent(extra: Partial<BoardPermanent>): BoardPermanent {
  return { key: 'o1', card: guardian(), ...extra };
}

function show(...permanents: readonly BoardPermanent[]): void {
  render(h(Battlefield, { label: 'Battlefield', permanents }));
}

function markKeys(subject: BoardPermanent): readonly string[] {
  return permanentMarks(subject).map((mark) => mark.key);
}

/** The root tsconfig ships no DOM lib, so a node's own members arrive by cast. */
type Node = ReturnType<typeof screen.getByRole>;

function textOf(node: Node): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

function attributeOf(node: Node, name: string): string | null {
  return (node as unknown as { getAttribute(name: string): string | null }).getAttribute(name);
}

describe('the summoning-sick mark', () => {
  it('draws a picture instead of the word', () => {
    const markup = renderToStaticMarkup(
      h(Battlefield, { label: 'Battlefield', permanents: [permanent({ summoningSick: true })] }),
    );
    expect(markup).toContain('mtg-mark__glyph');
    expect(markup).not.toContain('SICK');
  });

  it('is an image with a name saying what the creature cannot do yet', () => {
    show(permanent({ summoningSick: true }));
    expect(SICK_MARK_LABEL).toBe('Summoning sick: it cannot attack or use tap abilities yet');
    expect(screen.getByRole('img', { name: SICK_MARK_LABEL })).toBeTruthy();
  });

  it('keeps the key the projection is tested by', () => {
    // `play/haste.test.ts` asserts this mark's absence on a hasted creature by
    // key. The glyph moved; the question the mark asks did not.
    expect(markKeys(permanent({ summoningSick: true }))).toContain('sick');
    expect(markKeys(permanent({}))).not.toContain('sick');
  });
});

describe('a size the layer system moved', () => {
  const equipped = permanent({
    stats: { power: 5, toughness: 5 },
    attachments: ['Moonblade'],
  });

  it('says the pair the creature is now, and draws no badge for it', () => {
    show(equipped);
    // The playtester, 2026-08-14: "the modified power toughness from static effects
    // does not need to be repeated on a label in black and white on a card, the
    // underlining of the power and toughness on the card itself is sufficient".
    // So the mark is said and not shown: it is still in the accessibility tree,
    // still carrying both numbers, and it prints nothing.
    const mark = screen.getByRole('img', { name: /^Now 5\/5/ });
    expect(textOf(mark)).toBe('');
    expect(attributeOf(mark, 'data-mark')).toBe('derived');
    expect(attributeOf(mark, 'data-silent')).toBe('true');
  });

  it('keeps the underline it handed the drawing to, and the element that selects it', () => {
    // Two claims, and the second is why the mark is hidden rather than deleted.
    // `styles/board/attach.ts` selects the dotted underline through a `:has()`
    // test for this very mark on the slot's own marks row, so a version that
    // removed the mark would remove the drawing that replaced it.
    //
    // The test is asked of the *slot* rather than followed sideways from the
    // marks row: `mtg-9edk` moved the row after the face in tree order, because
    // the badges are anchored to the card's picture and an anchor has to come
    // first. A following-sibling reach from the row now finds nothing.
    show(equipped);
    expect(screen.getByRole('img', { name: /^Now 5\/5/ })).toBeTruthy();
    const sheet = uiStyleSheet();
    expect(sheet).not.toContain('text-decoration: line-through');
    expect(sheet).toContain(
      ".mtg-slot:has(.mtg-slot__marks .mtg-mark[data-mark='derived']) .mtg-card__pt {\n  text-decoration: underline dotted;",
    );
    // Clipped rather than removed from the tree: `display: none` and
    // `visibility: hidden` both take an element out of the accessibility tree,
    // and this element is the only path a screen reader has to a derived size.
    expect(sheet).toContain(".mtg-mark[data-silent='true'] {\n  position: absolute;");
    expect(sheet).not.toContain(".mtg-mark[data-silent='true'] {\n  display: none");
  });

  it('names what made it that', () => {
    show(equipped);
    expect(screen.getByRole('img', { name: 'Now 5/5, printed 3/5, from Moonblade.' })).toBeTruthy();
  });

  it('names counters as a source too, in the plural they take', () => {
    show(permanent({ stats: { power: 4, toughness: 6 }, counters: 1 }));
    expect(screen.getByRole('img', { name: 'Now 4/6, printed 3/5, from 1 +1/+1 counter.' })).toBeTruthy();
    cleanup();
    show(permanent({ stats: { power: 1, toughness: 3 }, counters: -2 }));
    expect(screen.getByRole('img', { name: 'Now 1/3, printed 3/5, from 2 -1/-1 counters.' })).toBeTruthy();
  });

  it('says the difference and stops when nothing on the board explains it', () => {
    // A pump spell leaves no trace the board can read: the kernel records no
    // provenance for a continuous effect, so naming a source here would be
    // inventing one.
    show(permanent({ stats: { power: 6, toughness: 8 } }));
    expect(screen.getByRole('img', { name: 'Now 6/8, printed 3/5.' })).toBeTruthy();
  });

  it('is absent when the face is already drawing the card', () => {
    expect(markKeys(permanent({ stats: { power: 3, toughness: 5 } }))).not.toContain('derived');
    expect(markKeys(permanent({}))).not.toContain('derived');
  });
});

describe('damage marked on a creature', () => {
  /**
   * `mtg-3rm`'s second half. The badge said `-3`, in the same pill every other
   * mark wears, and a Magic player reads `-3` as a -3/-3 rather than as three
   * damage marked. The unit is on the badge now, and the sentence answers the
   * question the badge is asked during combat: what dies.
   */
  it('says damage rather than a negative number', () => {
    const marks = permanentMarks(permanent({ damage: 3 }));
    const damage = marks.find((mark) => mark.key === 'damage');
    expect(damage?.label).toBe('3 dmg');
    expect(damage?.tone).toBe('negative');
  });

  it('counts what is left before lethal, against the toughness it has now', () => {
    // Printed 3/5, so three damage leaves two.
    show(permanent({ damage: 3 }));
    expect(
      screen.getByRole('img', { name: '3 damage marked against 5 toughness; 2 more is lethal.' }),
    ).toBeTruthy();
    cleanup();
    // And against the current toughness when a layer moved it (CR 704.5g), so a
    // creature holding a weapon is not reported one hit from a death it is not
    // near.
    show(permanent({ damage: 3, stats: { power: 5, toughness: 7 }, attachments: ['Moonblade'] }));
    expect(
      screen.getByRole('img', { name: '3 damage marked against 7 toughness; 4 more is lethal.' }),
    ).toBeTruthy();
  });

  it('says lethal rather than counting past zero', () => {
    // State-based actions have not run yet, so the position is reachable and
    // "0 more is lethal" is not a thing to say to a player.
    show(permanent({ damage: 5 }));
    expect(
      screen.getByRole('img', { name: '5 damage marked against 5 toughness, which is lethal.' }),
    ).toBeTruthy();
  });

  it('is absent when nothing has been dealt', () => {
    expect(markKeys(permanent({ damage: 0 }))).not.toContain('damage');
    expect(markKeys(permanent({}))).not.toContain('damage');
  });
});

describe('a keyword the card does not print', () => {
  it('is a mark that names the keyword and the weapon that granted it', () => {
    show(permanent({ gainedKeywords: ['flying'], attachments: ['Moonblade'] }));
    const mark = screen.getByRole('img', { name: 'Gains flying, from Moonblade.' });
    expect(textOf(mark)).toBe('+flying');
  });

  it('names no source when the grant did not come from something attached', () => {
    // A keyword counter grants keywords, and `counters` is the net +1/+1 count,
    // so listing it would name a source that gave nothing.
    show(permanent({ gainedKeywords: ['vigilance'], counters: 2, stats: { power: 5, toughness: 7 } }));
    expect(screen.getByRole('img', { name: 'Gains vigilance.' })).toBeTruthy();
  });

  it('is absent when nothing was granted', () => {
    expect(markKeys(permanent({}))).not.toContain('granted');
  });
});

describe('a creature staged to attack', () => {
  it('carries a silent mark saying so, since the position it moved to says nothing to a screen reader', () => {
    show(permanent({ staged: true }));
    const mark = screen.getByRole('img', { name: 'Staged to attack; not declared yet.' });
    expect(textOf(mark)).toBe('');
    expect(attributeOf(mark, 'data-mark')).toBe('staged-attack');
    expect(attributeOf(mark, 'data-silent')).toBe('true');
  });

  it('is absent from a creature that was never staged', () => {
    expect(markKeys(permanent({}))).not.toContain('staged-attack');
  });
});

describe('every mark on the table', () => {
  const busy = permanent({
    attacking: true,
    blocking: true,
    summoningSick: true,
    stats: { power: 5, toughness: 5 },
    gainedKeywords: ['flying'],
    attachments: ['Moonblade'],
    counters: 1,
    damage: 2,
  });

  it('is published as an image under the name it carries', () => {
    show(busy);
    for (const mark of permanentMarks(busy)) {
      expect(screen.getByRole('img', { name: mark.title ?? mark.label })).toBeTruthy();
    }
  });

  it('keeps its tooltip, which an aria-label is not — unless it draws nothing', () => {
    show(busy);
    for (const mark of permanentMarks(busy)) {
      const name = mark.title ?? mark.label;
      // A silent mark is not under the pointer, so it carries no tooltip: a
      // `title` on a box clipped to one pixel is a tooltip nobody can reach.
      // Its `aria-label` is the whole of it, and the loop still checks that.
      if (mark.silent === true) {
        expect(screen.queryAllByTitle(name)).toHaveLength(0);
        expect(screen.getAllByLabelText(name).length).toBeGreaterThan(0);
        continue;
      }
      expect(screen.getAllByTitle(name).length).toBeGreaterThan(0);
    }
  });

  it('comes in a fixed order', () => {
    expect(markKeys(busy)).toEqual([
      'attacking',
      'blocking',
      'sick',
      'derived',
      'granted',
      'counters',
      'damage',
    ]);
  });
});

describe('counters on the wrong side of zero', () => {
  it('are drawn, where the old test for a positive count drew nothing', () => {
    // Net, so two -1/-1 counters are -2. They used to be invisible while the
    // creature they were shrinking lost two points of every number it had.
    const marks = permanentMarks(permanent({ counters: -2 }));
    const counters = marks.find((mark) => mark.key === 'counters');
    expect(counters?.label).toBe('-2');
    expect(counters?.tone).toBe('negative');
  });

  it('leave a permanent with none of them unmarked', () => {
    expect(markKeys(permanent({ counters: 0 }))).not.toContain('counters');
  });
});

describe('planeswalker loyalty', () => {
  it('is a named board mark rather than an invisible counter', () => {
    const loyalty = permanentMarks(permanent({ loyalty: 4 })).find((mark) => mark.key === 'loyalty');
    expect(loyalty).toMatchObject({ label: 'L4', title: '4 loyalty counters.', tone: 'neutral' });
  });
});

/**
 * Where the badges are drawn, which is a question about boxes.
 *
 * **This file proves no pixel and cannot**: jsdom performs no layout, so
 * `getBoundingClientRect` is all zeros here and nothing rendered in vitest can
 * say that one box covers another. That is exactly how `mtg-9edk` shipped —
 * `ca9ce2b` moved the title bar above the art and the badges, pinned to the
 * slot's own corner, went from sitting on the picture to sitting on the first
 * letters of the name, with every board test in this package green.
 *
 * **The pixels are `../tools/corner-marks.ts`**, driven over CDP in
 * chrome-headless-shell 151 at 1440x900, 1280x800 and 1024x768, four and eight
 * permanents a side, upright and tapped, dealt from the flagship set with every
 * permanent summoning sick and carrying damage. It counts *letters* rather than
 * pixels — a character rect from a `Range` over the name's own text node,
 * intersected with the badges — because letters are the unit the complaint was
 * written in. Ten of its twelve boards went from every face losing letters to
 * none losing any; the two that did not are all-tapped boards of eight a side
 * where the picture itself is 17.4px across.
 *
 * What is checkable without a browser is the arrangement those pixels come out
 * of, and it is two things: the row is anchored to the picture, and it is still
 * a child of the slot rather than of the face.
 */
describe('where the marks row sits', () => {
  it('stays outside the face, because a button hides its own children from a reader', () => {
    // Not housekeeping: WAI-ARIA gives the button role presentational children,
    // so a badge moved inside an interactive face would be stripped from the
    // accessibility tree — and these badges are the only path a screen reader
    // has to the three facts the drawing carries silently. So the row is drawn
    // beside the face and anchored to it, rather than in it.
    const markup = renderToStaticMarkup(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [permanent({ summoningSick: true, damage: 2 })],
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('<button');
    const face = markup.indexOf('<button');
    const row = markup.indexOf('mtg-slot__marks');
    expect(row).toBeGreaterThan(-1);
    // After the face, which is what makes the face an acceptable anchor for it:
    // an anchor has to precede the element positioned against it in tree order.
    expect(row).toBeGreaterThan(face);
    expect(markup.slice(face, row)).toContain('</button>');
  });

  it('is anchored to the card art window rather than to the slot corner', () => {
    const sheet = uiStyleSheet();
    // The window is the region with no text under it, which is the argument the
    // face already made when it put the mana cost in the other corner.
    expect(sheet).toContain(".mtg-card[data-size='board'] > .mtg-art,");
    expect(sheet).toContain('anchor-name: --mtg-art-anchor;');
    expect(sheet).toContain('position-anchor: --mtg-art-anchor;');
    // Scoped to the slot, or a slot's badges would resolve against the last
    // card in the document rather than their own. Both names are scoped: the
    // row ends where the mana cost begins, so it reads the cost's anchor too.
    expect(sheet).toContain('.mtg-slot { anchor-scope: --mtg-art-anchor, --mtg-cost-anchor; }');
    expect(sheet).toContain('inset-inline-end: anchor(--mtg-cost-anchor start);');
    // And the guard tests the scope rather than the name, for that reason.
    expect(sheet).toContain('@supports (anchor-scope: --mtg-art-anchor) {');
    expect(sheet).toContain('@supports not (anchor-scope: --mtg-art-anchor) {');
  });

  it('lets a badge break its text only where the picture is a rotated strip', () => {
    const sheet = uiStyleSheet();
    // Upright, the picture is at least a badge wide, so "1 dmg" stays one pill
    // rather than folding into a two-line blob. Tapped, the picture is a
    // quarter-turn strip narrower than a badge, and breaking is the only way a
    // mark fits on it: forbidding the break there put letters back over the
    // name. ../tools/corner-marks.ts has both readings.
    expect(sheet).toContain(
      ".mtg-slot:not([data-tapped='true']) > .mtg-slot__marks .mtg-mark {\n  white-space: nowrap;\n}",
    );
    // Which means the badge itself declares no wrapping rule at all.
    const badge = sheet.indexOf('.mtg-mark {');
    expect(badge).toBeGreaterThan(-1);
    expect(sheet.slice(badge, sheet.indexOf('}', badge))).not.toContain('white-space');
  });

  it('leaves the corner placement as the floor, so an unsupporting browser is where it was', () => {
    const sheet = uiStyleSheet();
    const row = sheet.indexOf('.mtg-slot__marks {');
    expect(row).toBeGreaterThan(-1);
    const declared = sheet.slice(row, sheet.indexOf('}', row));
    expect(declared).toContain('inset-inline-start: var(--mtg-space-1)');
    expect(declared).toContain('inset-block-start: var(--mtg-space-1)');
  });
});
