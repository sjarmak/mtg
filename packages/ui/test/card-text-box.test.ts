/**
 * What the text box holds, how it is set, and where it sits in its own box.
 *
 * Three asks in one region (`mtg-6mx`, `mtg-p3p`, `mtg-not`), and this file is
 * the seam between them: the blocks a card prints, the italics that tell the
 * three kinds apart, and the buffer above the first line. Every case here is
 * built on `exampleCard`/`keyworded`, so it reads no set fixture and exports
 * with the package. The flagship-specific cases — exact counts over the real
 * 79 cards, the hand-authored flavor lines, the board-face sweep over a real
 * corpus — moved to `./card-text-box.flagship.test.ts` (`mtg-mz1`), which
 * stays private for the same reason the set itself does.
 *
 * **jsdom lays nothing out**, so the buffer itself is not measurable here — only
 * the declaration that produces it. The measurement is `../tools/text-box.ts`
 * over chrome-headless-shell, and its docblock carries the numbers: before this
 * change every one of the eighty flagship faces started its first line 9px down
 * a 101px box; after it a one-line face starts 41.05px down and ends 41.05px up,
 * a three-line face 16.2 and 16.21, and only the four wordiest are still at 9,
 * because their text fills the box.
 */
import { describe, expect, it } from 'vitest';
import type { Card as DslCard, Keyword } from '@mtg/dsl';
import { KEYWORDS, exampleCard, exaltedAbility } from '@mtg/dsl';
import { rulesTextBlocks, textBoxBlocks } from '../src/card/anatomy';
import { lineRuns, remindedBlocks, oracleBlocks } from '../src/card/text-box';
import { uiStyleSheet } from '../src/styles/index';

/** A creature carrying exactly the keywords named, for a subject nothing else here shares. */
function keyworded(keywords: readonly Keyword[]): DslCard {
  return { ...exampleCard('slc-skywatch-sentinel'), keywords: [...keywords] };
}

describe('the blocks a text box holds', () => {
  it('puts a bare keyword on the rules line and a reminded one on its own', () => {
    expect(rulesTextBlocks(keyworded(['flying']))).toEqual([{ kind: 'rules', text: 'Flying' }]);
    expect(rulesTextBlocks(keyworded(['flying', 'trample']))).toEqual([
      { kind: 'rules', text: 'Flying' },
      {
        kind: 'reminder',
        text: "Trample (This creature can deal excess combat damage to the player it's attacking.)",
        // The keyword is rules text and is set roman while the gloss on it is
        // italic, so the block says where the one ends (`mtg-vsv`). A rules or
        // flavor block declares no such run at all, which is the difference
        // between "set one way throughout" and "set roman throughout".
        roman: 'Trample',
      },
    ]);
    expect(rulesTextBlocks(keyworded(['flying'])).every((block) => block.roman === undefined)).toBe(true);
  });

  /**
   * Where the roman run ends on a line, which is the one piece of arithmetic
   * both renderers share and the one that has to survive a wrap.
   *
   * By whole words rather than by character offset, because the printed face's
   * line breaker re-joins on single spaces: an offset into the paragraph means
   * nothing on line two. `roman + rest` is the line exactly, which is what keeps
   * the words on the card the words the specification said (the cross-face sweep
   * in `packages/card-render/test/parity.test.ts` is where that is checked over
   * the whole corpus).
   */
  it('splits a line at the end of its roman run, and only there', () => {
    const [, reminder] = rulesTextBlocks(keyworded(['flying', 'trample']));
    if (reminder === undefined) throw new Error('no reminder block');
    const whole = lineRuns(reminder, reminder.text);
    // The space between the runs belongs to the roman one, which is the rule
    // `@mtg/card-render`'s `symbols.ts` states for the space before a symbol and
    // is the wider of the two word spaces on the printed face.
    expect(whole.roman).toBe('Trample ');
    expect(whole.rest.startsWith('(This creature')).toBe(true);
    expect(`${whole.roman}${whole.rest}`).toBe(reminder.text);
    // A wrapped line past the keyword is set in the block's own face throughout.
    expect(lineRuns(reminder, 'attacking.)', 6)).toEqual({ roman: '', rest: 'attacking.)' });
    // A two-word keyword, split across two lines by a wrap narrow enough to do
    // it: the first line's word is roman, and the second line's word still is.
    const strike = rulesTextBlocks(keyworded(['firstStrike']))[0];
    if (strike === undefined) throw new Error('no first strike block');
    expect(strike.roman).toBe('First strike');
    expect(lineRuns(strike, 'First', 0)).toEqual({ roman: 'First', rest: '' });
    expect(lineRuns(strike, 'strike (This creature', 1)).toEqual({
      roman: 'strike ',
      rest: '(This creature',
    });
    // A block with no roman run is never split, whatever it says.
    expect(lineRuns({ kind: 'flavor', text: 'Trample (a boot).' }, 'Trample (a boot).')).toEqual({
      roman: '',
      rest: 'Trample (a boot).',
    });
  });

  /**
   * Reminder text does not only fall on a keyword's own line, and the boundary
   * is the same boundary wherever it falls.
   *
   * A counter prints the gloss on what it does inside the sentence that puts one
   * on, so the block is a *rules* block that is roman to the parenthesis and
   * italic after it. Set roman throughout, the gloss reads as a second sentence
   * of rules rather than as an explanation of the first, which is what
   * The playtester hit on the flagship's six gloom cards (2026-08-18).
   */
  it('marks off the reminder text a rules sentence carries', () => {
    const glooming: DslCard = {
      ...exampleCard('slc-heartwood-graft'),
      effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } }],
    };
    const [block] = rulesTextBlocks(glooming);
    if (block === undefined) throw new Error('no rules block');
    expect(block.kind).toBe('rules');
    expect(block.text).toBe(
      'Put a gloom counter on target creature. (A creature with a gloom counter gets -1/-1.)',
    );
    // The sentence is the roman run and the parenthesis opens the gloss, which
    // is the same split `lineRuns` already applies to a keyword's reminder.
    expect(block.roman).toBe('Put a gloom counter on target creature. ');
    const runs = lineRuns(block, block.text);
    expect(runs.rest.startsWith('(A creature')).toBe(true);
    expect(`${runs.roman}${runs.rest}`).toBe(block.text);
    // And a sentence that prints no reminder declares no boundary, so "set one
    // way throughout" stays a statement the block makes rather than a search
    // either renderer performs.
    const plain: DslCard = {
      ...exampleCard('slc-heartwood-graft'),
      effects: [
        { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
      ],
    };
    expect(rulesTextBlocks(plain).every((line) => line.roman === undefined)).toBe(true);
  });

  /**
   * A card with every keyword prints six reminders and about nine lines, which
   * `@mtg/card-render`'s stress corpus proved overflows the printed box at its
   * readability floor. Some-but-not-all would be arbitrary, so the card prints
   * none — the decision a set designer makes about a card with no room to
   * explain anything.
   */
  it('drops every reminder rather than some, on a card with no room for them', () => {
    const loaded = keyworded(KEYWORDS);
    expect(remindedBlocks(loaded).filter((block) => block.kind === 'reminder').length).toBe(8);
    expect(rulesTextBlocks(loaded)).toEqual(oracleBlocks(loaded));
    expect(rulesTextBlocks(loaded).every((block) => block.kind === 'rules')).toBe(true);
    // And it is genuinely the box rather than a cap on the count: two reminded
    // keywords still print both.
    expect(rulesTextBlocks(keyworded(['menace', 'reach'])).filter((b) => b.kind === 'reminder').length).toBe(
      2,
    );
  });
});

describe('an ability line reminded by name rather than by keyword', () => {
  /**
   * Coliseum Duelist carries Exalted and no flat keyword, which is exactly the
   * case `remindedBlocks` used to hand straight to `oracleBlocks`: with no
   * entry in `card.keywords` there was no keyword line to replace, and the
   * function stopped there rather than noticing the card's one ability line
   * also wants a reminder. Exalted is a `TriggeredAbility`
   * (`renderTriggeredAbility` special-cases it to the bare word `Exalted`,
   * CR 702.83), not a member of `KEYWORDS`, so this is the case that proves the
   * reminder box reads the printed line rather than the keyword list.
   */
  it('reminds Exalted on a card with no flat keyword at all', () => {
    const duelist: DslCard = {
      ...exampleCard('slc-skywatch-sentinel'),
      keywords: [],
      abilities: [exaltedAbility()],
    };
    expect(rulesTextBlocks(duelist)).toEqual([
      {
        kind: 'reminder',
        text: 'Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)',
        roman: 'Exalted',
      },
    ]);
  });

  /** And the same line reminds identically when it is not the card's only line. */
  it("reminds Exalted alongside a flat keyword, on the keyword's own trailing line", () => {
    const flier: DslCard = {
      ...exampleCard('slc-skywatch-sentinel'),
      keywords: ['flying'],
      abilities: [exaltedAbility()],
    };
    expect(rulesTextBlocks(flier)).toEqual([
      { kind: 'rules', text: 'Flying' },
      {
        kind: 'reminder',
        text: 'Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)',
        roman: 'Exalted',
      },
    ]);
  });
});

describe('flavor text', () => {
  /**
   * A short flavor sentence on a card with a bare keyword and room to spare:
   * the block prints, appended after the rules line.
   */
  it('prints a flavor block on a card with room for one', () => {
    const card: DslCard = { ...keyworded(['flying']), flavorText: 'It never lands where it is watched.' };
    expect(textBoxBlocks(card).map((block) => block.kind)).toEqual(['rules', 'flavor']);
    const last = textBoxBlocks(card).at(-1);
    expect(last?.kind).toBe('flavor');
    expect(last?.text).toBe(card.flavorText);
  });

  /**
   * The rule: flavor text never costs the rules text a ladder step. A card
   * whose box is already full with every keyword's reminder keeps its rules
   * text and loses the sentence rather than trading one for the other.
   */
  it('is dropped by a card whose rules text has already filled the box', () => {
    const full = keyworded(KEYWORDS);
    const flavored: DslCard = { ...full, flavorText: 'A sentence this card has no room for at all.' };
    expect(textBoxBlocks(flavored).some((block) => block.kind === 'flavor')).toBe(false);
    expect(textBoxBlocks(flavored)).toEqual(rulesTextBlocks(full));
  });
});

describe('the stylesheet', () => {
  const sheet = uiStyleSheet();

  /**
   * The body of one rule, comments stripped.
   *
   * Read as a rule body rather than searched for in the whole sheet, because
   * `uiStyleSheet` emits its comments and this file's own prose about
   * `justify-content: safe center` is enough to satisfy a `toContain` over the
   * sheet. It did: dropping the declaration from `.mtg-card__text` left the test
   * green against the docblock four lines above it.
   */
  function ruleBody(selector: string): string {
    const bare = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = bare.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`the sheet has no rule for ${selector}`);
    const close = bare.indexOf('}', at);
    return bare.slice(at, close);
  }

  it('sets reminder and flavor text in italics and rules text roman', () => {
    expect(ruleBody(".mtg-card__line[data-block='flavor']")).toContain('font-style: italic');
    expect(sheet).toContain(".mtg-card__line[data-block='reminder'],");
    expect(ruleBody('.mtg-card__text')).not.toContain('font-style: italic');
  });

  /**
   * And takes them back off the keyword the reminder explains, which is rules
   * text (`mtg-vsv`). Read as the rule body rather than as a substring for the
   * reason `ruleBody` exists at all: the prose above the declaration in the
   * sheet says the same words and would satisfy a search over the whole file.
   */
  it('leaves the keyword of a reminder upright', () => {
    expect(ruleBody('.mtg-card__reminder-keyword')).toContain('font-style: normal');
  });

  /**
   * And puts them on the gloss a rules line carries, which is the same boundary
   * the other way up: the block's face is roman there, so it is the reminder
   * that departs from it.
   */
  it('sets the gloss inside a rules line in italics', () => {
    expect(ruleBody('.mtg-card__gloss')).toContain('font-style: italic');
  });

  /**
   * `mtg-p3p`. The buffer is `safe center` rather than a bigger top padding, and
   * `safe` is the half that cannot be dropped: the box is `overflow-y: clip`, so
   * a plain `center` would push an over-budget card's *first* line out of the top
   * of a box nobody can scroll. `safe` falls back to `start` exactly when the
   * content overflows, so the failure mode stays what it already was.
   */
  it('centers the block in the box, safely', () => {
    expect(ruleBody('.mtg-card__text')).toContain('justify-content: safe center;');
  });

  /**
   * The board face undoes it. Centering a box that clips at a fixed line count
   * would cut a line off both ends and the keyword line — printed first so it
   * survives — would be the one lost.
   *
   * What states that changed in `mtg-5f9` and the claim did not. The board box
   * was a flex column told `justify-content: flex-start`; it is a `-webkit-box`
   * now, so that it can be line-clamped and end its last kept line in an
   * ellipsis, and a `-webkit-box` packs from the start on its own — a
   * `justify-content` on it is inert, which is worse than absent because it
   * reads as the thing holding the alignment up. So the assertion is the two
   * halves that are still load-bearing: the box packs vertically from the top,
   * and nothing centers it.
   */
  it('leaves the board face top-aligned', () => {
    const board = ruleBody(".mtg-card[data-size='board'] > [data-region='rules']");
    expect(board).toContain('display: -webkit-box;');
    expect(board).toContain('-webkit-box-orient: vertical;');
    expect(board).not.toContain('center');
  });

  /**
   * `font-weight: 600` on `.mtg-card__keywords` used to carry no `[data-size]`
   * scope at all, which bolded a keyword-carrying card's first rules line on
   * the full and compact faces too. Real Magic reserves bold for an ability
   * word (CR 207.2c) and never for a keyword, so a printing never bolds
   * `Flying`. Reminder text only made the drift visible rather than causing
   * it: every keyword but flying now splits its card's first block into a
   * `reminder` block once it has one, and `Card.ts`'s `mtg-card__keywords`
   * class only ever lands on a `rules` block, so a flying-only card — the one
   * keyword this lab prints with no reminder at all, `../src/dsl/reminder.ts`
   * — kept the bold that every other keyworded card had already dropped.
   * Warden of the Sky Islands is that card. The board face keeps the bold on
   * purpose (`mtg-u69`, `../test/board-rules-text.test.ts`): a battlefield
   * thumbnail clips to two or three lines and the keyword line is printed
   * first precisely so the line a clip spares is the one combat turns on.
   */
  it('bolds the keyword line on the board face only', () => {
    expect(ruleBody(".mtg-card[data-size='board'] .mtg-card__keywords")).toContain('font-weight: 600');
    // Anchored to a line start, so the scoped selector above — which also
    // contains the class name — does not satisfy this; only a second,
    // unscoped rule would.
    expect(sheet).not.toMatch(/(?:^|\n)\.mtg-card__keywords \{/);
  });
});

describe('the New World Order gate never sees a reminder', () => {
  /**
   * The premise the whole derive-at-render-time decision rests on, checked
   * rather than asserted in prose. `redFlagsFor` reads `renderOracleText(card)`
   * and charges `longText` past 140 characters; a common carrying two red flags
   * is an error. Reminder text would add up to eighty characters to that string
   * on cards real Magic does not count as complex at all.
   *
   * The generic half of this rule lives here: reminder text never reaches the
   * counted string. The flagship's own commons are counted in the sibling
   * private file, since their counts are a property of that set.
   */
  it('never counts a reminder toward the string a card is charged on', () => {
    const trampler = keyworded(['trample']);
    expect(rulesTextBlocks(trampler).some((block) => block.kind === 'reminder')).toBe(true);
    // The box the reader sees is over the ceiling; the counted string is not,
    // because a reminder never reaches `renderOracleText`'s output at all.
    const box = rulesTextBlocks(trampler)
      .map((block) => block.text)
      .join('\n');
    expect(box.length).toBeGreaterThan(80);
  });
});
