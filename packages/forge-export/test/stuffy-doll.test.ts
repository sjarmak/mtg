/** Source-attested Forge parity for M13 Stuffy Doll. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const STUFFY_DOLL = parseCard({
  kind: 'creature',
  id: 'm13-218-stuffy-doll-forge',
  name: 'Stuffy Doll',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 218 },
  manaCost: { generic: 5 },
  colors: [],
  artifact: true,
  subtypes: ['Construct'],
  power: 0,
  toughness: 1,
  keywords: [],
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: { kind: 'choosePlayer' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'triggeringDamageAmount' },
          target: { kind: 'chosenPlayer' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'selfPermanent' } }],
    },
  ],
});

describe('Stuffy Doll Forge export', () => {
  /**
   * Source: Card-Forge/forge at current main on 2026-08-26,
   * `forge-gui/res/cardsfolder/s/stuffy_doll.txt`.
   */
  it('writes Forge linked-player, damage-trigger, and self-damage protocols', () => {
    const script = mustTranspile(STUFFY_DOLL);

    expect(script).toContain('K:Indestructible');
    expect(script).toContain('K:ETBReplacement:Other:ChooseP');
    expect(script).toContain(
      'SVar:ChooseP:DB$ ChoosePlayer | Defined$ You | Choices$ Player | AILogic$ Curse | SpellDescription$ As CARDNAME enters, choose a player.',
    );
    expect(script).toContain('T:Mode$ DamageDoneOnce');
    expect(script).toContain('ValidTarget$ Card.Self');
    expect(script).toContain('TriggerZones$ Battlefield');
    expect(script).toContain('SVar:Trig1Effect1:DB$ DealDamage');
    expect(script).toContain('Defined$ ChosenPlayer');
    expect(script).toContain('NumDmg$ X');
    expect(script).toContain('SVar:X:TriggerCount$DamageAmount');
    expect(script).toContain('A:AB$ DealDamage | Cost$ T');
    expect(script).toContain('Defined$ Self | NumDmg$ 1');
  });
});
