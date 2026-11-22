import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedMyrBattlesphereRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Myr Battlesphere',
  'ManaCost:7',
  'Types:Artifact Creature Myr Construct',
  'PT:4/7',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create four 1/1 colorless Myr artifact creature tokens.',
  'SVar:TrigToken:DB$ Token | TokenAmount$ 4 | TokenScript$ c_1_1_a_myr | TokenOwner$ You',
  "T:Mode$ Attacks | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigPump | TriggerDescription$ Whenever CARDNAME attacks, you may tap X untapped Myr you control. If you do, CARDNAME gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.",
  'SVar:TrigPump:AB$ Pump | Cost$ tapXType<X/Myr> | Defined$ Self | NumAtt$ +X | SubAbility$ DBDealDamage',
  'SVar:DBDealDamage:DB$ DealDamage | Defined$ TriggeredDefender.Opponent & Valid Planeswalker.TriggeredDefender | NumDmg$ X',
  'SVar:X:Count$xPaid',
  'DeckHas:Ability$Token',
  "Oracle:When Myr Battlesphere enters, create four 1/1 colorless Myr artifact creature tokens.\\nWhenever Myr Battlesphere attacks, you may tap X untapped Myr you control. If you do, Myr Battlesphere gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.",
];

const inventory = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]) =>
  legacyCubeReviewedMyrBattlesphereRefusals(new TextEncoder().encode(`${lines.join('\n')}\n`), inventory);

describe('Legacy Cube reviewed Myr Battlesphere boundary', () => {
  it('admits only the exact four-Myr entry and variable attack-payment composition', () => {
    expect(refusal(EXACT)).toEqual([]);
    for (const mutation of [
      EXACT.map((line) => line.replace('Name:Myr Battlesphere', 'Name:Other Battlesphere')),
      EXACT.map((line) =>
        line.replace('Types:Artifact Creature Myr Construct', 'Types:Artifact Creature Construct'),
      ),
      EXACT.map((line) => line.replace('PT:4/7', 'PT:5/7')),
      EXACT.map((line) => line.replace('TokenAmount$ 4', 'TokenAmount$ 3')),
      EXACT.map((line) => line.replace('TokenScript$ c_1_1_a_myr', 'TokenScript$ c_1_1_a_servo')),
      EXACT.map((line) => line.replace('TokenOwner$ You', 'TokenOwner$ Opponent')),
      EXACT.map((line) => line.replace('Mode$ Attacks', 'Mode$ Blocks')),
      EXACT.map((line) => line.replace('OptionalDecider$ You', 'OptionalDecider$ Opponent')),
      EXACT.map((line) => line.replace('tapXType<X/Myr>', 'tapXType<3/Myr>')),
      EXACT.map((line) => line.replace('tapXType<X/Myr>', 'tapXType<X/Creature>')),
      EXACT.map((line) => line.replace('Defined$ Self | NumAtt$ +X', 'Defined$ Targeted | NumAtt$ +X')),
      EXACT.map((line) => line.replace('NumAtt$ +X', 'NumAtt$ +2')),
      EXACT.map((line) => line.replace('SubAbility$ DBDealDamage', 'SubAbility$ Other')),
      EXACT.map((line) => line.replace('TriggeredDefender.Opponent', 'Opponent')),
      EXACT.map((line) => line.replace('NumDmg$ X', 'NumDmg$ 2')),
      EXACT.map((line) => line.replace('SVar:X:Count$xPaid', 'SVar:X:Count$CardPower')),
      EXACT.filter((line) => !line.startsWith('SVar:DBDealDamage:')),
      EXACT.filter((line) => !line.startsWith('T:Mode$ Attacks')),
      [...EXACT, 'SVar:Extra:DB$ Draw | NumCards$ 1'],
    ]) {
      expect(refusal(mutation)).toContain('exact reviewed Myr Battlesphere composition');
    }
  });
});
