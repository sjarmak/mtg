import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Priest of Fell Rites boundary', () => {
  it('pins the targeted battlefield activation and every fixed cost part', () => {
    expect(
      [
        'isReviewedPriestOfFellRitesReanimateAbility',
        '"Priest of Fell Rites".equals(source.getName())',
        'ability.getApi() == ApiType.ChangeZone',
        '"Creature.YouCtrl".equals(ability.getParam("ValidTgts"))',
        '"Graveyard".equals(ability.getParam("Origin"))',
        '"Battlefield".equals(ability.getParam("Destination"))',
        '"True".equals(ability.getParam("SorcerySpeed"))',
        'parts.get(0).getClass() == CostTap.class',
        'parts.get(1).getClass() == CostPayLife.class',
        '"3".equals(parts.get(1).getAmount())',
        'parts.get(2).getClass() == CostSacrifice.class',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins the generated Unearth root and keeps every sibling route fail closed', () => {
    expect(
      [
        'isReviewedPriestOfFellRitesUnearthAbility',
        'ability.isKeyword(Keyword.UNEARTH)',
        'ability.getRestrictions().getZone() == ZoneType.Graveyard',
        '"Self".equals(ability.getParam("Defined"))',
        '"{3}{W}{B}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())',
        'Forge reached Priest of Fell Rites outside its exact reviewed routes',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
