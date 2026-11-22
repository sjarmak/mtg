/**
 * Emancipation Angel's mandatory bounce (mtg-6qgu5): Forge asks the controller which permanent to
 * return, and the bridge refused the shape because no reviewed predicate covered a non-optional
 * battlefield-to-hand choice. The witness that Forge then finishes the bounce is
 * observed-avr-emancipation-angel.integration.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');
const between = (from: string, to: string): string => {
  const start = bridge.indexOf(from);
  const end = bridge.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`${from} moved`);
  return bridge.slice(start, end);
};

describe("the bridge admits Emancipation Angel's return by its exact ability and trigger", () => {
  const shape = between(
    'boolean reviewedMandatoryOwnPermanentBounce = source != null',
    'boolean reviewedKitesailHiddenHandZoneChange',
  );

  it('pins the card, the zones, the mandatory hidden choice and the ability parameters', () => {
    expect(shape).toContain('Set.of("Emancipation Angel", "Kor Skyfisher").contains(source.getName())');
    expect(shape).toContain('origin.equals(List.of(ZoneType.Battlefield))');
    expect(shape).toContain('destination == ZoneType.Hand');
    expect(shape).toContain('"Permanent.YouCtrl".equals(ability.getParam("ChangeType"))');
    expect(shape).toContain('"True".equals(ability.getParam("Hidden"))');
    expect(shape).toContain('"True".equals(ability.getParam("Mandatory"))');
    expect(shape).toContain('&& !isOptional');
    expect(shape).toContain('&& scriptedMandatory');
    expect(shape).toContain('"Select a card from your battlefield".equals(selectPrompt)');
    expect(shape).toContain('"DB", "Origin", "Destination", "ChangeType", "Hidden", "Mandatory", "AILogic"');
    expect(shape).toContain('ability.getActivatingPlayer() == player');
    expect(shape).toContain('decider == player');
  });

  it('requires the intrinsic self enters-the-battlefield trigger that executes the ability', () => {
    expect(shape).toContain('ability.isTrigger()');
    expect(shape).toContain('mandatoryBounceTrigger.getHostCard() == source');
    expect(shape).toContain('mandatoryBounceTrigger.isIntrinsic()');
    expect(shape).toContain('mandatoryBounceTrigger.getMode() == TriggerType.ChangesZone');
    expect(shape).toContain('"Card.Self".equals(mandatoryBounceTrigger.getParam("ValidCard"))');
    expect(shape).toContain('"Battlefield".equals(mandatoryBounceTrigger.getParam("Destination"))');
    expect(shape).toContain('"TrigChange".equals(mandatoryBounceTrigger.getParam("Execute"))');
  });
});

describe('the candidates for the Angel bounce are the permanents the player controls', () => {
  const candidate = between(
    'private static boolean isReviewedMandatoryOwnPermanentBounceCandidate(',
    'private static boolean isReviewedGateToTheAfterlifeSearchCandidate',
  );

  it('accepts a controlled battlefield card, the Angel herself included', () => {
    expect(candidate).toContain('card.isInZone(ZoneType.Battlefield)');
    expect(candidate).toContain('card.getController() == player');
    expect(candidate).not.toContain('source');
    expect(candidate).not.toContain('Emancipation Angel');
  });

  it('checks each offered card and each submitted answer, and reads the battlefield as its origin', () => {
    expect(bridge.match(/isReviewedMandatoryOwnPermanentBounceCandidate\(player, card\)/gu)).toHaveLength(2);
    expect(
      bridge.match(
        /\|\|\s*reviewedMandatoryOwnPermanentBounce\s*\|\|\s*reviewedMandatoryOwnLandBounce\s*\|\|\s*reviewedDoomfall/gu,
      ),
    ).toHaveLength(2);
    expect(bridge.match(/&&\s*!reviewedMandatoryOwnPermanentBounce\s*&&/gu)).toHaveLength(1);
  });
});

describe('a refused zone choice names its own shape', () => {
  const refusal = between(
    'Forge reached an unreviewed zone choice (',
    '+ ", params=" + ability.getMapParams()',
  );

  it('states origin, destination, optionality and the kind of ability that asked', () => {
    expect(refusal).toContain('origin + " -> " + destination');
    expect(refusal).toContain('isOptional ? "optional" : "mandatory"');
    expect(refusal).toContain('"trigger"');
    expect(refusal).toContain('"spell"');
    expect(refusal).toContain('"activated ability"');
    expect(refusal).toContain('"subability"');
  });

  it('no longer blames the nearest allowlist for a shape it never reviewed', () => {
    expect(bridge).not.toContain('"reviewed-yorion-zone-card-v1"');
    expect(bridge).not.toContain('"singleton-library-zone-card-v1"');
    expect(bridge).not.toContain('Forge reached a zone choice outside "');
  });
});
