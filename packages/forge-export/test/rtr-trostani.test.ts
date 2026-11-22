/** Source-attested Forge parity for Trostani's live triggering-creature toughness. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const TROSTANI = parseCard({
  kind: 'creature',
  id: 'rtr-206-trostani-selesnyas-voice-forge',
  name: "Trostani, Selesnya's Voice",
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 206 },
  colors: ['G', 'W'],
  manaCost: { G: 2, W: 2 },
  supertypes: ['legendary'],
  subtypes: ['Dryad'],
  keywords: [],
  power: 2,
  toughness: 5,
  abilities: [
    {
      kind: 'triggered',
      condition: 'anotherControlledCreatureEnters',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringCreatureToughness' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

describe('Trostani Forge export', () => {
  /**
   * Source: Card-Forge/forge master,
   * `forge-gui/res/cardsfolder/t/trostani_selesnyas_voice.txt`.
   */
  it('writes the controlled other-creature trigger and TriggeredCard toughness protocol', () => {
    const script = mustTranspile(TROSTANI);

    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl+Other | TriggerZones$ Battlefield | Execute$ Trig1Effect1',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ GainLife | Defined$ You | LifeAmount$ TriggeredCreatureToughness',
    );
    expect(script).toContain('SVar:TriggeredCreatureToughness:TriggeredCard$CardToughness');
  });
});
