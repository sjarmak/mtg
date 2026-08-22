// @vitest-environment jsdom
/**
 * The hand is the largest thing on screen, and it is sized from the width it has
 * rather than from the height it was left.
 *
 * `mtg-rgc.5`: Magic Online draws hand cards substantially larger than
 * battlefield cards, because the battlefield is a summary you scan and the hand
 * is the thing you are deciding from. Ours drew the two at exactly the same size
 * — measured at 1440x900 with four permanents a side, 130.6 x 182.4 in both
 * zones — and at 1024x768 the hand was the *smaller* of the two, 77.2 against
 * 99.1.
 *
 * **What this file proves, and what it cannot.** jsdom performs no layout:
 * `getBoundingClientRect` is all zeros, container queries are never evaluated,
 * and no percentage is ever resolved. So nothing here can say a hand card came
 * out 136.6px wide. What it can say is that the declarations the size rests on
 * are on the elements they have to be on, are scoped to the played table, and
 * are not quietly reintroducing the defect the pair of them exists to prevent.
 * `../card-uniformity.test.ts` makes the same bargain about the same face and
 * says so at greater length.
 *
 * The numbers are read in a real browser, and the rig is committed so they can
 * be taken again rather than trusted:
 *
 *     npx tsx packages/ui/tools/hand-scale.ts out/hand-scale \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * chrome-headless-shell 151, the flagship set, a seven-card hand, four/eight/
 * twelve permanents a side. Hand face against the viewer's battlefield face at
 * four a side, when `mtg-rgc.5` landed: 1440x900 130.6 / 130.6 became 136.6 /
 * 108.5, 1280x800 106.7 / 106.7 became 113.7 / 87.8, and 1024x768 77.2 / 99.1
 * became 77.1 / 72.5.
 *
 * **Those three pairs are a record of that change and are not what the sheet
 * draws today**, which is the distinction `mtg-ypz` is about: two lanes have
 * moved the same faces since. As of `mtg-b8e` (2026-08-14), at four a side and
 * reading width : width, 1440x900 is 124 / 99.2, 1280x800 103.2 / 82.6, 1024x768
 * 71.5 / 68 and 810x1080 48 / 48. What is stable across all four lanes, and is
 * what this file actually asserts, is the *shape*: the hand takes a share of its
 * own row, the battlefield takes a bounded share of the same seventh, and no
 * declaration on the played table sizes a hand card off the column's height.
 * Re-read the four pairs with the rig above before quoting them.
 *
 * Two lanes moved them again. As of `mtg-s3re` (2026-08-16), read off
 * `./hand-allocation.browser.test.ts` on the neutral example set at four a side:
 * 1440x900 is 120 / 124, 1280x800 88 / 100 and 1024x768 88 / 96.7. The share is
 * still a share and is now a *floor* as well — a held card takes the larger of a
 * seventh of its row and a complete face, because a seventh of a 1024px row drew
 * no rules text at all — so the sentence this file makes about the shape has one
 * more clause in it and is otherwise the sentence it was.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { GameSession } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { CARD_TRIM_MM } from '../../src/card/anatomy';
import { Shell } from '../../src/app/Shell';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { PlayView } from '../../src/routes/play/PlayView';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { uiStyleSheet } from '../../src/styles/index';
import { SHORT_VIEWPORT_QUERY, TABLE } from '../../src/styles/board/geometry';

afterEach(cleanup);

const SHEET = uiStyleSheet();

/**
 * The short-viewport tier, sliced by its own prelude the way
 * `./phone-layout.test.ts` slices the phone one.
 *
 * `mtg-l4w0` put a second qualification of the equal split inside it, and a
 * media prelude sits on a line of its own: a match on the selector's *prefix*
 * reads a rule in here as an unconditional one and cannot tell the difference.
 * So the rules in here are found by where they are rather than by what they say.
 */
const SHORT_VIEWPORT_AT = SHEET.indexOf(`@media ${SHORT_VIEWPORT_QUERY} {`);
const SHORT_VIEWPORT_END = SHORT_VIEWPORT_AT < 0 ? -1 : SHEET.indexOf('\n}', SHORT_VIEWPORT_AT);
const SHORT_VIEWPORT = SHORT_VIEWPORT_AT < 0 ? '' : SHEET.slice(SHORT_VIEWPORT_AT, SHORT_VIEWPORT_END);

/** Whether a match landed inside that tier. */
function inShortViewport(at: number | undefined): boolean {
  if (at === undefined || SHORT_VIEWPORT_AT < 0) return false;
  return at > SHORT_VIEWPORT_AT && at < SHORT_VIEWPORT_END;
}

/** Every declaration block the sheet writes for a selector, joined. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...SHEET.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))];
  if (found.length === 0) throw new Error(`the sheet declares nothing for ${selector}`);
  return found.map((match) => match[1] ?? '').join('\n');
}

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  innerHTML: string;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly appendChild: (child: ElementLike) => void;
  textContent: string;
}

interface DocumentLike {
  readonly head: ElementLike;
  readonly body: ElementLike;
  readonly createElement: (tag: string) => ElementLike;
}

interface WindowLike {
  readonly document: DocumentLike;
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/**
 * The window, reached structurally rather than through global types, because the
 * workspace tsconfig has no `lib: dom`. `./fit.ts` declares its own shape for
 * the same reason; this one needs less of it.
 */
function windowLike(): WindowLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  return { document, getComputedStyle: candidate.getComputedStyle };
}

/**
 * The same table drawn twice, once as the played route and once under a mode
 * that draws no table. Every rule this file is about is scoped, so the second
 * render is what says so: a hand sizing rule that escaped onto a route with no
 * board would fail here rather than being found in a screenshot.
 *
 * The control is the Cards tab rather than the replay viewer, and `mtg-ryix` is
 * why: the replay board is under the same height budget now and reads these very
 * rules, which is the whole of "the sizing matches the play sizing view". What it
 * does with its *hand* row differs and is stated in `styles/replay.ts`, because a
 * replay draws two of them face up and the played table draws one.
 */
function paint(): { readonly play: ElementLike; readonly control: ElementLike } {
  const { document } = windowLike();
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const table = (mode: 'play' | 'cards'): string =>
    renderToStaticMarkup(
      h(Shell, { mode, onSelectMode: () => undefined, children: h(PlayRoute, { config: game.config }) }),
    );
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = SHEET;
  document.head.appendChild(style);
  document.body.innerHTML = `${table('play')}${table('cards')}`;
  const play = document.body.querySelector("[data-mtg-mode='play']");
  const control = document.body.querySelector("[data-mtg-mode='cards']");
  if (play === null || control === null) throw new Error('a shell did not render');
  return { play, control };
}

/**
 * The played table with a hand of three, which is where the empty places are.
 * A dealt game holds an opening hand and fills the rail exactly, so the marker
 * this file is about does not appear on it at all.
 */
function paintShortHand(): ElementLike {
  const { document } = windowLike();
  const hand = EXAMPLE_CARDS.slice(0, 3);
  const built = scenario({ seed: 'hand-scale/short', battlefield: [], hands: [hand, hand], active: 0 });
  const session: GameSession = {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    beat: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    committed: null,
  };
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = SHEET;
  document.head.appendChild(style);
  document.body.innerHTML = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const play = document.body.querySelector("[data-mtg-mode='play']");
  if (play === null) throw new Error('the shell did not render');
  return play;
}

function one(root: ElementLike, selector: string): ElementLike {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`nothing matched ${selector}`);
  return found;
}

function computed(element: ElementLike, property: string): string {
  return windowLike().getComputedStyle(element).getPropertyValue(property);
}

const HELD = ".mtg-slot[data-slot='hand']:not([data-empty='true'])";

/** The attribute the played table's rules are scoped under, from the one source. */
/**
 * The scope these rules are emitted under, read off the sheet's own constant.
 *
 * `TABLE` rather than `routeScope('play')` since `mtg-ryix`: the mat's rules now
 * carry the played table and the replay viewer together, and a literal prefix
 * here would be a second statement of which routes they reach — which is exactly
 * the pair that drifts.
 */
const PLAY_SCOPE = TABLE;

describe('the hand is sized from its row rather than from a share of the column', () => {
  /**
   * The claim is one number, so it is written once. A hand slot's cap and the
   * battlefield's width basis divide the row by the same count and subtract the
   * same gap, so both zones respond to the same available width. If somebody
   * changes how many cards the hand lays out across, or which spacing step sits
   * between two cards, and edits only one of them, the ratio silently stops
   * being the ratio and this fails.
   *
   * The gap token is asserted rather than assumed because naming the wrong one
   * is most of `mtg-d6s`. `../../src/styles/board/fit.ts` sets
   * `gap: var(--mtg-space-1)` on a play-route *zone*, where it sits between the
   * head and the body; the gap between two cards is `./zone.ts`'s
   * `.mtg-zone__body`, which nothing on this route overrides, and it is a step
   * wider. Every cap here subtracted the smaller one and came out 3.4px looser
   * than it asked for — 5% at 1024x768.
   *
   * The battlefield states that seventh as `--hand-slot` and its face as a
   * function of it (`mtg-b8e`), so what has to agree is the two rows' arithmetic
   * rather than the one expression the cap used to be.
   *
   * The hand's seventh is a `width` inside a `max()` since `mtg-s3re` rather
   * than the bare `max-width` it was: the slot now takes the larger of that
   * seventh and a complete face, and a maximum has no way to say the second
   * half. What this test is about does not move — both rows still divide the
   * same row width by the same count and subtract the same gap — so the regex
   * follows the expression rather than the assertion following the regex.
   *
   * The optional term before the gap is `mtg-u9uc`'s: the hand subtracts what a
   * shut side panel handed the lane back, so the two rows no longer divide the
   * *same* width and that is the fix rather than a drift. What still has to
   * agree, and what this test still holds them to, is the count and the gap.
   */
  it('divides the hand row and the board curve by the same count and gap', () => {
    const share = String.raw`\(100% (?:[-+] var\(--[a-z-]+\) )?- (\d+) \* var\((--mtg-space-\d)\)\) \/ (\d+)`;
    const slotRule = declarations(`${PLAY_SCOPE} ${HELD}`).replace(/\s+/g, ' ');
    const compactSheet = SHEET.replace(/\s+/g, ' ');
    const across = new RegExp(
      String.raw`width: min\(\s*var\(--hand-face-cap\),\s*max\(\s*calc\(${share}`,
    ).exec(slotRule);
    const board = [
      ...compactSheet.matchAll(
        new RegExp(String.raw`--hand-slot: min\(\s*var\(--board-width-basis-cap\),\s*calc\(${share}`, 'g'),
      ),
    ];
    expect(across, 'the hand slot declares no seventh of its row').not.toBeNull();
    expect(board.length, 'the battlefield declares no seventh of its own row').toBeGreaterThan(0);
    // One per seat, and each of them divides the row the hand's way.
    for (const seat of board) {
      expect(seat[3]).toBe(across?.[3]);
      expect(seat[1]).toBe(across?.[1]);
      expect(seat[2]).toBe(across?.[2]);
    }
    // And the gap the cap subtracts is one fewer than the count, because six
    // gaps sit between seven cards.
    expect(Number(across?.[1])).toBe(Number(across?.[3]) - 1);
  });

  it('caps a wide hand instead of letting every extra viewport pixel enlarge it', () => {
    const cap = /--hand-face-cap:\s*([\d.]+)rem/.exec(SHEET)?.[1];
    expect(cap, 'the hand has no absolute readable ceiling').toBeDefined();
    expect(Number(cap), 'the hand ceiling is larger than a full card face').toBeLessThan(15.25);
    const boardCap = /--board-face-max:\s*([\d.]+)rem/.exec(SHEET)?.[1];
    const boardBasisCap = /--board-width-basis-cap:\s*([\d.]+)rem/.exec(SHEET)?.[1];
    expect(
      Number(boardCap),
      'the battlefield ceiling lets held cards dominate combat permanents',
    ).toBeGreaterThanOrEqual(Number(cap));
    expect(
      Number(boardBasisCap),
      'shrinking the hand also shrinks the battlefield width basis',
    ).toBeGreaterThan(Number(cap));
    const crowdedHandCap = /:has\([^}]*nth-child\(8\)[^{]*\{\s*--hand-face-cap:\s*([\d.]+)rem/.exec(
      SHEET,
    )?.[1];
    const crowdedBoardCap = /nth-child\(8\)[^{]*\{\s*--board-face-max:\s*([\d.]+)rem/.exec(SHEET)?.[1];
    expect(
      Number(crowdedBoardCap),
      'a crowded battlefield shrinks below the hand it must visually outrank',
    ).toBeGreaterThanOrEqual(Number(crowdedHandCap));
  });

  /**
   * The gap the caps subtract is the one the row actually spends. Read off the
   * element rather than off the sheet, because the row's gap arrives from
   * `../../src/styles/board/zone.ts` and the cap is written in `./hand.ts`, so a
   * comparison of two strings in one file would prove they agree with each other
   * rather than with the layout. jsdom resolves neither the percentage nor the
   * ratio, and it does resolve a token to its declared length, which is exactly
   * the one thing this needs.
   */
  it('subtracts the gap the hand row actually spends', () => {
    const spent = /gap: var\((--mtg-space-\d)\)/.exec(declarations('.mtg-zone__body'))?.[1];
    const subtracted = /var\((--mtg-space-\d)\)/.exec(declarations(`${PLAY_SCOPE} ${HELD}`))?.[1];
    expect(spent, 'the row between two cards declares no gap').toBeDefined();
    expect(subtracted, 'the hand cap subtracts no spacing token at all').toBeDefined();
    expect(subtracted).toBe(spent);
    // And nothing on this route narrows that gap back down again, which is the
    // reading that made the wrong token look right.
    for (const match of SHEET.matchAll(/\.mtg-zone__body[^{]*\{([^}]*)\}/g)) {
      const narrowed = /(?:^|[;\s])gap: var\((--mtg-space-\d)\)/.exec(match[1] ?? '')?.[1];
      if (narrowed !== undefined) expect(narrowed).toBe(spent);
    }
  });

  /**
   * The invariant that reintroduces the defect when it is dropped. A box with a
   * preferred aspect ratio takes its content as its automatic minimum size (CSS
   * Sizing 4) and a minimum beats a maximum, so a hand slot that kept
   * `../../src/styles/board/fit.ts`'s `MIN_SLOT_REM` height floor beside the
   * ratio would grow to fit its words at exactly the crowdings where the floor
   * binds. The floor has to be put back to zero explicitly, in the same block.
   */
  it('declares the ratio and a zero minimum together on a hand slot', () => {
    const slot = declarations(`${PLAY_SCOPE} ${HELD}`);
    expect(slot).toContain(`aspect-ratio: ${String(CARD_TRIM_MM.width)} / ${String(CARD_TRIM_MM.height)}`);
    expect(slot, 'the ratio alone is overruled by the content-based minimum').toContain('min-height: 0');
    const face = declarations(`${PLAY_SCOPE} ${HELD} > .mtg-card`);
    expect(face).toContain(`aspect-ratio: ${String(CARD_TRIM_MM.width)} / ${String(CARD_TRIM_MM.height)}`);
    expect(face).toContain('min-height: 0');
  });

  it('takes the hand off the height axis and leaves the board on it', () => {
    expect(
      declarations(`${PLAY_SCOPE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail']`),
      'the hand row still claims a share of the column',
    ).toContain('flex: none');
    expect(
      declarations(`${PLAY_SCOPE} ${HELD}`),
      'a card in hand is shrunk by a crowded row instead of scrolling out of it',
    ).toContain('flex: 0 0 auto');
    expect(
      declarations(`${PLAY_SCOPE} ${HELD}`),
      'the hand slot states no width, so a share of the row is all it can be',
    ).toContain('width: min(');
  });

  /**
   * And the rules reach the hand and stop at the route. The properties asserted
   * here are the ones jsdom resolves without laying anything out — a `flex`
   * shorthand is not among them, which is why the shares above are read off the
   * sheet and the shape is read off the element.
   */
  it('sizes a held card on the played table and nowhere else', () => {
    const { play, control } = paint();
    const held = one(play, HELD);
    expect(computed(held, 'aspect-ratio'), 'a hand slot keeps the printed trim').toBe(
      `${String(CARD_TRIM_MM.width)} / ${String(CARD_TRIM_MM.height)}`,
    );
    expect(computed(held, 'height'), 'and takes its height from that trim').toBe('auto');
    expect(computed(held, 'min-height'), "and drops fit.ts's height floor").toBe('0px');
    // Off the route the rail is the fixed compact card it always was: a replay
    // frame is read down a page, has no height budget to divide, and has no hand
    // to size anything against.
    const frame = one(control, ".mtg-slot[data-slot='hand']");
    expect(computed(frame, 'aspect-ratio')).toBe('auto');
    expect(computed(frame, 'min-height')).not.toBe('0px');
  });

  /**
   * `mtg-ej5` measured a hand of two in a rail of seven as five card-sized
   * dashed rectangles and made an empty place a marker instead. That rule and
   * this one weigh the same, and this one is later in the cascade, so the
   * exclusion is what keeps the marker a marker. The rail draws seven places for
   * an opening hand, so every hand below seven cards has them.
   */
  it('leaves a place with nothing in it as a marker', () => {
    const play = paintShortHand();
    const empty = one(play, ".mtg-slot[data-slot='hand'][data-empty='true']");
    expect(computed(empty, 'flex-grow')).toBe('0');
    expect(computed(empty, 'height')).not.toBe('auto');
  });
});

describe('the battlefield grows with the viewport to its own readable ceiling', () => {
  /**
   * The cap is stated on the width and the height follows the trim, which is
   * what keeps the slot the size of the face inside it — and that is where the
   * corner marks land: `../../src/styles/board/slot.ts` positions them against
   * the *slot*, so a slot left stretched over a shorter face floats the `ATK`
   * and power/toughness badges above the card, which is half of what `mtg-yi5`
   * reported. The pairing this replaces had exactly that defect wherever its
   * width cap bound: measured at 1024x768 with four permanents a side, the
   * viewer's slot was 67.4 x 121.8 over a face of 67.4 x 94.1.
   *
   * A height survives as a maximum, because a window can always be shorter than
   * the width the cap asks for. It is a guard rather than the operating point,
   * and the difference is that it binds at no viewport that draws a usable
   * board.
   */
  it('caps the board slot on the width and takes its height from the trim', () => {
    const slot = declarations(`${PLAY_SCOPE} .mtg-board__spells > .mtg-slot:not([data-empty='true'])`);
    expect(slot, 'the board slot states no width').toContain('width: var(--board-face)');
    expect(slot, 'a stated height would be a second opinion about the trim').toContain('height: auto');
    // The same pair `./slot.ts` and `../card.ts` both record: a box with a
    // preferred aspect ratio takes its content as its automatic minimum size,
    // and a minimum beats a maximum, so `fit.ts`'s height floor has to go back
    // to zero explicitly or a crowded row draws faces taller than the trim.
    expect(slot, "the ratio alone is overruled by fit.ts's height floor").toContain('min-height: 0');
    const guard = /max-height: ([\d.]+)%/.exec(slot)?.[1];
    expect(guard, 'nothing stops a slot taller than the row it is in').toBeDefined();
    expect(Number(guard), 'a share of 100 is no guard at all').toBeLessThan(100);
  });

  /**
   * And the face reads its width back off the slot, which is the half the pair
   * above cannot do on its own.
   *
   * The guard is a `max-height`, so where it binds it trims the slot's height
   * and leaves the stated width alone — a box that is no longer the trim's
   * shape. A face declared `width: 100%` under a `max-height: 100%` then takes
   * the box's shape rather than its own. That was invisible while the guard
   * bound at no viewport, and `mtg-crw`'s collapse is what made it bind: with
   * the side panel shut the lane is wider, so the width requested can grow while
   * the taller hand row leaves less height to pay it with.
   * Measured before this rule at 1280x800 with four permanents a side and the
   * panel shut, a face was drawn 108.7 x 107.5 — a ratio of 1.011 against the
   * printed trim's 0.716.
   *
   * Stating the face's height makes it the smaller of the two terms instead of
   * one of them, and the width follows the ratio. Measured after, in
   * chrome-headless-shell 151 over the flagship set: 0.716 at all 24 readings,
   * four viewports by three densities by both panel states, and every
   * open-state face box unchanged to the pixel.
   *
   * The start edge is the corner marks rather than a preference —
   * `../../src/styles/board/slot.ts` positions them against the *slot*, so a
   * face centered in a slot wider than itself floats the badges 15.8px clear of
   * the card at the worst reading, which is the `mtg-yi5` defect the rule above
   * is also about. Measured after: a left gap of 0 at all 24 readings.
   */
  it('reads the face back off the slot it was capped into, at the start edge', () => {
    const face = declarations(
      `${PLAY_SCOPE} .mtg-board__spells > .mtg-slot:not([data-empty='true']):not([data-tapped='true']) > .mtg-card`,
    );
    expect(face, 'the face states a width of its own').toContain('width: auto');
    expect(face, 'the face does not take the height the slot was capped to').toContain('height: 100%');
    expect(face, 'nothing stops a face wider than the slot holding it').toContain('max-width: 100%');
    expect(face, 'a centered face takes the corner marks off it').toContain('margin-inline-end: auto');
    // A tapped face is excluded by name rather than by luck: four attribute
    // selectors deep this rule outweighs `slot.ts`'s, and a face rotated a
    // quarter turn reads its width off the square slot instead. The `:not` is
    // in the selector `declarations` just matched, and this is the sentence it
    // is protecting.
    const tapped = declarations(`.mtg-slot[data-tapped='true'] > .mtg-card`);
    expect(tapped, 'the tapped face stopped being a quarter turn').toContain('rotate: 90deg');
    expect(tapped, 'the tapped face stopped being sized off the square').toContain('width: ');
  });

  /**
   * And both seats take it. `mtg-d6s`: the cap shipped as a height share both
   * seats took and a width share only the viewer's seat did, the two track the
   * viewport's aspect ratio in opposite directions, and at 1024x768 with four
   * permanents a side they crossed — your board face came out 67.4 and the
   * opponent's 82.1, so the seat you play from had the smaller cards.
   *
   * The rule that sizes a slot is seat-blind. With the duplicate concealed-hand
   * rail gone, both battlefield rows use the same unqualified width basis.
   *
   * Since `mtg-b8e` the seat-blind half is the whole of `--board-face` — the
   * floor and the ceiling are properties of a face rather than of a seat, so a
   * seated declaration of either would be one seat drawing a different card.
   */
  it('sizes both seats from one cap', () => {
    const slot = declarations(`${PLAY_SCOPE} .mtg-board__spells > .mtg-slot:not([data-empty='true'])`);
    expect(slot, 'the sizing rule names a seat').not.toContain('data-seat');
    const seated = [...SHEET.matchAll(/\n([^\n{]*)\{[^}]*--hand-slot:/g)].map((m) => m[1] ?? '');
    expect(seated, 'the shared basis should be declared once').toHaveLength(1);
    expect(seated[0]).not.toContain('data-seat');
    // And every rule that sizes a face is seat-blind. Two of them now: the
    // width basis, and the same face bounded by the row's height wherever the
    // row is a size container (mtg-5f9). Counting them was the old assertion
    // and it was the wrong quantity - one seated rule out of one is the defect,
    // and so is one out of two.
    const faces = [...SHEET.matchAll(/\n([^\n{]*)\{[^}]*--board-face:/g)].map((m) => m[1] ?? '');
    expect(faces.length, 'nothing sizes a board face').toBeGreaterThan(0);
    for (const rule of faces)
      expect(rule, 'a rule that sizes a face names a seat').not.toContain('data-seat');
  });

  /**
   * And the face is bounded on both sides of the share, which is `mtg-b8e`.
   *
   * A ratio has no idea how long a name is. Measured in chrome-headless-shell 151
   * over `../../tools/card-uniformity.ts` and `../../tools/hand-scale.ts` against
   * the flagship set, 48 readings at four viewports by three densities by both
   * seats, the count of names cut is a step function of the face's width: nothing
   * is cut at 67.4px and above, two of seven at 64.9px, and it worsens from there.
   * A smaller proportional face drew 57.2px at 1024x768 with four permanents a
   * side and cut two names a seat that a 67.4px face had fitted.
   *
   * The ceiling is the other half and it is why this is not a bare `max()`.
   * A narrow hand may deliberately pack seven held cards tighter than a lone
   * permanent, but neither seat may turn surplus width into a poster-sized face.
   *
   * jsdom resolves no percentage, so what is asserted is the shape: a clamp
   * around the available hand-slot width.
   */
  /**
   * And the other half of `mtg-5f9`: the face is bounded by the room the row
   * has, not only by a share of the row's width.
   *
   * A seventh of the row is a proxy and it was wrong by most of a card.
   * Measured over `../../tools/hand-scale.ts` in chrome-headless-shell 151
   * against the flagship set, at 1024x768 the face was 72px at four, eight and
   * twelve permanents a side, whose 56px content box is under `../card.ts`'s
   * `BOARD_RULES_MIN_REM`, so no permanent on that table drew rules text at any
   * board size - inside a row 170.4px tall holding a 100.6px slot. After: 97.7px
   * at four a side and 84px at eight and twelve, and every face on the table
   * draws its rules box.
   *
   * jsdom resolves no container query, so what is asserted is the shape and its
   * scope. `test/play/table-allocation.browser.test.ts` measures the boxes.
   */
  it('bounds the face by the row it is in, off combat', () => {
    const bounded = declarations(
      `${PLAY_SCOPE} .mtg-board:not(:has(.mtg-board__divider[data-combat='true'])) .mtg-board__spells > .mtg-slot:not([data-empty='true'])`,
    );
    const face = /--board-face:\s*([^;]*);/.exec(bounded)?.[1]?.replace(/\s+/g, ' ').trim();
    expect(face, 'no rule bounds the face by the row').toBeDefined();
    // min() outside max(), in that order: a face may grow past a seventh of the
    // row to a complete one and may never grow past what the row can hold. The
    // other order leaves a slot stated taller than its row, and a row clips.
    const shape =
      /^clamp\( ?[\d.]+rem, ?min\( ?calc\(([\d.]+)cqh[^)]*\), ?max\(var\(--hand-slot\), ?([\d.]+)rem\) ?\), ?var\(--board-face-max\) ?\)$/.exec(
        face ?? '',
      );
    expect(shape, `the bounded face is not a min of the row's height: ${String(face)}`).not.toBeNull();
    // The height term's floor has to clear the widest of ../card.ts's anatomy
    // queries, which are stated against the face's content box: 5rem of content
    // plus 1rem of border and padding.
    expect(
      Number(shape?.[2]),
      'a complete face is floored under the type line threshold',
    ).toBeGreaterThanOrEqual(6);
    // And the row is a size container off combat, or the cqh above is the small
    // viewport rather than the row.
    expect(
      declarations(
        `${PLAY_SCOPE} .mtg-board:not(:has(.mtg-board__divider[data-combat='true'])) .mtg-board__spells`,
      ),
    ).toContain('container-type: size');
  });

  it('floors the board face, gives it the available hand-slot width, and caps it independently', () => {
    const row = declarations(`${PLAY_SCOPE} .mtg-board__spells`);
    // The basis is stated on the slot rather than on the row since mtg-5f9,
    // because the bounded version of it beside this one reads the row's height
    // in cqh and a container cannot query itself. The ceiling stays on the row,
    // where the crowded overrides that set it are.
    const slotRule = declarations(`${PLAY_SCOPE} .mtg-board__spells > .mtg-slot:not([data-empty='true'])`);
    const face = /--board-face:\s*([^;]*);/.exec(slotRule)?.[1]?.replace(/\s+/g, ' ').trim();
    expect(face, 'the battlefield slot states no face width').toBeDefined();
    const bounded = /^clamp\(\s*([\d.]+)rem,\s*var\(--hand-slot\),\s*var\(--board-face-max\)\s*\)$/.exec(
      face ?? '',
    );
    expect(bounded, `the face width is not an independently bounded curve: ${String(face)}`).not.toBeNull();
    // The floor stays above the measured name-clipping boundary.
    expect(
      Number(bounded?.[1]),
      'the floor is under the width names were measured to fit at',
    ).toBeGreaterThanOrEqual(4.25);
    const boardCap = /--board-face-max:\s*([\d.]+)rem/.exec(row)?.[1];
    expect(boardCap, 'the row does not publish the board ceiling').toBeDefined();
    expect(
      Number(boardCap),
      'the board ceiling is too small to become readable on a wide display',
    ).toBeGreaterThan(8);
    const crowdedCap = /nth-child\(8\)[^{]*\{\s*--board-face-max:\s*([\d.]+)rem/.exec(SHEET)?.[1];
    expect(Number(crowdedCap), 'a crowded row has no readable height-safe ceiling').toBeGreaterThanOrEqual(
      Number(bounded?.[1]),
    );
  });

  /**
   * Both lanes hold one row of cards now, so neither claims a share the other
   * does not. `fit.ts` gave the viewer's lane a double share while that lane
   * held two rows, and the hand came off the height axis: measured at 1440x900
   * with four permanents a side, keeping it drew your battlefield at 117.8
   * against the opponent's 81.3, and dropping it drew 108.5 against 108.5.
   *
   * It was dropped by a second declaration reversing the first, and `mtg-d6s`
   * is what that cost. `fit.ts` still *read* `flex-grow: 2` while the sheet
   * computed 1, so a bead written from that docblock — with the browser numbers
   * in front of it — blamed a rule the cascade had already turned off, and named
   * the near band's extra height as the cause of a defect that was entirely on
   * the width axis. So the claim is asserted as no declaration at all: nothing
   * in the sheet may give one seat a growth the other has not got.
   *
   * **Qualified once, by a selector that says when (`mtg-ihss`).** An open combat
   * band takes a share of the column off both lanes, and an even split does not
   * divide it evenly: the near lane's fixed rows do not shrink, so all of its
   * loss lands on its battlefield. Measured at 1280x800 with one attacker
   * declared, your row came out 93.5px against the opponent's 108.2 and your
   * board face 58.8 wide against theirs 68.8 — the same inversion this test
   * exists to catch, arriving through the height axis instead of the width one.
   * `styles/board/band.ts` therefore tilts the two lanes, and gates the tilt on
   * a band that is holding a card. A resting board is still what the paragraph
   * above describes, so the rule below skips a gated selector by name rather
   * than dropping the claim.
   *
   * **And a second time, by a viewport that says where (`mtg-l4w0`).** A phone
   * held in landscape is in the combat condition for the whole game rather than
   * for one step: `./fit.ts`'s equal share of the *free* space needs there to be
   * free space, and at 844x390 there is none, so the split is a deficit divided
   * against two unequal content bases and the near band's whole shrink lands on
   * its battlefield again. Measured before the tilt: 59.6px yours against 104.8
   * theirs at 844x390, and 30.7 against 102.7 at 932x430. After: 85.1 to 79.3
   * and 98.7 to 96.1. `styles/mobile.ts` states the same two factors under
   * `SHORT_VIEWPORT_QUERY`, and this test names that tier the way it names the
   * combat one — by where the rule sits, since a media prelude is on a line the
   * selector match never sees.
   */
  it('gives the two lanes equal shares now that the hand is off the column', () => {
    // The lane itself, not something inside it: the hand rail is `flex: none`
    // and it is a child of the near lane, so a selector match that ran past the
    // seat attribute would read that rule as the lane's own.
    const seated = [...SHEET.matchAll(/([^\n]*)\.mtg-board__side\[data-seat='(\w+)'\] \{([^}]*)\}/g)];
    expect(seated.length, 'no rule names a seated lane at all').toBeGreaterThan(0);
    const resting = seated.filter(
      (match) => !String(match[1]).includes(':has(.mtg-combat__entry)') && !inShortViewport(match.index),
    );
    expect(
      resting.length,
      'every rule on a lane is gated, so nothing states a board with room on it',
    ).toBeGreaterThan(0);
    for (const [, , seat, block] of resting) {
      expect(block, `the ${String(seat)} lane claims a growth of its own`).not.toContain('flex-grow');
      expect(block, `the ${String(seat)} lane claims a shrink of its own`).not.toContain('flex-shrink');
      expect(block, `the ${String(seat)} lane restates the flex shorthand`).not.toMatch(/(?:^|[;\s])flex:/);
    }
    // The second gate states both factors, and both is the load-bearing word: a
    // lane that only grows takes its share out of the seam between the two rows
    // rather than out of the lane opposite, which is a different board.
    expect(SHORT_VIEWPORT, 'the near lane takes no larger share of a short table').toMatch(
      /\.mtg-board__side\[data-seat='you'\] \{ flex-grow: 2; \}/,
    );
    expect(SHORT_VIEWPORT, 'the far lane gives up no larger share of a short table').toMatch(
      /\.mtg-board__side\[data-seat='opponent'\] \{ flex-shrink: 2; \}/,
    );
  });
});
