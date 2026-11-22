/** Forge parity for Palisade Giant's live damage-redirection replacement. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-015-palisade-giant',
  name: 'Palisade Giant',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 15 },
  manaCost: { generic: 4, W: 2 },
  colors: ['W'],
  subtypes: ['Giant', 'Soldier'],
  power: 2,
  toughness: 7,
  redirectControllerAndOtherPermanentsDamageToSelf: true,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'preventCombatDamage' },
    },
  ],
});

describe('Palisade Giant Forge parity', () => {
  it('emits the installed Forge replacement and support line exactly', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toEqual(
      expect.arrayContaining([
        'R:Event$ DamageDone | ActiveZones$ Battlefield | ValidTarget$ You,Permanent.Other+YouCtrl | DamageTarget$ Self | ReplaceWith$ DmgMe | Description$ All damage that would be dealt to you and other permanents you control is dealt to CARDNAME instead.',
        'SVar:DmgMe:DB$ ReplaceEffect | VarName$ Affected | VarValue$ Self | VarType$ Card',
      ]),
    );
  });
});
