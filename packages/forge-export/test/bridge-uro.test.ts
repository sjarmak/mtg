import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Uro boundary', () => {
  it('pins the complete Escape ability and five-other-card cost vector', () => {
    expect(bridge).toContain('isReviewedUroEscapeAbility');
    expect(bridge).toContain('isReviewedKroxaEscapeAbility');
    expect(bridge).toContain('"Uro, Titan of Nature\'s Wrath".equals(source.getName())');
    expect(bridge).toContain('hasReviewedTitanEscapeShape(ability, "Kroxa, Titan of Death\'s Hunger")');
    expect(bridge).toContain('ability.isEscape()');
    expect(bridge).toContain(
      '"{U}{U}{G}{G}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())',
    );
    expect(bridge).toContain(
      '"{B}{B}{R}{R}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())',
    );
    expect(bridge).toContain('"5".equals(exile.getAmount())');
    expect(bridge).toContain('"Card.Other".equals(exile.getType())');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Graveyard))');
    expect(bridge).toContain('parts.get(1).getClass() == CostExile.class');
  });

  it('pins the exact optional land route and attack trigger', () => {
    expect(bridge).toContain('isReviewedUroLandPlacement');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Hand))');
    expect(bridge).toContain('destination == ZoneType.Battlefield');
    expect(bridge).toContain('"Land".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('isReviewedUroAttackTrigger');
    expect(bridge).toContain('"True".equals(trigger.getParam("Secondary"))');
  });

  it('distinguishes and fail-closes the two simultaneous enter triggers', () => {
    expect(bridge).toContain('private static boolean isReviewedUroSacrificeAbility(');
    expect(bridge).toContain('private static String reviewedUroTriggerOrderLabel(');
    expect(bridge).toContain('BridgeController.isReviewedUroAttackTrigger(wrapper)');
    expect(bridge).toContain('"sacrifice-unless-escaped trigger next"');
    expect(bridge).toContain('"gain 3 life, draw a card, and optional land trigger next"');
    expect(bridge).toContain('"Forge reached simultaneous Uro triggers outside their exact reviewed route"');
  });

  it('uses exact human choices and fails closed on drift', () => {
    expect(bridge).toContain('chooseTitanEscapeExileCost');
    expect(bridge).toContain('"cost-card-selection"');
    expect(bridge).toContain('"zone-decline"');
    expect(bridge).toContain('Forge reached a Titan Escape outside its exact reviewed route');
    expect(bridge).toContain('Forge reached Uro trigger confirmation outside its exact reviewed route');
    expect(bridge).toContain('Forge reached Uro land placement outside its exact reviewed route');
  });

  it("pins Kroxa's opposing discard and conditional life-loss chain", () => {
    expect(bridge).toContain('boolean reviewedKroxa = source != null');
    expect(bridge).toContain(
      '"DB$ Discard | Mode$ TgtChoose | Defined$ Player.Opponent | NumCards$ 1 | RememberDiscarded$ True | SubAbility$ DBRepeat"',
    );
    expect(bridge).toContain(
      '"DB$ RepeatEach | RepeatPlayers$ Player.Opponent | RepeatSubAbility$ DBLoseLife | SubAbility$ DBCleanup"',
    );
    expect(bridge).toContain(
      '"DB$ LoseLife | LifeAmount$ 3 | ConditionCheckSVar$ X | ConditionSVarCompare$ EQ0 | Defined$ Player.IsRemembered"',
    );
    expect(bridge).toContain('player.isOpponentOf(ability.getActivatingPlayer())');
    expect(bridge).toContain('kroxaRepeat.getApi() == ApiType.RepeatEach');
    expect(bridge).toContain('kroxaLoseLife.getApi() == ApiType.LoseLife');
    expect(bridge).toContain('kroxaCleanup.getApi() == ApiType.Cleanup');
  });
});
