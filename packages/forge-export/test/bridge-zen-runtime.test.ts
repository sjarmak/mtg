import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

const between = (from: string, to: string): string => {
  const start = bridge.indexOf(from);
  const end = bridge.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`${from} moved`);
  return bridge.slice(start, end);
};

describe('the mandatory own-permanent bounce contract', () => {
  const shape = between(
    'boolean reviewedMandatoryOwnPermanentBounce = source != null',
    'boolean reviewedKitesailHiddenHandZoneChange',
  );

  it('admits exactly Emancipation Angel and Kor Skyfisher by the shared exact shape', () => {
    expect(shape).toContain('Set.of("Emancipation Angel", "Kor Skyfisher").contains(source.getName())');
    expect(shape).toContain('origin.equals(List.of(ZoneType.Battlefield))');
    expect(shape).toContain('destination == ZoneType.Hand');
    expect(shape).toContain('"Permanent.YouCtrl".equals(ability.getParam("ChangeType"))');
    expect(shape).toContain('"True".equals(ability.getParam("Mandatory"))');
    expect(shape).toContain('"TrigChange".equals(mandatoryBounceTrigger.getParam("Execute"))');
    expect(bridge.match(/isReviewedMandatoryOwnPermanentBounceCandidate\(player, card\)/gu)).toHaveLength(2);
  });
});

describe("Living Tsunami's exact upkeep return-land payment", () => {
  const predicate = between(
    'isReviewedLivingTsunamiReturnLandCost(',
    'private static boolean isReviewedSearchForTomorrowSearch',
  );

  it('pins the source, trigger, sacrifice ability and one-land return cost', () => {
    expect(predicate).toContain('"Living Tsunami".equals(source.getName())');
    expect(predicate).toContain('ability.getApi() == ApiType.Sacrifice');
    expect(predicate).toContain('ability.isTrigger()');
    expect(predicate).toContain('trigger.getMode() == TriggerType.Phase');
    expect(predicate).toContain('trigger.getMapParams().equals(Map.of(');
    expect(predicate).toContain('"Phase", "Upkeep"');
    expect(predicate).toContain('"ValidPlayer", "You"');
    expect(predicate).toContain('"TriggerZones", "Battlefield"');
    expect(predicate).toContain('"Execute", "TrigUpkeep"');
    expect(predicate).toContain('!returned.payCostFromSource()');
    expect(predicate).toContain('"1".equals(returned.getAmount())');
    expect(predicate).toContain('"Land".equals(returned.getType())');
  });

  it('owns confirmation, chosen-cost admission and land-choice dispatch', () => {
    expect(bridge).toContain('isReviewedLivingTsunamiReturnLandPayment(cost, ability)');
    expect(bridge).toContain('Return a land you control instead of sacrificing Living Tsunami?');
    expect(bridge).toMatch(/isReviewedLivingTsunamiReturnLandCost\(\s*\(CostReturn\) part, ability\)/u);
    expect(bridge).toContain('return session.chooseLivingTsunamiReturnLandCost(');
    expect(bridge).toContain('PaymentDecision chooseLivingTsunamiReturnLandCost(');
    expect(bridge).toContain('selected Living Tsunami land became illegal');
  });
});
