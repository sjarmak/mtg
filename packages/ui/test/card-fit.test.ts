/**
 * Which step of the fit ladder a card's rules text lands on.
 *
 * `rulesFitStep` is the one rule both faces shrink their rules text by, and it
 * is arithmetic rather than a measurement for a stated reason: jsdom lays
 * nothing out, so a fit that asked the DOM for a box would be a fit no test in
 * this suite could see. The trade is that the arithmetic is an *estimate* of a
 * layout, and an estimate has to be checked against the layout it estimates —
 * `packages/ui/tools/face-census.ts` writes the page a browser measures, and
 * `docs/` has neither the page nor the numbers, so this file is what holds the
 * estimate itself: the cases are written out, and the census is what says the
 * cases are the right ones.
 *
 * The flagship set is read rather than a handful of cards invented here, for
 * the reason `packages/card-render/test/parity.test.ts` sweeps every committed
 * card: the property is about the wordiest card a generator produced, and no
 * hand-written fixture is that card by construction.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card as DslCard } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS, parseCards, renderOracleText, renderTypeLine } from '@mtg/dsl';
import { CARD_NAME_MAX_LENGTH } from '@mtg/setgen';
import {
  NAME_FIT_STEPS,
  RULES_FIT_STEPS,
  nameFitScale,
  nameFitStep,
  nameFitStepOf,
  rulesBoxCost,
  rulesFitStep,
  rulesFitStepOf,
  rulesTextBlocks,
  typeFitStep,
  typeFitStepOf,
} from '../src/card/anatomy';

const FLAGSHIP = new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url);

function flagship(): readonly DslCard[] {
  const document: unknown = JSON.parse(readFileSync(FLAGSHIP, 'utf8'));
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error('the flagship fixture is not a set document');
  }
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error('the flagship fixture has no cards array');
  return parseCards(cards);
}

/**
 * Every face the lab draws for the flagship: its 90 cards and the five basics,
 * which `@mtg/deckbuild` mints at build time and no set document names.
 */
const FACES: readonly DslCard[] = [...flagship(), ...BASIC_LANDS];

function longest(): DslCard {
  const [first, ...rest] = FACES;
  if (first === undefined) throw new Error('the flagship fixture is empty');
  return rest.reduce(
    (worst, card) => (renderOracleText(card).length > renderOracleText(worst).length ? card : worst),
    first,
  );
}

describe('the rules-text fit ladder', () => {
  it('reads the flagship set and its basics, not a handful of cards', () => {
    expect(FACES.length).toBe(95);
    expect(renderOracleText(longest()).length).toBeGreaterThan(80);
  });

  /**
   * The wordless case, which is the ladder's degenerate input: no characters
   * and no paragraphs, so the arithmetic has to return full size rather than
   * whatever an empty string divides into.
   *
   * Both corpora carry one. The set in this tree prints 26 vanilla creatures,
   * so the second half is an observation about the fixture rather than a rule
   * the set is held to — a set that stopped printing them would be a set this
   * case had stopped being checked on, which is why the count is asserted to be
   * above zero before the step is asserted at all.
   */
  it('puts a card with no rules text at full size, in both corpora', () => {
    const wordless = EXAMPLE_CARDS.filter((card) => renderOracleText(card).length === 0);
    expect(wordless.length, 'the DSL example set prints no vanilla card').toBeGreaterThan(0);
    for (const card of wordless) expect(rulesFitStep(card), card.id).toBe(0);

    const blank = FACES.filter((card) => renderOracleText(card).length === 0);
    expect(blank.length, 'the committed set prints no vanilla card').toBe(26);
    for (const card of blank) expect(rulesFitStep(card), card.id).toBe(0);
  });

  /**
   * The census, written out. The set is committed and the ladder is
   * deterministic, so this is a fact rather than a range: all 95 faces are set
   * at full size, because the wordiest card in this set prints 91 characters
   * and a single paragraph fits at full size up to 136.
   *
   * **So this set never exercises a non-zero step**, and that is worth knowing
   * rather than reading as everything being fine: this test pins the set, and
   * the ladder's own arithmetic is held up by "steps down exactly at the line
   * the box runs out of" below, on cases written by hand. If those two ever
   * have to disagree it is this one that is describing a fixture.
   *
   * If a regenerated set moves these numbers that is a real change to how the
   * set reads, and it should be looked at rather than re-recorded — the shape
   * to watch for is a count appearing at the last step, which is a set whose
   * cards have outgrown the box.
   */
  it('sets all 95 faces at full size', () => {
    const census = new Map<number, number>();
    for (const card of FACES) {
      const step = rulesFitStep(card);
      census.set(step, (census.get(step) ?? 0) + 1);
    }
    expect([...census].sort(([left], [right]) => left - right)).toEqual([[0, 95]]);
    expect(rulesFitStep(longest())).toBe(0);
    expect(longest().id).toBe('tgr-rot-feeds-the-root');
  });

  /**
   * The floor, and what is left to assert once a card is standing on it.
   *
   * This test used to say no committed card reached the floor at all, which was
   * a statement about a corpus rather than about the ladder: whether any card is
   * down there is a fact about the set in the tree, and the set in this one puts
   * none there, so the loop below is empty and the property is what carries it.
   *
   * That property is the one the ladder actually owes. Cost falls strictly with
   * every step — the column widens and the line box shrinks together, and the
   * paragraph margins are the only fixed part — so a face that was refused at the
   * rung above the floor costs more *there* than every face that was accepted at
   * its own rung, whatever rung that was. That is exactly "the floor is a last
   * resort", stated without naming the budget it is a last resort against.
   *
   * Whether a face at the floor is *legible* is not a question this file can
   * ask, and the answer is no longer taken on faith either: `./card-fit.browser.
   * test.ts` renders the set and fails when any box is cut, the floor included.
   */
  it('goes to the floor only for text no rung above can hold', () => {
    const floor = RULES_FIT_STEPS.length - 1;
    // The DSL example set is the simple corpus, and nothing in it is near the
    // end of the road. A card that put it there would be a card the examples
    // were never meant to contain.
    for (const card of EXAMPLE_CARDS) {
      expect(rulesFitStep(card), `${card.id} is at the ladder's floor`).toBeLessThan(floor);
    }

    const floored = FACES.filter((card) => rulesFitStep(card) === floor);
    const standing = FACES.filter((card) => rulesFitStep(card) < floor);
    expect(standing.length, 'every face in the set is at the floor').toBeGreaterThan(0);
    for (const card of floored) {
      const dearest = standing.reduce((worst, other) =>
        rulesBoxCost(other, floor - 1) > rulesBoxCost(worst, floor - 1) ? other : worst,
      );
      expect(
        rulesBoxCost(card, floor - 1),
        `${card.id} is at the floor while ${dearest.id} costs the box more at the rung above it`,
      ).toBeGreaterThan(rulesBoxCost(dearest, floor - 1));
    }
  });

  /**
   * Monotone in the thing it is a function of, stated as the dominance it
   * actually is.
   *
   * The reader-facing sentence is "more words never means bigger type", and this
   * used to be checked by sorting the corpus by `renderOracleText` length. That
   * key was never the ladder's input and held on this corpus by luck: the
   * estimate counts whole wrapped lines and charges a gap per paragraph, so
   * forty characters cost two lines as two paragraphs of twenty and three as
   * thirty-nine plus one. Keywords printing their reminders (`mtg-6mx`) changed
   * which cards have how many paragraphs and the luck ran out, on two different
   * innocent cards in a row.
   *
   * Sorting by the cost at one step is no better, and that is the second thing
   * this test learned: shrinking the type unwraps a long paragraph and does
   * nothing for a paragraph that was already one line, so Golden Direhorn costs
   * more than a step-2 card at full size and still fits at step 1. The property
   * that is true is dominance — a card that costs at least as much at *every*
   * step can never be set larger — and it is what a reader is really assuming.
   */
  it('never sets a card larger than one it costs more than at every step', () => {
    const steps = RULES_FIT_STEPS.map((_, step) => step);
    let compared = 0;
    for (const left of FACES) {
      for (const right of FACES) {
        if (!steps.every((step) => rulesBoxCost(left, step) >= rulesBoxCost(right, step))) continue;
        compared += 1;
        expect(
          rulesFitStep(left),
          `${left.id} is set larger than ${right.id}, which costs the box no more`,
        ).toBeGreaterThanOrEqual(rulesFitStep(right));
      }
    }
    // The sweep found real pairs to compare rather than passing vacuously.
    expect(compared).toBeGreaterThan(FACES.length);
  });

  /**
   * The length-shaped half of the property above, stated where it holds: a box
   * that is one paragraph costs `ceil(length / column)` lines and nothing else,
   * so among those cards more characters can only ever mean smaller type.
   */
  it('never sets a longer one-paragraph card larger than a shorter one', () => {
    const single = FACES.filter((card) => rulesTextBlocks(card).length === 1);
    expect(single.length, 'one-paragraph faces in the flagship set').toBeGreaterThan(10);
    const ordered = [...single].sort(
      (left, right) =>
        (rulesTextBlocks(left)[0]?.text.length ?? 0) - (rulesTextBlocks(right)[0]?.text.length ?? 0),
    );
    let previous = 0;
    for (const card of ordered) {
      const step = rulesFitStep(card);
      expect(step, `${card.id} is set larger than a shorter card`).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
  });

  /**
   * The estimate's own arithmetic, on cases written here rather than found.
   *
   * The box takes 87px of text at full size, a line of it is 18.85px and holds
   * 34 characters, and the sheet puts 4px between two rules paragraphs. So: one
   * paragraph of 136 characters is exactly four lines, 75.4px, and fits; 137 is
   * five lines and 94.25px and does not. Three one-line paragraphs cost 56.55px
   * of text and 8px of margin and fit; a fourth takes them to 87.4px and does
   * not, which is the margins deciding it — the same four lines as one paragraph
   * would fit. These are the boundaries the census above sits between, and they
   * are what a re-calibration has to move deliberately — this set of numbers is
   * the third, after 42 characters to the line and then 38.
   */
  it('steps down exactly at the line the box runs out of', () => {
    const paragraph = (length: number): string => 'w'.repeat(length);

    expect(rulesFitStepOf(paragraph(136))).toBe(0);
    expect(rulesFitStepOf(paragraph(137))).toBeGreaterThan(0);
    expect(rulesFitStepOf([paragraph(34), paragraph(34), paragraph(34)].join('\n'))).toBe(0);
    expect(
      rulesFitStepOf([paragraph(34), paragraph(34), paragraph(34), paragraph(34)].join('\n')),
    ).toBeGreaterThan(0);
    // And the two entry points agree, so the card-shaped one is the same rule
    // rather than a second one that happens to look like it. The card-shaped one
    // is a function of the *text box* rather than of the oracle string
    // (`mtg-6mx`), so the string handed to `rulesFitStepOf` here is the box's,
    // and the assertion is still that one piece of arithmetic serves both.
    for (const card of FACES) {
      const box = rulesTextBlocks(card)
        .map((block) => block.text)
        .join('\n');
      expect(rulesFitStep(card), card.id).toBe(rulesFitStepOf(box));
    }
    // The two agree on every face of this set, and that is a fact about the set
    // rather than about the rule: its cards do print reminders the oracle string
    // does not carry, and none of them is long enough to move the box a step. A
    // set with one is where the line above stops being a tautology, so an id
    // appearing here is the reminders reaching the ladder rather than a break.
    const reminded = FACES.filter((card) => rulesFitStepOf(renderOracleText(card)) !== rulesFitStep(card));
    expect(reminded.map((card) => card.id)).toEqual([]);
  });
});

/**
 * The type line's ladder, which exists because of the rules box rather than
 * because of itself.
 *
 * With the art window fixed, the rules box is the residual of the trim — so a
 * type line that wrapped took the box's height with it, and the arithmetic above
 * was sizing text against a box it could not see. Measured in
 * chrome-headless-shell 151 before this ladder, on the wordier set this ladder
 * was calibrated against: three of its eighty faces had an 86.7px rules box and
 * the other seventy-seven had 100.9px. After: 99px of inner height on all
 * eighty, and no face overflows.
 */
describe('the type-line fit ladder', () => {
  it('keeps every flagship type line off the floor', () => {
    const floor = RULES_FIT_STEPS.length - 1;
    for (const card of [...FACES, ...EXAMPLE_CARDS]) {
      expect(typeFitStep(card), `${card.id} is at the type ladder's floor`).toBeLessThan(floor);
    }
  });

  /**
   * The boundaries, written out. The bar holds 30 characters at full size, so 30
   * is step 0 and 31 is not; step 2 holds 35. The longest type line this set
   * prints is "Artifact Creature — Construct" at 29, which is inside step 0 —
   * so the three boundaries below are written out rather than found.
   */
  it('steps down exactly at the character the bar runs out of', () => {
    expect(typeFitStepOf('c'.repeat(30))).toBe(0);
    expect(typeFitStepOf('c'.repeat(31))).toBe(1);
    expect(typeFitStepOf('c'.repeat(35))).toBe(2);
    for (const card of FACES) {
      expect(typeFitStep(card), card.id).toBe(typeFitStepOf(renderTypeLine(card)));
    }
  });

  it('sets the longest type line in the set at full size', () => {
    const longestType = [...FACES].sort(
      (left, right) => renderTypeLine(right).length - renderTypeLine(left).length,
    )[0];
    if (longestType === undefined) throw new Error('the flagship fixture is empty');
    expect(renderTypeLine(longestType)).toBe('Artifact Creature — Construct');
    expect(typeFitStep(longestType)).toBe(0);
  });
});

/**
 * The name's ladder, and what it can and cannot be held to here.
 *
 * **What this file proves:** that `nameFitStepOf` puts each name on the step its
 * character count earns, that the two entry points agree, and that the ladder is
 * monotone — a longer name is never set larger than a shorter one. All of that
 * is arithmetic and jsdom runs arithmetic.
 *
 * **What it cannot prove, and nothing in vitest can:** that a name set at that
 * step actually fits the bar. jsdom performs no layout at all, so
 * `getBoundingClientRect` is zero everywhere and `scrollWidth` is `clientWidth`
 * by construction; a test here asserting that a title fits would be asserting
 * nothing. The fit is measured in chrome-headless-shell 151 instead —
 * `../tools/face-census.ts` for the full face and `../tools/card-uniformity.ts`
 * for the played table — and the numbers those two produced are what the columns
 * in `../src/card/anatomy.ts` are calibrated from. Measured on the wordier set
 * the columns were calibrated against, before and after this ladder: three full
 * faces cut their name and now one does, and that one is a name longer than the
 * generator's own limit permits.
 */
describe('the name fit ladder', () => {
  /**
   * The boundaries, written out. The bar holds 22 characters at full size — the
   * three-pip case, which is the narrowest the cost run leaves — so 22 is step 0
   * and 23 is not. The floor is reached at 29 rather than at its own column of
   * 31, because the last step is returned rather than checked, which is the shape
   * all three ladders in `anatomy.ts` share.
   */
  it('steps down exactly at the character the bar runs out of', () => {
    expect(nameFitStepOf('n'.repeat(22))).toBe(0);
    expect(nameFitStepOf('n'.repeat(23))).toBe(1);
    expect(nameFitStepOf('n'.repeat(24))).toBe(2);
    expect(nameFitStepOf('n'.repeat(26))).toBe(3);
    expect(nameFitStepOf('n'.repeat(29))).toBe(NAME_FIT_STEPS.length - 1);
    for (const card of FACES) expect(nameFitStep(card), card.id).toBe(nameFitStepOf(card.name));
  });

  it('never sets a longer name larger than a shorter one', () => {
    const ordered = [...FACES].sort((left, right) => left.name.length - right.name.length);
    let previous = 0;
    for (const card of ordered) {
      const step = nameFitStep(card);
      expect(step, `${card.id} is set larger than a shorter name`).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
  });

  /**
   * The census, written out, and it is the same one chrome-headless-shell read
   * off the rendered page: 74 of the 83 faces were set at full size and nine
   * stepped down. Before the ladder every one of them was at full size and three
   * were cut by `text-overflow: ellipsis` instead.
   *
   * The three cards the set gained then split two ways, which is the ladder
   * doing its job on names nobody chose for length: two of them sit at full size
   * and the third is 31 characters and joins the two already at the floor. The
   * eighty-fourth face is 24 characters and joins step 2, which is why that row
   * reads 3 where the browser read 2.
   *
   * The floor row then went back to 2 and full size to 75, which is `mtg-acl`
   * landing: the one name that could not fit any step lost its subtitle to
   * flavor text and is 24 characters. That is the only card that moved, and it
   * moved the length of the sentence that was cut off it.
   */
  it('shrinks six of the ninety-five faces and leaves the rest alone', () => {
    const census = new Map<number, number>();
    for (const card of FACES) census.set(nameFitStep(card), (census.get(nameFitStep(card)) ?? 0) + 1);
    expect([...census].sort(([left], [right]) => left - right)).toEqual([
      [0, 89],
      [2, 3],
      [3, 3],
    ]);
  });

  /**
   * The limit, asserted rather than described, because a limitation nothing
   * checks is a limitation somebody re-discovers.
   *
   * The floor's column is 31 characters and `@mtg/setgen`'s
   * `CARD_NAME_MAX_LENGTH` is 40, so a name the generator is allowed to emit can
   * still be too long for one line of the narrowest bar. Such a name is
   * ellipsized on the DOM face and wrapped onto a second line by
   * `@mtg/card-render`, and `faceDetailText` carries the whole of it into every
   * face's `title` either way. This set has no such name — its longest is 27
   * characters — so what is asserted below is the gap itself rather than a card
   * that falls into it.
   *
   * An empty list here is the state to keep; a name back in it is a content
   * question about the set, not a question about this ladder.
   */
  it('cannot fit every name the generator may emit, and says which', () => {
    const floorColumn = 22 / nameFitScale(NAME_FIT_STEPS.length - 1);
    expect(Math.floor(floorColumn), 'the floor holds 31 characters').toBe(31);
    expect(floorColumn, 'the floor reaches the generator limit after all').toBeLessThan(CARD_NAME_MAX_LENGTH);

    const overLimit = FACES.filter((card) => card.name.length > CARD_NAME_MAX_LENGTH);
    expect(overLimit.map((card) => card.id)).toStrictEqual([]);
  });
});
