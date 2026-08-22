/**
 * A conditional static keeps its subtype capitalized (mtg-94zn).
 *
 * The unconditional branch always printed "Monster creatures you control have
 * menace" correctly; the conditional one printed "monster creatures", because
 * `asClause` lowercases the word that opens the sentence so it can follow the
 * condition's comma, and its one exception was the card's own name. A subtype is
 * a proper noun for the same reason a card name is, and the tests below pin both
 * halves: the word that was capitalized before the renderer capitalized anything
 * survives, and the word the renderer itself supplied does not.
 */
import { describe, expect, it } from 'vitest';
import { renderAbility } from '@mtg/dsl';
import type { Ability, Condition } from '@mtg/dsl';

const THREE_MONSTERS: Condition = { kind: 'controlsSubtype', subtype: 'Monster', atLeast: 3 };
const ANY_GLOOM: Condition = { kind: 'anyCreatureHasCounter', counter: 'gloom' };

describe('a static ability under a condition', () => {
  it('keeps the subtype capitalized where the sentence opens with it', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Monster',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
      enabledWhile: THREE_MONSTERS,
    };
    expect(renderAbility(ability, 'Horns of the Warren Camp')).toBe(
      'As long as you control three or more Monsters, Monster creatures you control get +1/+1.',
    );
  });

  it('keeps it capitalized under the other condition kind and the other verb', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Construct',
      modification: { kind: 'grantKeyword', keyword: 'vigilance' },
      enabledWhile: ANY_GLOOM,
    };
    expect(renderAbility(ability, 'Vorn Captain Construct')).toBe(
      'As long as any creature has a gloom counter, Construct creatures you control have vigilance.',
    );
  });

  it('still lowercases the word the renderer supplied, not the one the data did', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Monster',
      modification: { kind: 'statBonus', power: 1, toughness: 0 },
      enabledWhile: THREE_MONSTERS,
    };
    // "Other" is the scope's word, so it lowercases; "Monster" is the data's, so
    // it does not. Both in one sentence is the whole distinction.
    expect(renderAbility(ability, 'Marauder Woodcutter')).toBe(
      'As long as you control three or more Monsters, other Monster creatures you control get +1/+0.',
    );
  });

  it('lowercases a sentence with no subtype at the front at all', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
      enabledWhile: THREE_MONSTERS,
    };
    expect(renderAbility(ability, 'Banner of the Household Guard')).toBe(
      'As long as you control three or more Monsters, creatures you control get +1/+1.',
    );
  });

  it('lowercases a combat static whose subject sits mid-sentence', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Monster',
      modification: { kind: 'mustBeBlockedIfAble' },
      enabledWhile: THREE_MONSTERS,
    };
    // The sentence opens with "All", which the renderer supplied; the subtype is
    // four words in and never had a capital taken off it.
    expect(renderAbility(ability, 'Lure of the Camp')).toBe(
      'As long as you control three or more Monsters, all creatures able to block Monster creatures you control do so.',
    );
  });

  it('renders the unconditional form unchanged, which is what did not break', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Monster',
      modification: { kind: 'grantKeyword', keyword: 'menace' },
    };
    expect(renderAbility(ability, 'Depths Marauder Brute')).toBe(
      'Monster creatures you control have menace.',
    );
  });
});
