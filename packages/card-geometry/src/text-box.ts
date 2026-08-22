/**
 * What goes in a card's text box, in order — the one composition both renderers
 * build from.
 *
 * `./anatomy.ts` is the specification of what a card face *looks* like and this
 * is the specification of what its text box *holds*, split into a file of its
 * own because the two answer different questions and because `anatomy.ts` is
 * where the fit ladder lives and the ladder has to read this. `anatomy.ts`'s
 * `textBoxBlocks` is the entry point everything else calls; `@mtg/ui`'s
 * `Card.ts` and `@mtg/card-render`'s `renderRules` both lay the blocks out, and
 * `packages/card-render/test/parity.test.ts` fails when they stop agreeing about
 * the words.
 *
 * # Three kinds of block, and only one of them is rules text
 *
 * A printed card's text box holds rules text, the reminder text that explains a
 * keyword, and flavor text, and a reader tells them apart by how they are set —
 * reminder and flavor in italics, flavor last. So a block declares its kind and
 * each renderer paints the kind its own way, rather than either of them
 * inferring from the position of a line what that line is.
 *
 * A block is not always set in a single face, and the split is a boundary
 * rather than an exception: the run before it is rules text and stays roman,
 * everything after it is a gloss and is italic. A keyword's reminder is one
 * such block, set the way a real printing sets `Trample (This creature …)`; a
 * rules line whose sentence carries a reminder is the other, set the way a
 * printing sets `Put a gloom counter on target creature. (A creature with …)`.
 * The boundary rides on the block as `roman` and `lineRuns` applies it, so
 * neither renderer decides for itself where the italics begin.
 *
 * # None of it is in `renderOracleText`, and that is deliberate
 *
 * `@mtg/dsl`'s `reminder.ts` argues the reminder half at length: the oracle
 * string is what `@mtg/setgen`'s New World Order gate counts against a 140-
 * character `longText` red flag, what `@mtg/forge-export` transpiles, and what a
 * card's cached `oracleText` is validated to equal. Reminder text and flavor
 * text belong to none of those. The `rules` blocks below are exactly
 * `renderOracleText`'s lines with its one comma-separated keyword line replaced
 * by the keyword lines a card prints, which is the only place the two differ and
 * is measured over real printings in `reminder.ts`.
 *
 * # Reminder text is all of a card's keywords or none of them
 *
 * A card with nine keywords would print six reminders and about nine lines of
 * text box, which is more than the printed face can set at its readability floor
 * — `packages/card-render`'s stress corpus overflowed by 5.7mm the first time
 * this was wired up, and its whole job is to prove that no bounded card can spill
 * its box. Printing *some* of a card's reminders would be arbitrary, so
 * `anatomy.ts`'s `textBoxBlocks` asks whether all of them fit at the bottom of
 * the fit ladder and prints `oracleBlocks` instead when they do not. That is also
 * the decision a set designer makes: a card with six keywords is a card with no
 * room to explain them, so it explains none.
 *
 * # A row may carry a cost, and the cost is not one of its words
 *
 * A planeswalker's box is ruled into rows and each loyalty ability's cost sits
 * in a badge at the left edge, outside the column the text wraps in. So a block
 * carries `loyaltyCost` beside its text and the two are laid out separately,
 * rather than the box being handed `[+1]: …` and each renderer finding the
 * colon for itself. `@mtg/dsl`'s `oracleRows` makes the split out of the
 * ability record; this file only passes it through, which is why `oracleBlocks`
 * and `remindedBlocks` read rows rather than `renderOracleText`'s string.
 *
 * The rows are not all badged. `TextBlock.loyaltyCost` says what an absent one
 * means and why it is a row a face has to be able to set.
 *
 * # The board face takes the rules blocks and nothing else
 *
 * That decision is `Card.ts`'s rather than this file's, because it is a decision
 * about the played table and not about what a card looks like — but the reason
 * belongs next to the blocks. A battlefield thumbnail's box is line-quantized
 * and clips at two or three lines (`@mtg/ui`'s `styles/card.ts`), so every line reminder
 * text adds is a line of *rules* text a player loses off the bottom, on the one
 * surface where a clip decides a block. The keyword line is printed first
 * precisely so the line that survives is the one combat turns on, and reminder
 * text would push it off. The full face and the hover zoom are where a card is
 * read rather than recognized, and that is where the explanation belongs.
 *
 * There is a second, mechanical reason and it is not a matter of taste.
 * `packages/ui/test/play/seat-voice.test.ts` sweeps every string the played surface
 * emits and fails on any second-person word at a hotseat table, where neither
 * seat is `You`. Two of the eight reminders say `you` or `your` — "as soon as it
 * comes under your control", "causes you to gain that much life" — so reminder
 * text on the board face would fail that gate outright. The gate's own docblock
 * anticipates exactly this: it asserts that no card in the pool prints a second
 * person "so the day somebody adds such a card the failure names the reason".
 */
import type { Card, OracleRow } from '@mtg/dsl';
import {
  abilityLineReminder,
  bareKeywordLine,
  keywordReminder,
  keywordRowText,
  oracleRows,
  remindedKeywords,
} from '@mtg/dsl';

/**
 * One block of a text box: a paragraph, and what kind of paragraph it is.
 *
 * `rules` is set roman; `reminder` and `flavor` are set in italics. A tagged
 * union rather than a bare string list, because "the last line is the flavor
 * text" is the kind of positional convention that survives exactly until a card
 * has no flavor text.
 */
export interface TextBlock {
  readonly kind: 'rules' | 'reminder' | 'flavor';
  readonly text: string;
  /**
   * The loyalty cost this row is activated for, printed (`+1`, `0`, `−2`), on
   * the rows that have one.
   *
   * A planeswalker's box is not one paragraph with `[+1]:` written into the
   * words; it is a column of costs and a column of text, ruled off from each
   * other. So the cost is a field rather than a prefix, and a renderer draws it
   * as a badge in a gutter the text does not enter. `@mtg/dsl`'s `oracleRows`
   * is where the split is made, once, out of the ability record — never by
   * matching a bracket against the flat oracle string.
   *
   * **Absent is a real row, not a missing one.** A planeswalker's box prints
   * uncosted rows today: its flavor text is one, and the second line of any
   * ability that prints on two is another (`oracleRows` splits those, and the
   * cost belongs to the line that states it). Both set across the whole box.
   * Every renderer therefore asks whether *this block* carries a cost, rather
   * than assuming that every row of a planeswalker's box does — which is also
   * what leaves room for the printed card's third kind of uncosted row, the
   * static or triggered ability. The DSL refuses one on a planeswalker today
   * (`ABILITY_ILLEGAL_ON_CARD_TYPE`, held in `@mtg/dsl`'s planeswalker test),
   * so no face has drawn one, and none of the three renderers would need
   * changing on the day one is allowed.
   */
  readonly loyaltyCost?: string;
  /**
   * The leading run of this block set in the rules face, when everything after
   * it is a gloss set in italics — a reminder's keyword, or the sentence a
   * counter's reminder explains.
   *
   * A printed card sets `Trample (This creature …)` with the keyword in the
   * rules face and only the parenthetical in italics, because the keyword is
   * rules text and the parenthetical is a gloss on it (`mtg-vsv`), and it sets
   * `Put a gloom counter on target creature. (A creature with a gloom counter
   * gets -1/-1.)` the same way for the same reason. So the field marks a
   * boundary between two faces rather than an exception inside one: **a block
   * that carries it sets the run before it in the rules face and everything
   * after it in italics, whatever its kind**, and a block without it is set one
   * way throughout.
   *
   * Carried on the block rather than found by a renderer looking for the first
   * `(`, so both faces put the boundary in the same place by construction, and
   * absent rather than empty on a block that has no such run, so "this block is
   * set one way throughout" stays a statement the type makes.
   */
  readonly roman?: string;
}

/** One printed line of a block, split at that block's roman boundary. */
export interface LineRuns {
  /**
   * Set roman, with the space that follows it. Empty on every line that lies
   * wholly outside the roman run.
   */
  readonly roman: string;
  /** Set in the block's own face. `roman + rest` is the line, exactly. */
  readonly rest: string;
}

/**
 * One line of a block, split into the run set roman and the run set in the
 * block's face.
 *
 * The split is by whole words, which is what makes it survive the printed
 * face's line breaker: that breaker wraps on whitespace and re-joins with a
 * single space, so a character offset into the paragraph means nothing on a
 * wrapped line while a word count means the same thing on both faces.
 * `wordsBefore` is how many of the block's words precede this line — always 0
 * on the DOM face, which sets a block as one unwrapped span, and the running
 * count of the paragraph on the printed face.
 *
 * **The space between the runs goes to the roman one**, which is the rule
 * `@mtg/card-render`'s `symbols.ts` already states for the space before a drawn
 * symbol: a run owns the whitespace that follows it. It is not only a
 * convention here, it is measured. The printed face pins every run to a
 * `textLength` computed from an upper-bound metrics table, so the space is
 * tracked out with whichever run holds it, and at 29 units the word space after
 * `Reach` comes out 35 px wide in the roman run against 31 px in the italic
 * one, where the same line set wholly in italics gives 45 px. The tighter of
 * the two was visibly tight against the parenthesis.
 */
export function lineRuns(block: TextBlock, line: string, wordsBefore = 0): LineRuns {
  const { roman } = block;
  if (roman === undefined) return { roman: '', rest: line };
  const take = roman.trim().split(/\s+/).length - wordsBefore;
  if (take <= 0) return { roman: '', rest: line };
  const head = new RegExp(`^(?:\\s*\\S+){${String(take)}}\\s*`).exec(line);
  if (head === null) return { roman: line, rest: '' };
  return { roman: head[0], rest: line.slice(head[0].length) };
}

/**
 * A card's rules text with no reminder on it: `oracleRows`' own rows, one block
 * each, cost and all.
 *
 * What the board face draws, and the fallback for a card whose box cannot hold
 * its reminders (`anatomy.ts`, `textBoxBlocks`).
 */
export function oracleBlocks(card: Card): readonly TextBlock[] {
  return oracleRows(card).map(rulesBlock);
}

/**
 * One line of rules text as a block, with the reminder text inside it marked
 * off.
 *
 * A printed card sets reminder text in italics wherever it falls, and it does
 * not only fall on a keyword's own line. A counter prints the gloss on what it
 * does in the sentence that puts one on — `Put a gloom counter on target
 * creature. (A creature with a gloom counter gets -1/-1.)`, which is
 * `@mtg/dsl`'s `counterReminderText` appended by `renderEffect` — and an Aura
 * granting landwalk prints one the same way (`renderAuraModificationClause`).
 * Set roman, that gloss reads as a second sentence of rules rather than as an
 * explanation of the first, which is the confusion italics exist on a card to
 * prevent. the playtester, 2026-08-18, on the flagship's six gloom cards: "the 'a
 * creature with a gloom counter gets -1/-1' is reminder text and should be
 * italicized".
 *
 * The boundary is the opening parenthesis, and it is found **here** rather than
 * by either renderer, which is the rule the keyword reminder already follows:
 * one composition decides where the italics begin, so the two faces cannot
 * disagree about it. The parenthesis is the whole signal because this
 * vocabulary prints one nowhere else — every effect and ability renderer writes
 * plain sentences, and mana is `{2}{U}` rather than a parenthetical.
 *
 * A line that *opens* with a parenthesis has no rules run to hang a boundary on
 * and is set one way throughout. Nothing in the vocabulary prints such a line,
 * because a gloss glosses a sentence that precedes it.
 */
function rulesBlock(row: OracleRow): TextBlock {
  const { text } = row;
  const cost = row.loyaltyCost === null ? {} : { loyaltyCost: row.loyaltyCost };
  const gloss = text.indexOf('(');
  return gloss > 0
    ? { kind: 'rules', text, roman: text.slice(0, gloss), ...cost }
    : { kind: 'rules', text, ...cost };
}

/**
 * One line of a card's rules text as a block, with the reminder this exact
 * line carries marked off when it has one.
 *
 * Every keyword in `KEYWORDS` grants its reminder through the flat vocabulary
 * `remindedBlocks` below already reads, but not every reminded thing a card
 * prints is a flat keyword — Exalted (CR 702.83) is a `TriggeredAbility`
 * because its trigger needs the kernel's own count of how many creatures
 * attacked, so `renderOracleText` prints it as the bare line `Exalted` rather
 * than folding it into the keyword line. `@mtg/dsl`'s `abilityLineReminder` is
 * keyed by that exact printed line for the same reason the keyword line is
 * sliced off by position rather than by content: `oracleRows` puts a
 * triggered ability alone in its own row by construction, so the row's text is
 * the whole of what identifies it, and a cost the row carries rides through
 * beside it. A row the table does not name falls through to
 * `rulesBlock` unchanged, which is what keeps this function the only place
 * that has to know Exalted is one of the lines a card can gain a reminder on
 * without being a keyword.
 *
 * The card comes in beside the row because two of those reminders name the
 * card's own type: hexproof and indestructible sit on any permanent
 * (`mtg-rji`), and their gloss reads "this artifact" on The Trisigil where it
 * reads "this creature" on a bear. Every other line this table names is refused
 * anywhere but a creature, so the kind changes nothing for them.
 */
function abilityLineBlock(card: Card, row: OracleRow): TextBlock {
  const reminder = abilityLineReminder(row.text, card.kind);
  if (reminder === null) return rulesBlock(row);
  const cost = row.loyaltyCost === null ? {} : { loyaltyCost: row.loyaltyCost };
  return {
    kind: 'reminder',
    text: `${reminder.keyword} ${reminder.gloss}`,
    roman: reminder.keyword,
    ...cost,
  };
}

/**
 * The same rules text with each keyword's reminder printed under it, and any
 * other reminded ability line — Exalted today — marked off in place.
 *
 * `oracleRows` puts every keyword in one comma-separated row, and this
 * replaces that one row with the lines a real card prints: the keywords with no
 * reminder together, then one reminded keyword per line. Deathgaze Cockatrice
 * prints `Flying` then `Deathtouch (…)`, Kederekt Creeper prints `Menace (…)`
 * then `Deathtouch (…)`, and `reminder.ts` names the rest.
 *
 * The row is found by **matching `keywordRowText(card.keywords)` against every
 * row's text**, not by assuming it sits at `rows[0]`. It used to assume the
 * position, on the reasoning that `abilityRows` pushes the keyword row before
 * a card's other lines — true for every card with nothing printed ahead of its
 * keywords, which was every fixture this function had ever been run against,
 * and false for an Aura: `isAuraCard` pushes an `Enchant creature` row first,
 * so a keyworded Aura's keyword row sits at `rows[1]` and the old slice cut
 * off the `Enchant creature` line's own reminder pass along with it
 * (mtg-67vm). Matching by content is also what every other row in this
 * function already does — `abilityLineReminder` keys Exalted by its exact
 * printed line for the identical reason, stated where that table lives. Rows
 * on either side of the match — `Enchant creature` ahead of it, a triggered
 * ability behind it — flow through the same `abilityLineBlock` the trailing
 * rows always used, so a reminder any of them carries (Exalted, a counter's
 * gloss) still prints.
 *
 * A card whose keywords produce no matching row is a card `oracleRows` and
 * this function have stopped agreeing about, which is a bug in one of them
 * rather than a card to render some other way, so this throws instead of
 * guessing a position.
 *
 * A land is `oracleBlocks` unchanged; lands print no keywords and no triggered
 * abilities this table names. A land *may* now print hexproof or indestructible
 * (`mtg-rji`), which this table does name, and that line still draws bare here:
 * a reminder is optional on a printed card, and this early return is what keeps
 * a land clear of the keyword-row machinery below that no land has a keyword
 * row for.
 */
export function remindedBlocks(card: Card): readonly TextBlock[] {
  if (card.kind === 'land') return oracleBlocks(card);
  const rows = oracleRows(card);
  if (card.keywords.length === 0) return rows.map((row) => abilityLineBlock(card, row));
  const keywordRow = rows.findIndex((row) => row.text === keywordRowText(card.keywords));
  if (keywordRow === -1) {
    throw new Error('text-box: card carries keywords but oracleRows prints no row that matches them');
  }
  const bare = bareKeywordLine(card.keywords);
  const reminders: readonly TextBlock[] = remindedKeywords(card.keywords).map((keyword) => {
    const runs = keywordReminder(keyword);
    if (runs === null) throw new Error(`text-box: ${keyword} was listed as reminded and has no reminder`);
    return { kind: 'reminder', text: `${runs.keyword} ${runs.gloss}`, roman: runs.keyword };
  });
  return [
    ...rows.slice(0, keywordRow).map((row) => abilityLineBlock(card, row)),
    ...(bare === null ? [] : [{ kind: 'rules', text: bare } as const]),
    ...reminders,
    ...rows.slice(keywordRow + 1).map((row) => abilityLineBlock(card, row)),
  ];
}

/**
 * Whether a run of blocks fits the box at the size the card is set at. Supplied
 * by `./anatomy.ts`, which owns the ladder and its calibration; this file
 * deliberately holds no second copy of either.
 *
 * Blocks rather than their text, because the sheet puts a wider margin above a
 * flavor line than between two rules lines, so what a run of paragraphs costs
 * depends on which kinds they are.
 */
export type BoxFits = (blocks: readonly TextBlock[]) => boolean;

/**
 * The whole text box: the rules and reminder blocks, then the flavor text when
 * the card has room left for it.
 *
 * **Whether a card prints flavor text is decided twice, and this is the second
 * time.** A generation writes the field, so the first decision is the model's:
 * `@mtg/setgen`'s prompt asks for flavor text only where a card's rules text
 * leaves the box room. The second is here, and it is arithmetic — a card whose
 * rules text and reminders already fill the box at the ladder step they need
 * prints no flavor text, however good the sentence is. the playtester asked for
 * flavor text "for the cards that have more text space available for it", and
 * how much space is available is a fact about a particular card's box rather
 * than something a writer can be sure of in advance.
 *
 * The rule is **flavor text never costs the rules text a ladder step**. The
 * card's rules blocks alone decide the step the box is set at; if the flavor
 * block still fits at that step it is printed, and otherwise it is dropped. That
 * is also what keeps this composable with `rulesFitStep`, which would otherwise
 * have to choose between sizing a box for text it might not draw and drawing
 * text it did not size for.
 */
export function composeTextBox(
  card: Card,
  blocks: readonly TextBlock[],
  fits: BoxFits,
): readonly TextBlock[] {
  const flavor = card.flavorText;
  if (flavor === undefined) return blocks;
  const withFlavor: readonly TextBlock[] = [...blocks, { kind: 'flavor', text: flavor }];
  return fits(withFlavor) ? withFlavor : blocks;
}
