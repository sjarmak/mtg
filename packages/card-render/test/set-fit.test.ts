/**
 * The gate: no card in the generated set overflows.
 *
 * This is the assertion the package exists to make. It runs over the same
 * 90-card set file the balance gate simulates, renders every card, and checks
 * every emitted file twice — once against the renderer's own fit report, and
 * once by re-deriving every run's rectangle from the markup. A fixed font size
 * that happens to suit today's set would pass the first check and fail the
 * second the day a rare gets a third sentence.
 */
import { describe, expect, it } from 'vitest';
import { renderOracleText } from '@mtg/dsl';
import { checkSvgOverflow, formatFitReport, renderSet, renderSetOrThrow } from '@mtg/card-render';
import {
  abilityCards,
  activatedCards,
  equipmentCards,
  generatedSet,
  overlongTriggerCard,
  oversizedCard,
  stressCards,
  triggerCards,
} from './fixtures/cards';

const SET = generatedSet();

describe('the generated set', () => {
  const result = renderSet(SET);

  it('has the whole set the balance gate runs on', () => {
    expect(SET.length).toBeGreaterThanOrEqual(90);
    expect(result.report.rendered).toBe(SET.length);
  });

  it('renders every card without a single fit failure', () => {
    expect(formatFitReport(result.report)).toContain('no card failed to fit');
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
  });

  it('emits no run that leaves its box', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
    expect(result.report.overflows).toEqual([]);
  });

  it('reports every card as pending art, because the set has none yet', () => {
    expect(result.report.pendingArt).toBe(SET.length);
    expect(result.report.withArt).toBe(0);
    for (const render of result.renders) expect(render.svg).toContain('data-art-state="pending"');
  });

  it('reports the longest oracle text it was up against', () => {
    const longest = SET.map((card) => renderOracleText(card).length).reduce((a, b) => (a > b ? a : b));
    expect(result.report.longestOracle?.characters).toBe(longest);
    // 97 characters when this was written; the assertion is a floor rather than
    // the number, so regenerating the set does not fail the gate spuriously.
    expect(longest).toBeGreaterThan(50);
  });

  it('gives every card a unique face', () => {
    expect(new Set(result.renders.map((render) => render.svg)).size).toBe(SET.length);
  });
});

describe('the stress cards', () => {
  const cards = [...SET, ...stressCards()];
  const result = renderSet(cards);

  it('fits text an order of magnitude longer than the set contains', () => {
    expect(result.report.longestOracle?.characters).toBeGreaterThan(370);
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
  });

  it('actually shrinks, rather than passing at one fixed size', () => {
    const sizes = new Set(
      result.renders.flatMap((render) =>
        render.fits.filter((fit) => fit.region === 'rules' && fit.lines > 0).map((fit) => fit.fontSize),
      ),
    );
    expect(sizes.size).toBeGreaterThan(1);
    expect(result.report.smallestRulesSize).toBeLessThan(29);
  });

  it('passes the same box check the set does', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
  });
});

/**
 * The answer to risk 1 of `docs/design/dsl-v1-ability-model.md` §9: a static
 * ability prints its own line, so a card can now carry three paragraphs where
 * the committed 90-card set's longest text is 97 characters on two. The design
 * pre-committed to splitting a rules-box redesign into its own bead if two
 * lines of ability text did not fit at a readable size. They do, with room: the
 * three realistic cards set at the band's *maximum* 29 units, and the ceiling
 * the bounded fields allow (276 characters: two self-scoped statics under an
 * 80-character name) drops only to 19.5, against a floor of 13.
 *
 * The assertions are bounds rather than the measured numbers, so a wording
 * change to the ability templates does not fail the gate spuriously — but a
 * change that makes an ability card shrink toward the floor does. The one
 * exception is the identity of the widest card, which is asserted outright:
 * the geometry argument is only worth anything while the card being measured
 * is actually the widest one the schema's bounded fields can express, and the
 * first version of this gate measured a card that was not (a subtype-narrowed
 * pair, 192 characters, 84 short of the real ceiling).
 */
describe('cards carrying static abilities', () => {
  const cards = abilityCards();
  const result = renderSet(cards);

  it('fits every one of them, including the widest the bounded schema allows', () => {
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.report.longestOracle?.cardId).toBe('ability-max-oracle');
    expect(result.report.longestOracle?.characters).toBeGreaterThan(250);
  });

  it('leaves the rules box well above its readability floor', () => {
    // 13 units is where `lastResortLayout` starts truncating (`regions.ts`).
    expect(result.report.smallestRulesSize).toBeGreaterThanOrEqual(19);
  });

  it('emits no run that leaves its box', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
    expect(result.report.overflows).toEqual([]);
  });

  it('prints one rules line per ability, after the keyword line', () => {
    const marshal = cards.find((card) => card.id === 'ability-two-statics');
    expect(marshal).toBeDefined();
    if (marshal === undefined) return;
    expect(renderOracleText(marshal).split('\n')).toEqual([
      'Flying, vigilance',
      'Creatures you control get +1/+0.',
      'Other Soldier creatures you control have first strike.',
    ]);
  });
});

/**
 * The same measurement for triggered abilities, and it lands in two places
 * rather than one.
 *
 * A trigger prints a condition clause before it prints what it does, so it is
 * longer prose than a static, and a realistic one still sets at the band's
 * maximum 29 units. The widest card the *length-bounded* effects allow is 364
 * characters and sets at 18.5 against the floor of 13 — one unit under slice
 * A's static ceiling, with 5.5 units of headroom, so risk 1's kill criterion
 * (a two-line ability at common needing new geometry) does not fire and
 * `anatomy.ts` is untouched again.
 *
 * The second place is `overlongTriggerCard`, which does not fit. `createToken`
 * prints a clause with no length bound, and four maximal ones across two
 * triggers overflow the box. That card is validator-legal, and the class is
 * older than this slice: a sorcery carrying six of the same clauses is 1,055
 * characters and overflows identically, because `card.effects` has no cap. The
 * gate's guarantee is the one that matters either way — the overflow is
 * reported and `renderSetOrThrow` refuses the build, rather than being
 * truncated into a face nobody can read.
 */
describe('cards carrying triggered abilities', () => {
  const cards = triggerCards();
  const result = renderSet(cards);

  it('fits every one of them, including the widest the bounded effects allow', () => {
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.report.longestOracle?.cardId).toBe('trigger-max-bounded');
    expect(result.report.longestOracle?.characters).toBeGreaterThan(340);
  });

  it('leaves the rules box well above its readability floor', () => {
    expect(result.report.smallestRulesSize).toBeGreaterThanOrEqual(18);
  });

  it('emits no run that leaves its box', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
    expect(result.report.overflows).toEqual([]);
  });

  it('prints the condition clause, then the effect sentences, on one line', () => {
    const merfolk = cards.find((card) => card.id === 'trigger-etb-lifegain');
    expect(merfolk).toBeDefined();
    if (merfolk === undefined) return;
    expect(renderOracleText(merfolk).split('\n')).toEqual([
      'Flying',
      'When Merfolk Tidecaller enters the battlefield, you gain 2 life.',
      'When Merfolk Tidecaller dies, draw a card.',
    ]);
  });

  // Abilities print in card order (`renderOracleText`), so a card that carries
  // both prints them the way it was written. The canonical order lives in
  // `sortAbilities`, which the fingerprints use so two cards that differ only
  // in authored order are still one card.
  it('prints a static and a trigger as two lines under the keyword line', () => {
    const marshal = cards.find((card) => card.id === 'trigger-and-static');
    expect(marshal).toBeDefined();
    if (marshal === undefined) return;
    expect(renderOracleText(marshal).split('\n')).toEqual([
      'Vigilance',
      'Other Soldier creatures you control get +1/+0.',
      'Whenever Vantian Marshal attacks, you gain 1 life.',
    ]);
  });

  it('reports the token-clause ceiling as a failure rather than truncating it', () => {
    const card = overlongTriggerCard();
    const overlong = renderSet([card]);
    expect(renderOracleText(card).length).toBeGreaterThan(900);
    expect(overlong.report.ok).toBe(false);
    expect(overlong.report.failures[0]?.region).toBe('rules');
    expect(overlong.report.failures[0]?.reason).toBe('height');
    expect(() => renderSetOrThrow([card])).toThrow(/trigger-overlong/);
    // Reported, and still drawn inside its boxes: the face stays readable.
    expect(checkSvgOverflow(overlong.renders[0]?.svg ?? '')).toEqual([]);
  });
});

/**
 * The same measurement for activated abilities, which completes the answer to
 * risk 1 of `docs/design/dsl-v1-ability-model.md` §9 across all three ability
 * kinds.
 *
 * An activation prints a cost clause where a trigger prints a condition clause,
 * and there are two ceilings for it because a sacrifice cost moved one. A mana
 * and tap cost is bounded by the vocabulary: five pips, a generic amount at the
 * mana-value ceiling and the tap symbol is 24 characters. A sacrifice cost
 * prints the card's own name inside the cost line (`Sacrifice CARDNAME`), so it
 * is bounded by the 80-character name limit instead and the widest cost clause
 * the schema can print is 116. Both numbers are measured below rather than
 * asserted in prose.
 *
 * Two ceiling cards follow from that. `activated-max-bounded` is the widest a
 * cost of mana and a tap allows: two abilities of two bounded effects each,
 * under an 80-character name and a full keyword line, 275 characters, setting
 * at 19.5 units. `activated-max-sacrifice` is the same card with a sacrifice
 * added to both costs: 459 characters, setting at 15.5. Both clear the floor of
 * 13 where `lastResortLayout` truncates, so the kill criterion (a two-line
 * ability at common needing new rules-box geometry) does not fire and
 * `anatomy.ts` is untouched for the fourth slice running. What a sacrifice cost
 * buys is worth naming: 4 units of type size, spent on printing a name the
 * reader can already see at the top of the card.
 *
 * The bounds are bounds rather than the measured numbers, so rewording the
 * activation template does not fail the gate spuriously — but a change that
 * makes an ability card shrink toward the floor does. The identity of the
 * widest card is asserted outright, because the geometry argument is only worth
 * anything while the card being measured is the widest one the bounded fields
 * can express.
 */
describe('cards carrying activated abilities', () => {
  const cards = activatedCards();
  const result = renderSet(cards);

  it('fits every one of them, including the widest the bounded fields allow', () => {
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.report.longestOracle?.cardId).toBe('activated-max-sacrifice');
    expect(result.report.longestOracle?.characters).toBeGreaterThan(400);
  });

  it('leaves the rules box above its readability floor', () => {
    // 13 units is where `lastResortLayout` starts truncating (`regions.ts`).
    expect(result.report.smallestRulesSize).toBeGreaterThanOrEqual(15);
  });

  /**
   * What the sacrifice ceiling costs, in the two numbers the docblock claims.
   *
   * A cost clause that names the card is 116 characters where a mana-and-tap
   * one is 24, and the card that carries two of them sets 4 units smaller than
   * the card that carries none. Asserted as a pair so that shrinking the frame
   * or lengthening the template cannot quietly close the gap.
   */
  it('pays for a sacrifice cost in type size, not in overflow', () => {
    const bounded = renderSet(cards.filter((card) => card.id !== 'activated-max-sacrifice'));
    const withSacrifice = result.report.smallestRulesSize;
    const without = bounded.report.smallestRulesSize;
    expect(withSacrifice).not.toBeNull();
    expect(without).not.toBeNull();
    if (withSacrifice === null || without === null) return;
    expect(without - withSacrifice).toBeGreaterThanOrEqual(4);
    expect(result.report.failures).toEqual([]);
  });

  it('prints the widest sacrifice cost clause the schema can express in 116 characters', () => {
    const widest = cards.find((card) => card.id === 'activated-max-sacrifice');
    expect(widest).toBeDefined();
    if (widest === undefined) return;
    const line = renderOracleText(widest).split('\n').at(-2) ?? '';
    const clause = line.slice(0, line.indexOf(':'));
    // 24 characters of mana and tap, a comma and a space, then `Sacrifice `
    // and the 80-character name limit.
    expect(clause.startsWith('{11}{W}{U}{B}{R}{G}, {T}, Sacrifice ')).toBe(true);
    expect(clause).toHaveLength(116);
  });

  it('prints a sacrifice cost on a card the flagship set would contain', () => {
    const bag = cards.find((card) => card.id === 'activated-sacrifice');
    expect(bag).toBeDefined();
    if (bag === undefined) return;
    expect(renderOracleText(bag).split('\n')).toEqual([
      '{1}, Sacrifice Bomb Bag: Bomb Bag deals 2 damage to any target.',
    ]);
  });

  it('emits no run that leaves its box', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
    expect(result.report.overflows).toEqual([]);
  });

  it('prints the widest cost clause the schema can express in 24 characters', () => {
    // The geometry argument above rests on this number and the docblock had it
    // at 22, which was a count nobody had taken: five pips at three characters
    // each, a two-digit generic in braces, then the comma and the tap symbol.
    const widest = cards.find((card) => card.id === 'activated-max-bounded');
    expect(widest).toBeDefined();
    if (widest === undefined) return;
    const line = renderOracleText(widest).split('\n').at(-2) ?? '';
    const clause = line.slice(0, line.indexOf(':'));
    expect(clause).toBe('{11}{W}{U}{B}{R}{G}, {T}');
    expect(clause).toHaveLength(24);
  });

  it('prints the cost clause, then the effect sentences, on one line', () => {
    const beacon = cards.find((card) => card.id === 'activated-ping');
    expect(beacon).toBeDefined();
    if (beacon === undefined) return;
    expect(renderOracleText(beacon).split('\n')).toEqual([
      '{1}{R}, {T}: Ashen Beacon deals 1 damage to any target.',
    ]);
  });

  it('prints a static and an activation as two lines under the keyword line', () => {
    const warden = cards.find((card) => card.id === 'activated-and-static');
    expect(warden).toBeDefined();
    if (warden === undefined) return;
    expect(renderOracleText(warden).split('\n')).toEqual([
      'Vigilance',
      'Other Merfolk creatures you control get +1/+0.',
      '{2}{U}, {T}: Tap target creature.',
    ]);
  });
});

/**
 * A weapon, whose one record prints two lines.
 *
 * The measurement that matters here is not length — an equip ability is the
 * shortest text any ability kind produces, because `checkEquipAbility` refuses
 * every cost but mana and the grant clause is one `modificationClause` over the
 * two modifications DSL v1 has. It is the paragraph count: `renderAbility`
 * returns `Equipped creature gets +2/+0.\nEquip {2}`, and the renderer splits
 * oracle text on newlines, so a weapon is a two-paragraph card the way a
 * keyworded creature with one ability is. Both already handled that; what did
 * not exist was a weapon in the corpus, which is why this block asserts the
 * printed lines outright rather than only the fit.
 */
describe('cards carrying an equip ability', () => {
  const cards = equipmentCards();
  const result = renderSet(cards);

  it('fits every one of them, cost ceiling included', () => {
    expect(result.report.failures).toEqual([]);
    expect(result.report.ok).toBe(true);
  });

  it('leaves the rules box well above its readability floor', () => {
    // 13 units is where `lastResortLayout` starts truncating (`regions.ts`).
    expect(result.report.smallestRulesSize).toBeGreaterThanOrEqual(19);
  });

  it('emits no run that leaves its box', () => {
    for (const render of result.renders) {
      expect(checkSvgOverflow(render.svg), render.cardId).toEqual([]);
    }
    expect(result.report.overflows).toEqual([]);
  });

  it('prints the granted clause and the equip line as two lines, in that order', () => {
    const sword = cards.find((card) => card.id === 'equipment-moonblade');
    expect(sword).toBeDefined();
    if (sword === undefined) return;
    expect(renderOracleText(sword).split('\n')).toEqual(['Equipped creature gets +2/+0.', 'Equip {2}']);
    const render = result.renders.find((entry) => entry.cardId === 'equipment-moonblade');
    expect(render).toBeDefined();
    if (render === undefined) return;
    // The granted clause is set as text; the equip cost is a word and a drawn
    // symbol, because `{2}` is a brace token and the face paints those
    // (`symbols.ts`). So the cost is looked for as the pieces it is drawn in.
    expect(render.svg, 'the printed face is missing the granted clause').toContain(
      'Equipped creature gets +2/+0.',
    );
    expect(render.svg, 'the printed face is missing the equip word').toContain('>Equip ');
    expect(render.svg, 'the printed face is missing the equip cost').toContain('data-symbol="{2}"');
  });

  it('prints a granted keyword the same way', () => {
    const scimitar = cards.find((card) => card.id === 'equipment-keyword');
    expect(scimitar).toBeDefined();
    if (scimitar === undefined) return;
    expect(renderOracleText(scimitar).split('\n')).toEqual([
      'Equipped creature has first strike.',
      'Equip {1}',
    ]);
  });

  it('leaves the equip line ending on its cost, with no full stop', () => {
    // Magic templates a keyword ability with a cost that way, and the line is
    // the last one on the card, so a stray full stop would show.
    for (const card of cards) {
      const last = renderOracleText(card).split('\n').at(-1) ?? '';
      expect(last.startsWith('Equip {')).toBe(true);
      expect(last.endsWith('}')).toBe(true);
    }
  });
});

describe('a card past what the DSL allows', () => {
  const card = oversizedCard();
  const result = renderSet([card]);

  it('is reported as a failure rather than silently clipped', () => {
    expect(result.report.ok).toBe(false);
    expect(result.report.failures.length).toBeGreaterThan(0);
    const failure = result.report.failures[0];
    expect(failure?.region).toBe('rules');
    expect(failure?.reason).toBe('height');
    expect(failure?.overflowMm).toBeGreaterThan(0);
  });

  it('still emits a readable face whose runs stay inside their boxes', () => {
    const render = result.renders[0];
    expect(render).toBeDefined();
    if (render === undefined) return;
    expect(checkSvgOverflow(render.svg)).toEqual([]);
    expect(render.svg).toContain('data-region="rules"');
  });

  it('names the card and the shortfall in the report', () => {
    const text = formatFitReport(result.report);
    expect(text).toContain('oversized-draft');
    expect(text).toContain('rules overflows by');
  });

  it('fails the build through renderSetOrThrow', () => {
    expect(() => renderSetOrThrow([card])).toThrow(/oversized-draft/);
    expect(() => renderSetOrThrow(SET)).not.toThrow();
  });
});
