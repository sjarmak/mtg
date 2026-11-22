/** Frost Titan against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const FROST_TITAN = parseCard({
  kind: 'creature',
  id: 'm11-frost-titan',
  name: 'Frost Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 55 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBecomesTargetByOpponent',
      effects: [],
      counterTriggeringSpellOrAbilityUnless: { cost: { generic: 2 } },
    },
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'tapPermanent',
          target: { kind: 'targetPermanent' },
          doesNotUntap: true,
        },
      ],
    },
  ],
});

describe('Frost Titan in Forge', () => {
  const script = mustTranspile(FROST_TITAN);

  it('filters the target trigger to opponent-controlled spells and abilities', () => {
    expect(script).toContain(
      'T:Mode$ BecomesTarget | ValidSource$ SpellAbility.OppCtrl | ValidTarget$ Card.Self | ' +
        'TriggerZones$ Battlefield | Execute$ Trig1Counter',
    );
    expect(script).toContain(
      'SVar:Trig1Counter:DB$ Counter | Defined$ TriggeredSourceSA | UnlessCost$ 2 | ' +
        'UnlessPayer$ TriggeredSourceSAController',
    );
  });

  it('exports both the arrival and attack modes with the same held-tap payload', () => {
    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | ' +
        'Execute$ Trig2Effect1',
    );
    expect(script).toContain(
      'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Trig2Effect1 | Secondary$ True',
    );
    expect(script).toContain('SVar:Trig2Effect1:DB$ Tap | ValidTgts$ Permanent');
    expect(script).toContain(
      "KW$ HIDDEN This card doesn't untap during your next untap step. | Duration$ Permanent",
    );
    expect(script).toContain('SVar:HasAttackEffect:TRUE');
  });

  it('keeps the exact Oracle text in the exported card', () => {
    expect(script).toContain(`Oracle:${renderOracleText(FROST_TITAN).replaceAll('\n', '\\n')}`);
  });
});
