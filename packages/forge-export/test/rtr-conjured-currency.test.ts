/** Source-attested Forge parity for RTR Conjured Currency. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CURRENCY = parseCard({
  kind: 'enchantment',
  id: 'rtr-33-conjured-currency-forge',
  name: 'Conjured Currency',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 33 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      optional: true,
      effects: [
        {
          kind: 'exchangeControl',
          exchangeSource: true,
          target: { kind: 'targetPermanentYouNeitherOwnNorControl' },
        },
      ],
    },
  ],
});

describe('Conjured Currency Forge export', () => {
  /**
   * Source: Card-Forge/forge revision 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/c/conjured_currency.txt`.
   */
  it('matches the installed source-and-target exchange script exactly', () => {
    expect(mustTranspile(CURRENCY)).toBe(
      [
        'Name:Conjured Currency',
        'ManaCost:5 U',
        'Types:Enchantment',
        'T:Mode$ Phase | Phase$ Upkeep | TriggerZones$ Battlefield | ValidPlayer$ You | Execute$ ExchangeCards | OptionalDecider$ You | TriggerDescription$ At the beginning of your upkeep, you may exchange control of CARDNAME and target permanent you neither own nor control.',
        'SVar:ExchangeCards:DB$ ExchangeControl | Defined$ Self | ValidTgts$ Permanent.YouDontCtrl+YouDontOwn | TgtPrompt$ Select target permanent you neither own nor control',
        'Oracle:At the beginning of your upkeep, you may exchange control of this enchantment and target permanent you neither own nor control.',
        '',
      ].join('\n'),
    );
  });
});
