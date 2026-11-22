import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS,
  legacyCubeReviewedCopySpellRetargetRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const MALICIOUS_AFFLICTION = String.raw`Name:Malicious Affliction
ManaCost:B B
Types:Instant
A:SP$ Destroy | ValidTgts$ Creature.nonBlack | TgtPrompt$ Select target nonblack creature | SpellDescription$ Destroy target nonblack creature.
T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigCopy | CheckSVar$ Morbid | OptionalDecider$ You | TriggerDescription$ Morbid — When you cast this spell, if a creature died this turn, you may copy CARDNAME and may choose a new target for the copy.
SVar:TrigCopy:DB$ CopySpellAbility | Defined$ TriggeredSpellAbility | MayChooseTarget$ True
SVar:Morbid:Count$Morbid.1.0
Oracle:Morbid — When you cast this spell, if a creature died this turn, you may copy Malicious Affliction and may choose a new target for the copy.\nDestroy target nonblack creature.`;

const CHAIN_LIGHTNING = String.raw`Name:Chain Lightning
ManaCost:R
Types:Sorcery
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SubAbility$ DBCopy1 | SpellDescription$ CARDNAME deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.
SVar:DBCopy1:DB$ CopySpellAbility | Defined$ Parent | Controller$ TargetedOrController | UnlessPayer$ TargetedOrController | UnlessCost$ R R | UnlessSwitched$ True | MayChooseTarget$ True | AILogic$ Always | StackDescription$ None
Oracle:Chain Lightning deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.`;

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (script: string): readonly string[] =>
  legacyCubeReviewedCopySpellRetargetRefusals(new TextEncoder().encode(script), inventory);

describe('Legacy Cube exact spell-copy retarget boundary', () => {
  it('admits exactly Malicious Affliction and Chain Lightning', () => {
    expect(refusal(MALICIOUS_AFFLICTION)).toEqual([]);
    expect(refusal(CHAIN_LIGHTNING)).toEqual([]);
    expect(LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS).toEqual([240, 283]);
  });

  it.each([
    ['Malicious identity', MALICIOUS_AFFLICTION.replace('Name:Malicious Affliction', 'Name:Near Miss')],
    ['Malicious mana', MALICIOUS_AFFLICTION.replace('ManaCost:B B', 'ManaCost:1 B')],
    ['Malicious target', MALICIOUS_AFFLICTION.replace('Creature.nonBlack', 'Creature')],
    ['Malicious trigger mode', MALICIOUS_AFFLICTION.replace('Mode$ SpellCast', 'Mode$ Phase')],
    ['Malicious condition', MALICIOUS_AFFLICTION.replace('CheckSVar$ Morbid', 'CheckSVar$ Other')],
    ['Malicious decider', MALICIOUS_AFFLICTION.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent')],
    [
      'Malicious copy source',
      MALICIOUS_AFFLICTION.replace('Defined$ TriggeredSpellAbility', 'Defined$ Parent'),
    ],
    [
      'Malicious retarget flag',
      MALICIOUS_AFFLICTION.replace('MayChooseTarget$ True', 'MayChooseTarget$ False'),
    ],
    ['Chain identity', CHAIN_LIGHTNING.replace('Name:Chain Lightning', 'Name:Near Chain')],
    ['Chain damage', CHAIN_LIGHTNING.replace('NumDmg$ 3', 'NumDmg$ 4')],
    ['Chain copy source', CHAIN_LIGHTNING.replace('Defined$ Parent', 'Defined$ TriggeredSpellAbility')],
    ['Chain controller', CHAIN_LIGHTNING.replace('Controller$ TargetedOrController', 'Controller$ You')],
    ['Chain payer', CHAIN_LIGHTNING.replace('UnlessPayer$ TargetedOrController', 'UnlessPayer$ You')],
    ['Chain payment', CHAIN_LIGHTNING.replace('UnlessCost$ R R', 'UnlessCost$ R')],
    ['Chain switch', CHAIN_LIGHTNING.replace('UnlessSwitched$ True', 'UnlessSwitched$ False')],
    ['Chain AI topology', CHAIN_LIGHTNING.replace('AILogic$ Always', 'AILogic$ Never')],
    ['extra copy line', `${CHAIN_LIGHTNING}\nSVar:Other:DB$ CopySpellAbility | Defined$ Parent`],
  ])('refuses %s drift', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed spell-copy retarget composition');
  });
});
