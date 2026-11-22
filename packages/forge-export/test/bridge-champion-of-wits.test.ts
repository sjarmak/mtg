import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Champion of Wits' exact trigger and Eternalize routes", () => {
  it('pins the complete entry discard ability before confirming its power-sized draw cost', () => {
    expect(bridge).toContain('isReviewedChampionOfWitsTriggeredPayment');
    expect(bridge).toContain('"Champion of Wits".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Discard');
    expect(bridge).toContain('ability.isTrigger()');
    expect(bridge).toContain('"You".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"TgtChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('"2".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"Count$CardPower".equals(source.getSVar("X"))');
    expect(bridge).toContain('part.getClass() == CostDraw.class');
    expect(bridge).toContain('"X".equals(part.getAmount())');
    expect(bridge).toContain('Forge reached Champion of Wits payment outside its exact reviewed route');
  });

  it('pins the complete Eternalize ability and source-exile cost before delegating payment', () => {
    expect(bridge).toContain('isReviewedChampionOfWitsEternalizeAbility');
    expect(bridge).toContain('ability.getApi() == ApiType.CopyPermanent');
    expect(bridge).toContain('ability.isEternalize()');
    expect(bridge).toContain('ability.getRestrictions().getZone() == ZoneType.Graveyard');
    expect(bridge).toContain('ability.getRestrictions().isSorcerySpeed()');
    expect(bridge).toContain('"Black".equals(ability.getParam("SetColor"))');
    expect(bridge).toContain('"Zombie".equals(ability.getParam("AddTypes"))');
    expect(bridge).toContain('"4".equals(ability.getParam("SetPower"))');
    expect(bridge).toContain('"4".equals(ability.getParam("SetToughness"))');
    expect(bridge).toContain('isReviewedEternalizeAbility(ability, "Champion of Wits", "{5}{U}{U}",');
    expect(bridge).toContain('mana.equals(ability.getParam("CostDesc"))');
    expect(bridge).toContain('parts.get(1).getClass() == CostExile.class');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Graveyard))');
    expect(bridge).toContain('Forge reached Champion of Wits outside its exact reviewed Eternalize route');
  });
});
