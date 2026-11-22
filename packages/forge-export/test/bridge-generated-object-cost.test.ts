import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the three reviewed generated-object costs', () => {
  it('pins both tap costs to exact sources, APIs, types, amounts, and full cost vectors', () => {
    expect(bridge).toContain('isReviewedGeneratedObjectTapCost(tap, ability)');
    expect(bridge).toContain('"Cloudgoat Ranger".equals(source.getName())');
    expect(bridge).toContain('"Kithkin".equals(cost.getType())');
    expect(bridge).toContain('"3".equals(cost.getAmount())');
    expect(bridge).toContain('"Urza, Lord High Artificer".equals(source.getName())');
    expect(bridge).toContain('"Artifact".equals(cost.getType())');
    expect(bridge).toContain('"1".equals(cost.getAmount())');
    expect(bridge).not.toContain('|| !cost.canTapSource');
  });

  it('pins Seasoned Pyromancer to its exact graveyard source-exile token ability', () => {
    expect(bridge).toContain('isReviewedSeasonedPyromancerSourceExileCost(exile, ability)');
    expect(bridge).toContain('"Seasoned Pyromancer".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Token');
    expect(bridge).toContain('"2".equals(ability.getParam("TokenAmount"))');
    expect(bridge).toContain('"r_1_1_elemental".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Graveyard))');
  });

  it("owns Seasoned Pyromancer's exact two-card ETB discard callback chain", () => {
    expect(bridge).toContain('boolean reviewedSeasoned = source != null');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberDiscarded"))');
    expect(bridge).toContain('draw.getApi() == ApiType.Draw');
    expect(bridge).toContain('token.getApi() == ApiType.Token');
    expect(bridge).toContain('cleanup.getApi() == ApiType.Cleanup');
    expect(bridge).toContain('int required = reviewedCareful');
    // The required-count ternary names three cards today; a later set can add its own reviewed
    // guard anywhere in this disjunction, tail included.
    expect(bridge).toMatch(
      /: reviewedSeasoned\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedPrismari\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedMarket\s*(?:\|\|\s*\w+\s*)*\?\s*2\s*:\s*1;/u,
    );
    expect(bridge).toContain('|| min != required');
    expect(bridge).toContain('|| max != required');
    expect(bridge).toContain('"Choose cards to discard"');
  });

  it('routes selections through the local seat and names the widened boundary version', () => {
    expect(bridge).toContain('PaymentDecision choosePermanentTapCost(');
    expect(bridge).toContain('return session.choosePermanentTapCost(player, ability, tap);');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
  });
});
