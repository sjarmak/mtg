/** Ice Cage against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const ICE_CAGE = parseCard({
  kind: 'enchantment',
  id: 'm11-ice-cage',
  name: 'Ice Cage',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 57 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }, { kind: 'cantActivateAbilities' }],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureBecomesTarget',
      effects: [{ kind: 'destroyPermanent', target: { kind: 'selfPermanent' } }],
    },
  ],
});

describe('Ice Cage in Forge', () => {
  const script = mustTranspile(ICE_CAGE);

  it('writes the shipped combined lock and attachment-relative target trigger', () => {
    expect(script).toContain('SVar:AttachAILogic:Curse');
    expect(script).toContain(
      "S:Mode$ CantAttack,CantBlock,CantBeActivated | ValidCard$ Creature.EnchantedBy | Description$ Enchanted creature can't attack or block and its activated abilities can't be activated.",
    );
    expect(script).toContain(
      'T:Mode$ BecomesTarget | ValidTarget$ Card.AttachedBy | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ When enchanted creature becomes the target of a spell or ability, destroy CARDNAME.',
    );
    expect(script).toContain('SVar:Trig1Effect1:DB$ Destroy | Defined$ Self');
  });

  it('prints the current Oracle wording', () => {
    expect(script).toContain(
      "Oracle:Enchant creature\\nEnchanted creature can't attack or block, and its activated abilities can't be activated.\\nWhen enchanted creature becomes the target of a spell or ability, destroy this Aura.",
    );
  });
});
