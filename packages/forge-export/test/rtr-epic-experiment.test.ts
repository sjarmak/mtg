/** Forge parity for Epic Experiment's source-attested Dig/Play/cleanup chain. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Epic Experiment', () => {
  /**
   * Source: installed Forge 2.0.14,
   * `forge-gui/res/cardsfolder/e/epic_experiment.txt`, SHA-256
   * 0c673bfaabdd2e3b665ba1a24331abb40c7acf686d9ea9f1a2e9145b876c05e3.
   */
  it('writes the exact remembered top-X, eligible optional casts, remainder, and cleanup chain', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'rtr-159',
      name: 'Epic Experiment',
      rarity: 'mythic',
      set: { code: 'RTR', collectorNumber: 159 },
      manaCost: { hasX: true, U: 1, R: 1 },
      colors: ['R', 'U'],
      effects: [
        {
          kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
          topXOriginalsProfile: true,
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Epic Experiment',
        'ManaCost:X U R',
        'Types:Sorcery',
        "A:SP$ Dig | Defined$ You | DigNum$ X | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | SubAbility$ DBEffect1 | SpellDescription$ Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.",
        'SVar:DBEffect1:DB$ Play | Valid$ Card.IsRemembered+YouOwn | ValidZone$ Exile | ValidSA$ Instant.cmcLEX,Sorcery.cmcLEX | Controller$ You | WithoutManaCost$ True | Optional$ True | Amount$ All | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ ChangeZoneAll | Origin$ Exile | Destination$ Graveyard | ChangeType$ Card.IsRemembered+YouOwn | SubAbility$ DBEffect3',
        'SVar:DBEffect3:DB$ Cleanup | ClearRemembered$ True',
        'SVar:X:Count$xPaid',
        "Oracle:Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.",
        '',
      ].join('\n'),
    );
  });
});
