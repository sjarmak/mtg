/**
 * `TargetFilter.keywords`: the field that makes "each creature with flying" a
 * sentence this DSL can write.
 *
 * Every other narrowing a sweep wanted was already there — a card type, a
 * conjunction of card types, a subtype, a color, a combat role — and the one
 * missing dimension was the one M13 191 is built on. Silklash Spider is refused
 * on this and on nothing else, so it is the acceptance test rather than an
 * illustration: the announcement half (`{X}` on an activation, `chosenX` in the
 * effect) already shipped, and the card still would not validate.
 *
 * The field is admitted on a `scopeFilter` and refused everywhere else, which is
 * the one-card-one-encoding rule showing up as three assertions rather than one.
 * A target slot already spells the same narrowing as a `withKeyword`
 * restriction, and a spell on the stack has no keywords worth reading, so the
 * two refusals below are not gaps left open — they are the rule stated at the
 * two places an author would otherwise write the second encoding.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect, TargetFilter } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

/** `{X}{G}{G}: This creature deals X damage to each creature with flying.` */
function spiderInput(scopeFilter: TargetFilter): CardInput {
  return {
    kind: 'creature',
    id: 'tst-silklash',
    name: 'Silklash Spider',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 4, G: 2 },
    colors: ['G'],
    power: 2,
    toughness: 7,
    keywords: ['reach'],
    effects: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { G: 2, hasX: true } },
        effects: [
          {
            kind: 'dealDamage',
            amount: { kind: 'chosenX' },
            scope: 'allPermanents',
            scopeFilter,
            target: { kind: 'noTarget' },
          },
        ],
      },
    ],
  } as unknown as CardInput;
}

function sorceryInput(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-keyword-sorcery',
    name: 'Windshear',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

function codesFor(input: CardInput): readonly string[] {
  return validateCard(input as unknown as Parameters<typeof validateCard>[0]).map((found) => found.code);
}

describe('a keyword on a scope filter', () => {
  /**
   * The bead's acceptance criterion, printed. Zero violations and the M13 line
   * word for word: the noun comes from `cardTypes`, the clause behind it comes
   * from `keywords`, and "each" comes from CR 120.3's distributive damage.
   */
  it('validates Silklash Spider and prints its line', () => {
    const card = parseCard(spiderInput({ cardTypes: ['creature'], keywords: ['flying'] }));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Reach\n{X}{G}{G}: Silklash Spider deals X damage to each creature with flying.',
    );
  });

  /**
   * A sided sweep puts the clause in front of the control phrase, which is the
   * whole reason the clause is built inside `scopeNoun` rather than appended by
   * the caller: Thundermaw Hellkite prints "each creature with flying your
   * opponents control", and a clause bolted on after the template would have
   * printed "each creature your opponents control with flying".
   */
  it('prints the clause before the control phrase on a sided sweep', () => {
    const card = parseCard(
      sorceryInput([
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          scope: 'permanentsOpponentsControl',
          scopeFilter: { cardTypes: ['creature'], keywords: ['flying'] },
          target: { kind: 'noTarget' },
        } as unknown as Effect,
      ]),
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain('Creatures with flying your opponents control');
  });

  /**
   * Two keywords are read as a conjunction, the way `ObjectFilter.keywords` is
   * read with `every`, so the printed word is "and" rather than "or". A sweep
   * that printed "or" would describe a wider group than the matcher hits.
   */
  it('joins two keywords with "and"', () => {
    const card = parseCard(spiderInput({ cardTypes: ['creature'], keywords: ['flying', 'trample'] }));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain('each creature with flying and trample');
  });

  /**
   * The one-encoding rule at the site an author would break it. A target slot
   * that wants "target creature with flying" has `withKeyword`, and admitting
   * both spellings would give one printed sentence two canonical forms — which
   * `checkDuplicateEffects` compares by bytes, so the two would stop being
   * recognized as the same card.
   */
  it('refuses a keyword on a target slot and names the restriction instead', () => {
    const codes = codesFor(
      sorceryInput([
        {
          kind: 'dealDamage',
          amount: 2,
          target: { kind: 'targetCreature', filter: { keywords: ['flying'] } },
        } as unknown as Effect,
      ]),
    );
    expect(codes).toContain('ILLEGAL_TARGET_FILTER');
  });

  /**
   * And on the stack, where the honest answer is that there is none: a spell is
   * not a permanent, the CR 613 walk that decides "has flying" runs over the
   * battlefield, and a counterspell narrowed on a keyword would be reading
   * printed text under a field whose whole point is that it reads current
   * characteristics.
   */
  it('refuses a keyword on a spell filter', () => {
    const codes = codesFor(
      sorceryInput([
        {
          kind: 'counterSpell',
          spellFilter: { keywords: ['flying'] },
        } as unknown as Effect,
      ]),
    );
    expect(codes).toContain('ILLEGAL_TARGET_FILTER');
  });

  /**
   * The list rules a target filter has always obeyed, now reaching the scope
   * path too. `checkFilterLists` was called from the target and spell sites and
   * from nowhere else, so a sweep could repeat a card type and nothing said so;
   * a duplicate keyword is the same mistake in the field this lane added, and
   * it would otherwise have been validated nowhere at all.
   */
  it('refuses a repeated keyword on the scope filter', () => {
    const codes = codesFor(spiderInput({ cardTypes: ['creature'], keywords: ['flying', 'flying'] }));
    expect(codes).toContain('ILLEGAL_TARGET_FILTER');
  });
});
