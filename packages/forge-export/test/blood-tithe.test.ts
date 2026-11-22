import { describe, expect, it } from 'vitest';
import { mustTranspile, spell } from './helpers';

describe('Blood Tithe', () => {
  /**
   * Source: Card-Forge/forge at 7ba1a39343d6ea7e96e153d0fd7f532ad39863c4,
   * `forge-gui/res/cardsfolder/b/blood_tithe.txt`. The repository adds its
   * standard DeckHas hint; the ability chain and `AFLifeLost` declaration are
   * the upstream lines.
   */
  it('writes Forge current linked-life chain and declaration', () => {
    const card = spell(
      'Blood Tithe',
      [
        { kind: 'loseLife', amount: 3, players: 'eachOpponent', target: { kind: 'noTarget' } },
        {
          kind: 'gainLife',
          amount: { kind: 'lifeLostThisResolution' },
          target: { kind: 'noTarget' },
        },
      ],
      {
        kind: 'sorcery',
        manaCost: { generic: 3, B: 1 },
        colors: ['B'],
        set: { code: 'M11', collectorNumber: 84 },
      },
    );

    expect(mustTranspile(card)).toBe(
      [
        'Name:Blood Tithe',
        'ManaCost:3 B',
        'Types:Sorcery',
        'A:SP$ LoseLife | Defined$ Player.Opponent | LifeAmount$ 3 | SubAbility$ DBEffect1 | SpellDescription$ Each opponent loses 3 life. You gain life equal to the life lost this way.',
        'SVar:DBEffect1:DB$ GainLife | Defined$ You | LifeAmount$ AFLifeLost',
        'SVar:AFLifeLost:Number$0',
        'DeckHas:Ability$LifeGain',
        'Oracle:Each opponent loses 3 life. You gain life equal to the life lost this way.',
        '',
      ].join('\n'),
    );
  });

  it('refuses the linked amount when no earlier LoseLife effect can populate it', () => {
    const card = spell('Unfed Tithe', [
      {
        kind: 'gainLife',
        amount: { kind: 'lifeLostThisResolution' },
        target: { kind: 'noTarget' },
      },
    ]);
    expect(() => mustTranspile(card)).toThrow(/UNMAPPED_COMPUTED_AMOUNT/u);
  });
});
