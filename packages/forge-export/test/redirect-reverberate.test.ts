/** Source-attested Forge parity for M11 Redirect and Reverberate. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

function card(input: CardInput): ReturnType<typeof parseCard> {
  return parseCard(input);
}

describe('Redirect and Reverberate Forge export', () => {
  it('emits the current Forge spell APIs and target parameters exactly', () => {
    const redirect = card({
      kind: 'instant',
      id: 'm11-71-redirect-forge',
      name: 'Redirect',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 71 },
      manaCost: { U: 2 },
      colors: ['U'],
      effects: [{ kind: 'changeSpellTargets' }],
    });
    const reverberate = card({
      kind: 'instant',
      id: 'm11-155-reverberate-forge',
      name: 'Reverberate',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 155 },
      manaCost: { R: 2 },
      colors: ['R'],
      effects: [{ kind: 'copySpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } }],
    });

    expect(mustTranspile(redirect)).toBe(
      [
        'Name:Redirect',
        'ManaCost:U U',
        'Types:Instant',
        'A:SP$ ChangeTargets | TargetType$ Spell | Optional$ True | ValidTgts$ Card | SpellDescription$ You may choose new targets for target spell.',
        'Oracle:You may choose new targets for target spell.',
        '',
      ].join('\n'),
    );
    expect(mustTranspile(reverberate)).toBe(
      [
        'Name:Reverberate',
        'ManaCost:R R',
        'Types:Instant',
        'A:SP$ CopySpellAbility | ValidTgts$ Instant,Sorcery | TargetType$ Spell | MayChooseTarget$ True | SpellDescription$ Copy target instant or sorcery spell. You may choose new targets for the copy.',
        'Oracle:Copy target instant or sorcery spell. You may choose new targets for the copy.',
        '',
      ].join('\n'),
    );
  });

  it('keeps a target-changing spell filter aligned between Oracle and Forge targeting', () => {
    const filtered = card({
      kind: 'instant',
      id: 'tst-filtered-redirect-forge',
      name: 'Redirect',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 902 },
      manaCost: { U: 2 },
      colors: ['U'],
      effects: [{ kind: 'changeSpellTargets', spellFilter: { cardTypes: ['instant'] } }],
    });

    expect(mustTranspile(filtered)).toContain(
      'A:SP$ ChangeTargets | TargetType$ Spell | Optional$ True | ValidTgts$ Card.Instant | SpellDescription$ You may choose new targets for target instant spell.',
    );
  });
});
