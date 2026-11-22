/** Static lock for Solitude's exact Evoke payment and optional ETB target. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const bridge = readFileSync(fileURLToPath(new URL('../bridge/ForgeBridge.java', import.meta.url)), 'utf8');

describe('reviewed Solitude Evoke and optional trigger target', () => {
  it('owns only Solitude optional singleton ChangeZone targeting', () => {
    expect(bridge).toContain('isReviewedSolitudeTarget');
    expect(bridge).toContain('"Solitude".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('"Creature.Other".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"TargetedController".equals(subAbility.getParam("Defined"))');
    expect(bridge).toContain('"X".equals(subAbility.getParam("LifeAmount"))');
  });

  it('keeps the payment on the human-routed bounded cost callback', () => {
    expect(bridge).toContain('isReviewedSolitudeEvokeCost');
    expect(bridge).toContain('chooseSolitudeEvokeCost');
    expect(bridge).toContain('"Card.White+Other".equals(exile.getType())');
    expect(bridge).toContain('parts.get(0).getClass() == CostExile.class');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Hand))');
    expect(bridge).toContain('"cost-card-selection"');
    expect(bridge).toContain('return PaymentDecision.card(chosen);');
  });
});
