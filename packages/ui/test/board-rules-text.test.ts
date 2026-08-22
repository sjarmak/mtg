// @vitest-environment jsdom
/**
 * The rules text of a card in play and a card in hand, on the card.
 *
 * `mtg-u69`, filed off a real game in chrome-headless-shell against the
 * flagship set: every card the player could see wore the `board` face, that
 * face laid out no rules region at all, and the only route to a card's text was
 * the hover zoom. So a creature with vigilance did not say so anywhere on the
 * screen, deciding a block meant hovering each attacker in turn, and on a touch
 * device — the playtester plays on an iPad — there was no route at all.
 *
 * **What this file can and cannot say.** jsdom performs no layout and evaluates
 * no container query, so nothing here may claim a font size, a column width or
 * that any text was legible. Those are browser claims and they were taken in
 * chrome-headless-shell 151 over `../tools/board-text.ts`; the numbers are in
 * the commit message. What is checkable here is everything upstream of layout:
 * which regions the face lays out, that the words are in the element rather than
 * in an attribute, that the keyword line is first and marked, and that the rules
 * the browser resolved are in the sheet at all — a rule that lost the cascade or
 * was never emitted leaves the box in the markup and invisible on the screen,
 * which is the exact shape of the defect being closed.
 *
 * The one claim that is neither is the hover: it is a *negative* about the
 * cascade, and it is the one this bead most needs held. A fix that put the box
 * behind `:hover` would pass every positive assertion here and fail the person
 * the bead was filed for.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, EXAMPLE_CARDS, parseCard, renderOracleText } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { BOARD_REGIONS } from '../src/card/anatomy';
import { uiStyleSheet } from '../src/styles/index';

const SHEET = uiStyleSheet();

/** The one rule whose selector is exactly this, or null when nothing declares it. */
function rule(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(SHEET);
  return found === null ? null : (found[1] ?? '');
}

/** A creature that prints a keyword and then an ability, which is the case the clip is about. */
function keyworded(): DslCard {
  const card = EXAMPLE_CARDS.find(
    (candidate) => candidate.kind === 'creature' && candidate.keywords.length > 0,
  );
  if (card === undefined) throw new Error('the example set prints no keyworded creature');
  return card;
}

function boardFace(card: DslCard): string {
  return renderToStaticMarkup(h(Card, { card, size: 'board' }));
}

describe('a card in play prints its rules text', () => {
  it('lays the rules box out in printed order, between the type line and the foot', () => {
    // The order is the specification's rather than the component's, so it is
    // asserted here as the list and not as a substring of one rendered face.
    // The title leads at this size as it does at every other, and
    // `../src/card/anatomy.ts` has what was re-measured to put it there.
    expect([...BOARD_REGIONS]).toEqual(['title', 'art', 'type', 'rules', 'footer']);
  });

  it('puts every printed line in the box, and marks the keyword line first', () => {
    const card = keyworded();
    const markup = boardFace(card);
    const lines = renderOracleText(card).split('\n');
    expect(lines.length, 'the fixture prints nothing to check').toBeGreaterThan(0);

    expect(markup, 'the board face lays out no rules region').toContain('data-region="rules"');
    for (const line of lines) {
      // The words themselves, not a count: a box carrying the right number of
      // empty spans is the failure this is written against.
      for (const word of line.split(' ')) {
        if (word.length > 3) expect(markup, `${card.id} drops ${word}`).toContain(word);
      }
    }

    // First and marked, which is what makes the clip acceptable: the box holds a
    // stated number of lines and the one that survives is the one a block is
    // decided on. The class list of the *first* line is the assertion, because a
    // keyword line printed second is still marked and still unreadable.
    const classes = [...markup.matchAll(/class="(mtg-card__line[^"]*)"/g)].map((match) => match[1]);
    expect(classes.length, 'the box printed no lines').toBeGreaterThan(0);
    expect(classes[0], 'a line is printed above the keywords').toBe('mtg-card__line mtg-card__keywords');
    // The keyword by its printed spelling rather than its DSL tag: `flying` is
    // the tag and `Flying, vigilance` is the sentence, and the sentence is what
    // a player reads off the board.
    expect(markup).toContain(`>${lines[0] ?? ''}<`);
  });

  it('draws the box for a card with a picture and for one without', () => {
    // The pending frame and a real illustration are two different art states and
    // the box is a sibling of the window, so neither may reach it. Most of the
    // flagship set is uncovered by any manifest, so the first case is the
    // ordinary one rather than an edge.
    const card = keyworded();
    const pending = boardFace(card);
    const pictured = renderToStaticMarkup(
      h(Card, { card, size: 'board', art: { src: 'art/x.png', alt: 'a picture' } }),
    );
    for (const markup of [pending, pictured]) expect(markup).toContain('data-region="rules"');
  });

  it('sizes the box against the face, cuts it at whole lines, and marks the cut', () => {
    // Four declarations, and each one is a different failure if it goes. The
    // clamp is what makes the text a share of the card rather than a fixed
    // number of pixels on a thumbnail; the line-box budget is what makes a cut
    // land between lines instead of through them; the ellipsis is what says a
    // cut happened at all, which `mtg-5f9` is open on; and the absence of a
    // scroller is what says there is no scrollbar to reach for, which matters
    // because the surface this box is on is also driven by a finger.
    //
    // No pixel is proved here — jsdom lays nothing out. What the *rendering*
    // does was read in chrome-headless-shell 151 and is written down in
    // `../src/styles/card.ts`'s rules-box comment; this is the sheet's half.
    const box = rule(".mtg-card[data-size='board'] > [data-region='rules']");
    expect(box, 'the sheet declares no board rules box').not.toBeNull();
    expect(box, 'the text is not a share of the face').toMatch(/font-size: clamp\([^)]*cqw/);
    expect(box, 'the budget is not stated in line boxes').toMatch(/-webkit-line-clamp: \d+/);
    expect(box, 'a cut line ends in no mark').toContain('text-overflow: ellipsis');
    expect(box, 'the box offers a scrollbar nobody can reach').not.toContain('overflow: auto');
  });

  it('gives the box back to the picture on a face too narrow to set it', () => {
    // The one region that gives is the window (`../src/styles/card.ts`,
    // BOARD_FACE), so below the width at which a line stops holding a keyword
    // the box goes rather than the picture. jsdom evaluates no container query,
    // so the rule is read out of the sheet; the widths it fires at are in the
    // constant's docblock and were measured in a browser.
    expect(SHEET).toMatch(
      /@container \(max-width: [\d.]+rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ display: none; \}/,
    );
    // And a step between the two: a narrow face draws fewer lines rather than
    // none, so the keyword line survives further down than the box does.
    expect(SHEET).toMatch(
      /@container \(max-width: [\d.]+rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ -webkit-line-clamp: 2; \}/,
    );
  });

  /**
   * The claim the bead turns on, written as a negative because a positive
   * cannot state it: no pointer event reveals the words.
   *
   * The playtester plays on an iPad. iOS Safari has no hover, makes `:hover` sticky
   * after a tap, and a tap on a board face plays the card — so a fix that made
   * the rules text visible on hover would have moved the defect rather than
   * closed it. The zoom panel keeps its own `:hover`/`:focus-within` pair and is
   * welcome; what may never happen is the *board face's own box* acquiring one.
   */
  it('needs no pointer: nothing in the cascade gates the box on hover or focus', () => {
    const gated = SHEET.split('\n').filter(
      (line) =>
        line.includes("data-size='board'") &&
        line.includes("data-region='rules'") &&
        (line.includes(':hover') || line.includes(':focus')),
    );
    expect(gated, 'a pointer state reveals the board rules box').toEqual([]);
    // The box is a child of the face itself rather than of the zoom panel, so a
    // page with no pointer at all still renders it.
    const markup = boardFace(keyworded());
    const zoomAt = markup.indexOf('mtg-zoom');
    expect(zoomAt, 'a board face renders a zoom panel of its own').toBe(-1);
    expect(markup).toContain('data-region="rules"');
  });
});

/**
 * The same face, held instead of played, and the one thing it does differently.
 *
 * `mtg-rgc.9` is the report that a card in hand cannot be read: it wears
 * `data-size='board'` because a hand slot renders the same component a
 * battlefield slot does, so it inherits the battlefield's line budget — three
 * boxes, two on a narrow face. That budget is right for a permanent, which is
 * being scanned rather than read, and wrong for a card being decided on, which
 * is the only thing a card in hand is for.
 *
 * The rejected fix was a fourth `CardSize`. It would have carried a region list
 * identical to `BOARD_REGIONS` and a fourth arm on each of `Card.ts`'s three
 * `size === 'board'` branches, every one of them answering the same as `board`,
 * to change one declaration. The shipped fix scopes that declaration to the
 * slot, which is where the difference actually lives: the same card is terse in
 * play and long in hand because of where it is, not because of what it is.
 *
 * What is checkable here is the sheet. jsdom evaluates no container query and
 * lays nothing out, so the widths these bands fire at and the picture they leave
 * behind are browser claims; they were taken in chrome-headless-shell 151 and
 * are written into `../src/styles/board/hand.ts` beside the ladder itself,
 * because a measurement in a commit message is a measurement nobody finds.
 */
describe('a card in hand prints more of it than the same card in play', () => {
  /** Every band the sheet emits for a held card's rules box, in sheet order. */
  function handBands(): readonly {
    readonly width: number;
    readonly lines: number;
    readonly scope: string;
  }[] {
    const pattern =
      /@container \(min-width: ([\d.]+)rem\) \{\n {2}([^\n]*?) \.mtg-slot\[data-slot='hand'\] \.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{\n {4}-webkit-line-clamp: (\d+);\n {2}\}\n\}/g;
    const found: { width: number; lines: number; scope: string }[] = [];
    for (const match of SHEET.matchAll(pattern)) {
      found.push({
        width: Number(match[1]),
        lines: Number(match[3]),
        scope: match[2] ?? '',
      });
    }
    return found;
  }

  it('raises the budget in bands, and every band is wider before it is longer', () => {
    const bands = handBands();
    expect(bands.length, 'the sheet emits no hand rules band at all').toBeGreaterThan(1);
    for (const [index, band] of bands.entries()) {
      if (index === 0) continue;
      const before = bands[index - 1];
      if (before === undefined) throw new Error('unreachable');
      expect(band.width, 'a band fires no wider than the one before it').toBeGreaterThan(before.width);
      expect(band.lines, 'a wider face is given no more text').toBeGreaterThan(before.lines);
    }
  });

  /**
   * What the battlefield grants a face of this width, resolved the way the
   * cascade resolves it rather than restated.
   *
   * It has to be resolved, because the played budget is itself banded and the
   * bands are narrower than the hand's: comparing against the unqualified `3`
   * would have let the 4.5rem hand band tie a budget that is 2 at that width and
   * still read as a pass. Zero means the played face draws no box at all.
   */
  function playedBudgetAt(width: number): number {
    const hidden =
      /@container \(max-width: ([\d.]+)rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ display: none; \}/.exec(
        SHEET,
      );
    const narrow =
      /@container \(max-width: ([\d.]+)rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ -webkit-line-clamp: (\d+); \}/.exec(
        SHEET,
      );
    const played = rule(".mtg-card[data-size='board'] > [data-region='rules']");
    expect(played, 'the sheet declares no board rules box').not.toBeNull();
    const budget = /-webkit-line-clamp: (\d+)/.exec(played ?? '');
    expect(budget, 'the board box states no line budget').not.toBeNull();
    expect(hidden, 'the sheet never hides the board rules box').not.toBeNull();
    expect(narrow, 'the board box has no narrow band').not.toBeNull();
    if (width <= Number(hidden?.[1])) return 0;
    if (width <= Number(narrow?.[1])) return Number(narrow?.[2]);
    return Number(budget?.[1]);
  }

  it('asks for more lines than the played face at the same width', () => {
    // Not "more than nothing": more than what the battlefield already grants at
    // the width the band fires at, which is the whole claim. Both budgets are
    // read out of the sheet rather than written down here, so raising either one
    // raises what this compares.
    const bands = handBands();
    expect(bands.length, 'the sheet emits no hand rules band at all').toBeGreaterThan(1);
    for (const band of bands) {
      expect(
        band.lines,
        `the ${band.width}rem hand band is no longer than the played face at that width`,
      ).toBeGreaterThan(playedBudgetAt(band.width));
    }
  });

  it('never asks a face that draws no box to draw five lines', () => {
    // Below a width the played face gives the box back to the picture outright.
    // The hand raises a budget; it does not reopen that decision, so its
    // narrowest band has to start above the width at which the box goes.
    const hidden =
      /@container \(max-width: ([\d.]+)rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ display: none; \}/.exec(
        SHEET,
      );
    expect(hidden, 'the sheet never hides the board rules box').not.toBeNull();
    const floor = Number(hidden?.[1]);
    const narrowest = handBands()[0];
    expect(narrowest, 'the sheet emits no hand rules band at all').toBeDefined();
    expect(narrowest?.width, 'the narrowest hand band fires on a face with no box').toBeGreaterThan(floor);
  });

  it('changes the budget and nothing else, and only where a card is held', () => {
    // The bead asked for more text, and the cheap way to get it is smaller type.
    // That is the fix it explicitly does not want: a hand face is the one face
    // being read at arm's length, and shrinking it trades the complaint for a
    // quieter one. So every band declares exactly one thing, and it is not a
    // font size, a padding or a display.
    for (const band of handBands()) {
      expect(band.scope, 'a hand band is not scoped to a play surface').toContain("data-mtg-mode='play'");
    }
    const hand = SHEET.split('\n').filter(
      (line) => line.includes("data-slot='hand'") && line.includes("data-region='rules'"),
    );
    expect(hand.length, 'no hand rules rule is in the sheet').toBeGreaterThan(0);
    const declarations = SHEET.split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes("data-slot='hand'") && line.includes("data-region='rules'"))
      .map(({ index }) => SHEET.split('\n')[index + 1] ?? '');
    for (const declared of declarations) {
      expect(declared.trim(), 'a hand rules rule declares something other than the budget').toMatch(
        /^-webkit-line-clamp: \d+;$/,
      );
    }
  });
});

describe('the name and the type line on a played face', () => {
  it('wrap rather than ending in an ellipsis', () => {
    // mtg-9k0: ten of ten type lines visible at one moment were clipped, and two
    // of four names with them. The full face keeps `nowrap`, because there the
    // rules box is the residual under a fixed window and a second line above it
    // is height the fit ladder is not told about; this face's window is
    // `aspect-ratio: auto` and absorbs it.
    // The name alone. The type line's second line was spent on the art window
    // (`../src/styles/card.ts`, `BOARD_NAME_LINES`), so it takes one ellipsized
    // line here exactly as it does on the full face and on the printed one, and
    // the whole line is still in the face's `title` and `aria-label`. The name's
    // budget is counted in line boxes, so a line past it is dropped whole rather
    // than sliced through its glyphs.
    //
    // The last two are `mtg-6hrz`/`mtg-9f0e`: a name that no longer fits keeps
    // its words whole and says it was cut. Neither is a pixel claim — jsdom lays
    // nothing out — and what the pixels do was read in chrome-headless-shell 151
    // over `../tools/face-floor.ts` against the 249-card flagship, written down
    // in `../src/styles/card.ts`'s `BOARD_NAME_LINES`. This is the sheet's half:
    // the declaration that produced `Sprin g of Wisdo` was `overflow-wrap:
    // break-word` and the one that cut a name with no mark at all was
    // `overflow: clip`, so both are named as absences.
    const selector = ".mtg-card[data-size='board'] .mtg-card__name";
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declared = [...SHEET.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))]
      .map((match) => match[1] ?? '')
      .join('\n');
    expect(declared, 'no line budget for the board name').toMatch(/-webkit-line-clamp: \d+/);
    expect(declared, 'the board name lost its wrap').toContain('white-space: normal');
    expect(declared, 'the board name breaks words inside their letters').toContain('overflow-wrap: normal');
    expect(declared, 'a cut board name shows no mark').toContain('text-overflow: ellipsis');

    // The full face is unchanged, and that is the half of this that is a
    // regression guard rather than a feature.
    const full = rule('.mtg-card__name');
    expect(full).toContain('white-space: nowrap');
    expect(full).toContain('text-overflow: ellipsis');
  });

  /**
   * And both of them go on shrinking with the face after `--mtg-text-xs`.
   *
   * The type line wraps on this face, so a floor it cannot get under does not
   * clip the line — it *spends height*, which on a face whose window is the
   * residual is the picture. Measured in chrome-headless-shell 151 over
   * `../tools/hand-scale.ts`, a 124px face at 1440x900 gave 30.4px of type bar
   * against 33.1px of window on the wordiest card, and 30.4px against 18.7px at
   * 1280x800: the two-line type bar was larger than the illustration. The floor
   * is the same 9px the name's is and `styles/card.ts` argues it once for both.
   *
   * `--mtg-text-xs` is what the declaration must *not* say, so the assertion is
   * written as the exclusion rather than as the new value: a floor back on the
   * token is the state this closes.
   */
  it('lets the type line keep shrinking after the name does', () => {
    const type = rule(
      ".mtg-card[data-size='board'] .mtg-card__type,\n.mtg-card[data-size='board'] .mtg-card__collector",
    );
    expect(type, 'the board face declares no type size').not.toBeNull();
    const clamp = /font-size: clamp\(([^,]+),/.exec(type ?? '');
    const floor = clamp === null ? null : clamp[1];
    expect(floor, 'the type line has no floor at all').not.toBeNull();
    expect(floor, 'the floor is back on --mtg-text-xs').not.toContain('--mtg-text-xs');
    expect(floor, 'the floor is not a rem length').toMatch(/^[\d.]+rem$/);

    // One number for both labels rather than two that drift: the name's floor and
    // the type line's are the same declaration in `styles/card.ts`.
    const name = rule(".mtg-card[data-size='board'] .mtg-card__name");
    expect(name, 'the board face declares no name size').not.toBeNull();
    expect(name, 'the name and the type line floor at different sizes').toContain(String(floor));
  });
});

/**
 * The other half of `mtg-9k0`, and the reason nothing in this branch answers it.
 *
 * That bead reports that a land tile carries no name, and argues from it that "a
 * nonbasic land would be unidentifiable without hovering" — which on a touch
 * screen means unidentifiable. The argument is sound and the card is not
 * expressible: a rule for it was written, and then removed when the DSL refused
 * to parse the card it was for. This is that refusal, kept as a test so the next
 * lane that reaches for the same fix finds the reason before writing the rule
 * rather than after.
 *
 * What is left of the land half of that bead is a question for the playtester rather
 * than a defect: whether a *basic* should carry its name, against her own "they
 * just show their art no thick border and no text". The bead's own text concedes
 * the case — "with basics you can just about tell them apart by art".
 */
describe('the nonbasic land the tile would have to name', () => {
  it('cannot be built, so the tile that would name it is unreachable', () => {
    const attempt = (): unknown =>
      parseCard({
        kind: 'land',
        id: 'slc-shrine-well',
        name: 'Shrine Well',
        rarity: 'rare',
        set: { code: 'SLC', collectorNumber: 23 },
        basicLandType: 'Island',
        producesMana: ['U'],
      });
    expect(attempt).toThrow(/basic/);
    // And every land any set here can print carries the supertype, so the
    // wordless tile is always one of five cards a player already knows.
    for (const card of BASIC_LANDS) expect(card.supertypes, card.id).toContain('basic');
  });
});
