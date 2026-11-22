/** Necrotic Plague against Forge's checked-in M11 card script. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const NECROTIC_PLAGUE = parseCard({
  kind: 'enchantment',
  id: 'm11-necrotic-plague',
  name: 'Necrotic Plague',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 107 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'grantTriggeredAbility',
        ability: {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
        },
      },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureDies',
      targetChooser: 'triggeringPlayer',
      effects: [{ kind: 'returnSourceAuraAttached', target: { kind: 'targetCreatureYouDontControl' } }],
    },
  ],
});

describe('Necrotic Plague in Forge', () => {
  const script = mustTranspile(NECROTIC_PLAGUE);

  it('writes the upstream granted upkeep trigger', () => {
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddTrigger$ AuraGrant1 | AddSVar$ AuraGrant1Effect1 | Description$ Enchanted creature has "At the beginning of your upkeep, sacrifice this creature."',
    );
    expect(script).toContain(
      'SVar:AuraGrant1:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ AuraGrant1Effect1 | TriggerDescription$ At the beginning of your upkeep, sacrifice CARDNAME.',
    );
    expect(script).toContain('SVar:AuraGrant1Effect1:DB$ Sacrifice | SacValid$ Self');
  });

  it('writes the upstream attachment-relative death and return protocol', () => {
    expect(script).toContain(
      "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.EnchantedBy | Execute$ Trig1Effect1 | TriggerDescription$ When enchanted creature dies, its controller chooses target creature one of their opponents controls. Return CARDNAME from its owner's graveyard to the battlefield attached to that creature.",
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ Pump | ValidTgts$ Creature | TgtPrompt$ Choose a creature your opponents control | TargetsWithDefinedController$ TriggeredCardOpponent | IsCurse$ True | TargetingPlayer$ TriggeredCardController | SubAbility$ Trig1Effect1Hold',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1Hold:DB$ ChangeZone | Defined$ Self | Origin$ Graveyard | Destination$ Battlefield | AttachedTo$ ParentTarget',
    );
  });
});
