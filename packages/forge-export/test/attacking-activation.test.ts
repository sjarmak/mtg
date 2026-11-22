/** Source-attested Forge spelling for Ancient Hellkite's combat-only activation. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

describe('Ancient Hellkite activation script', () => {
  it('writes the attacking IsPresent gate exactly as Forge does upstream', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-ancient-hellkite',
      name: 'Ancient Hellkite',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 122 },
      colors: ['R'],
      manaCost: { generic: 4, R: 3 },
      power: 6,
      toughness: 6,
      keywords: ['flying'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { R: 1 } },
          effects: [
            {
              kind: 'dealDamage',
              amount: 1,
              target: { kind: 'targetCreatureDefendingPlayerControls' },
            },
          ],
          activateOnlyWhileAttacking: true,
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'ValidTgts$ Creature.DefenderCtrl | NumDmg$ 1 | IsPresent$ Card.Self+attacking | SpellDescription$',
    );
  });

  it('keeps the attacking gate on a modal activation root', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-modal-attacker',
      name: 'Modal Attacker',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 123 },
      colors: ['R'],
      manaCost: { R: 1 },
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { R: 1 } },
          effects: [],
          modes: [
            {
              effects: [
                {
                  kind: 'pumpUntilEndOfTurn',
                  power: {
                    kind: 'ratePer',
                    rate: 1,
                    each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
                  },
                  toughness: {
                    kind: 'ratePer',
                    rate: 1,
                    each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
                  },
                  target: { kind: 'targetCreature' },
                },
              ],
            },
            {
              effects: [
                {
                  kind: 'pumpUntilEndOfTurn',
                  power: {
                    kind: 'ratePer',
                    rate: -1,
                    each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
                  },
                  toughness: {
                    kind: 'ratePer',
                    rate: -1,
                    each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
                  },
                  target: { kind: 'targetCreature' },
                },
              ],
            },
          ],
          activateOnlyWhileAttacking: true,
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.script.text.split('\n').find((line) => line.startsWith('A:'));
    expect(root).toContain('IsPresent$ Card.Self+attacking');
  });
});
