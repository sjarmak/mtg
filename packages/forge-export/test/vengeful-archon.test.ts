/** Vengeful Archon against Forge's current checked-in card script. */
import { parseCard, safeParseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const VENGEFUL_ARCHON = parseCard({
  kind: 'creature',
  id: 'm11-037-vengeful-archon-forge',
  name: 'Vengeful Archon',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 37 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  subtypes: ['Archon'],
  power: 7,
  toughness: 7,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { hasX: true } },
      effects: [
        {
          kind: 'preventNextDamageToYouAndRetaliate',
          amount: { kind: 'chosenX' },
          target: { kind: 'targetPlayerOrPlaneswalker' },
        },
      ],
    },
  ],
});

describe('Vengeful Archon Forge export', () => {
  it('emits Forge master depleting shield and PreventionSubAbility exactly', () => {
    expect(mustTranspile(VENGEFUL_ARCHON)).toBe(
      [
        'Name:Vengeful Archon',
        'ManaCost:4 W W W',
        'Types:Creature Archon',
        'PT:7/7',
        'K:Flying',
        'A:AB$ Pump | Cost$ X | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select target player or planeswalker damaged by shield effect | IsCurse$ True | SubAbility$ ArchonPrevention | StackDescription$ None | AILogic$ Never | SpellDescription$ Prevent the next X damage that would be dealt to you this turn. If damage is prevented this way, CARDNAME deals that much damage to target player or planeswalker.',
        'SVar:ArchonPrevention:DB$ PreventDamage | Defined$ You | Amount$ X | PreventionSubAbility$ ArchonsVengeance | ShieldEffectTarget$ ParentTarget',
        'SVar:ArchonsVengeance:DB$ DealDamage | Defined$ ShieldEffectTarget | NumDmg$ PreventedDamage | SpellDescription$ CARDNAME deals that much damage to target player or planeswalker.',
        'SVar:X:Count$xPaid',
        'AI:RemoveDeck:All',
        'Oracle:Flying\\n{X}: Prevent the next X damage that would be dealt to you this turn. If damage is prevented this way, Vengeful Archon deals that much damage to target player or planeswalker.',
        '',
      ].join('\n'),
    );
  });

  it('refuses a literal shield before Forge can silently export it as X', () => {
    const parsed = safeParseCard({
      kind: 'creature',
      id: 'tst-literal-vengeful-archon',
      name: 'Literal Vengeful Archon',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 37 },
      manaCost: { generic: 4, W: 3 },
      colors: ['W'],
      power: 7,
      toughness: 7,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { W: 1 } },
          effects: [
            {
              kind: 'preventNextDamageToYouAndRetaliate',
              amount: 3,
              target: { kind: 'targetPlayerOrPlaneswalker' },
            },
          ],
        },
      ],
    });
    if (parsed.ok) expect(transpileCardScript(parsed.card).ok).toBe(false);
    expect(parsed.ok ? [] : parsed.violations.map((violation) => violation.code)).toEqual([
      'EFFECT_CONDITION_INVALID',
    ]);
  });
});
