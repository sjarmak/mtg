/** Forge parity for Mass Polymorph's remembered exile and DigUntil chain. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Mass Polymorph', () => {
  /**
   * Source: Card-Forge/forge at 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/m/mass_polymorph.txt`.
   */
  it('writes the attested ChangeZoneAll, DigUntil, cleanup, and shuffle chain', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-064',
      name: 'Mass Polymorph',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 64 },
      manaCost: { generic: 5, U: 1 },
      colors: ['U'],
      effects: [
        {
          kind: 'exileTarget',
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
        {
          kind: 'revealUntilCreatureCards',
          count: { kind: 'permanentsExiledThisResolution' },
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Mass Polymorph',
        'ManaCost:5 U',
        'Types:Sorcery',
        'A:SP$ ChangeZoneAll | ChangeType$ Creature.YouCtrl | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SubAbility$ DBEffect1 | SpellDescription$ Exile all creatures you control. Then reveal cards from the top of your library until you reveal that many creature cards. Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.',
        'SVar:DBEffect1:DB$ DigUntil | Amount$ X | Valid$ Creature.YouOwn | ValidDescription$ creature | RevealedDestination$ Library | RevealedLibraryPosition$ 0 | FoundDestination$ Battlefield | Shuffle$ True | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True | SubAbility$ DBEffect3',
        'SVar:DBEffect3:DB$ Shuffle',
        'SVar:X:Remembered$Amount',
        'Oracle:Exile all creatures you control. Then reveal cards from the top of your library until you reveal that many creature cards. Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.',
        '',
      ].join('\n'),
    );
  });

  it('keeps the remembered count alive when a later effect also reads it', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'test-polymorph-then-count',
      name: 'Polymorph Then Count',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 64 },
      manaCost: { generic: 5, U: 1 },
      colors: ['U'],
      effects: [
        {
          kind: 'exileTarget',
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
        {
          kind: 'revealUntilCreatureCards',
          count: { kind: 'permanentsExiledThisResolution' },
        },
        {
          kind: 'dealDamage',
          amount: { kind: 'permanentsExiledThisResolution' },
          target: { kind: 'targetOpponent' },
        },
      ],
    });

    const lines = mustTranspile(card).split('\n');
    const dig = lines.findIndex((line) => line.includes('DB$ DigUntil'));
    const shuffle = lines.findIndex((line) => line.includes('DB$ Shuffle'));
    const damage = lines.findIndex((line) => line.includes('DB$ DealDamage'));
    const cleanup = lines.findIndex((line) => line.includes('DB$ Cleanup'));
    expect(dig).toBeGreaterThanOrEqual(0);
    expect(dig).toBeLessThan(shuffle);
    expect(shuffle).toBeLessThan(damage);
    expect(damage).toBeLessThan(cleanup);
    expect(lines.filter((line) => line.includes('ClearRemembered$ True'))).toHaveLength(1);
  });
});
