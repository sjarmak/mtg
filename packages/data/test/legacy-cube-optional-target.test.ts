import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedOptionalTargetRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));

const teferi = [
  'Name:Teferi, Time Raveler',
  'ManaCost:1 W U',
  'Types:Legendary Planeswalker Teferi',
  "A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | Origin$ Battlefield | Destination$ Hand | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Artifact,Creature,Enchantment | TgtPrompt$ Select target artifact, creature, or enchantment | SpellDescription$ Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card. | SubAbility$ DBDraw",
  'SVar:DBDraw:DB$ Draw',
] as const;

const nissa = [
  'Name:Nissa, Who Shakes the World',
  'ManaCost:3 G G',
  'Types:Legendary Planeswalker Nissa',
  "A:AB$ PutCounter | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | CounterType$ P1P1 | CounterNum$ 3 | ValidTgts$ Land.nonCreature+YouCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target noncreature land you control | SubAbility$ DBUntap | SpellDescription$ Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that's still a land.",
  'SVar:DBUntap:DB$ Untap | Defined$ Targeted | SubAbility$ DBAnimate',
  'SVar:DBAnimate:DB$ Animate | Defined$ Targeted | Power$ 0 | Toughness$ 0 | Types$ Creature,Elemental | Keywords$ Vigilance & Haste | Duration$ Permanent',
] as const;

describe('Legacy Cube reviewed optional targets', () => {
  it.each([
    ['Teferi', teferi],
    ['Nissa', nissa],
  ] as const)('admits only the exact %s optional singleton route', (_label, script) => {
    expect(legacyCubeReviewedOptionalTargetRefusals(bytes(script), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', teferi.map((line) => line.replace('Teferi, Time Raveler', 'Unreviewed Walker'))],
    ['two targets', teferi.map((line) => line.replace('TargetMax$ 1', 'TargetMax$ 2'))],
    ['another counter amount', nissa.map((line) => line.replace('CounterNum$ 3', 'CounterNum$ 2'))],
    ['another animation', nissa.map((line) => line.replace('Power$ 0', 'Power$ 1'))],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedOptionalTargetRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
