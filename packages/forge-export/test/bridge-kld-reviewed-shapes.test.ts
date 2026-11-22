import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');
const between = (from: string, to: string): string => {
  const start = bridge.indexOf(from);
  const end = bridge.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`${from} moved`);
  return bridge.slice(start, end);
};

/** The witnesses that Forge finishes each of these are in observed-kld-unless-costs and observed-kld-searches-and-discards. */
describe('the Forge bridge holds the exact Kaladesh shapes a sweep found aborting', () => {
  it("pays Fabricate's counters only for the exact Servo-token trigger Forge builds", () => {
    const shape = between(
      'isReviewedFabricateCounterPayment(\n',
      'private boolean isScopedAkhHouOptionalPayment',
    );
    expect(shape).toContain('ability.getApi() == ApiType.Token');
    expect(shape).toContain('ability.isTrigger()');
    expect(shape).toContain('params.size() == 6');
    expect(shape).toContain('"c_1_1_a_servo".equals(params.get("TokenScript"))');
    expect(shape).toContain('"AddCounter<" + amount + "/P1P1>"');
    expect(shape).toContain('source.getController() != player');
    expect(bridge).toContain('boolean reviewedFabricateCounters = exactPayer');
  });

  it("admits Cathartic Reunion's discard-two only through the exact spell, and routes it through the Forbid chooser", () => {
    const shape = between('isReviewedCatharticReunionDiscardCost(\n', 'isReviewedGeneratedObjectTapCost');
    expect(shape).toContain('"Cathartic Reunion".equals(source.getName())');
    expect(shape).toContain('ability.getApi() == ApiType.Draw');
    expect(shape).toContain('"{1}{R}"');
    expect(shape).toContain('"2".equals(discard.getAmount())');
    // Cathartic Reunion and Cryptbreaker close the discard-cost disjunction today; a later
    // set's own isReviewed*DiscardCost joins it between or after them.
    expect(bridge).toMatch(
      /\|\|\s*isReviewedCatharticReunionDiscardCost\(discard, ability\)\s*(?:\|\|\s*[\w.]+(?:\([^()]*\))?\s*)*\|\|\s*isReviewedCryptbreakerDiscardCost\(discard, ability\)\s*(?:\|\|\s*[\w.]+(?:\([^()]*\))?\s*)*\)\s*return;/u,
    );
    expect(bridge).toMatch(
      /isReviewedCatharticReunionDiscardCost\(discard, ability\)\) \{\s*return session\.chooseFixedCountDiscardCost\(/u,
    );
  });

  it("admits Verdant Crescendo's second search only as the named card from the library or graveyard", () => {
    const shape = between(
      'boolean reviewedNissaArtisanSearch = source != null',
      'boolean reviewedLibraryZoneChange',
    );
    expect(shape).toContain('"Verdant Crescendo".equals(source.getName())');
    expect(shape).toContain('origin.equals(List.of(ZoneType.Library, ZoneType.Graveyard))');
    expect(shape).toContain('"Card.namedNissa; Nature\'s Artisan"');
    expect(shape).toContain('"Land.Basic".equals(nissaRoot.getParam("ChangeType"))');
    const candidate = between('isReviewedNissaArtisanSearchCandidate(Player player, Card card) {', '/**');
    expect(candidate).toContain('"Nissa, Nature\'s Artisan".equals(card.getName())');
    expect(candidate).toContain('card.getOwner() == player');
    expect(bridge.match(/isReviewedNissaArtisanSearchCandidate\(player, card\)/gu)).toHaveLength(2);
  });

  it("admits Cloudstone Curio's return only for a permanent the player controls that shares a type with the entrant", () => {
    const shape = between(
      'boolean reviewedCloudstoneCurioReturn = source != null',
      'boolean reviewedKitesailHiddenHandZoneChange',
    );
    expect(shape).toContain('"Cloudstone Curio".equals(source.getName())');
    expect(shape).toContain('"Triggered.Other+sharesPermanentTypeWith"');
    expect(shape).toContain('"Permanent.YouCtrl+nonArtifact".equals(curioTrigger.getParam("ValidCard"))');
    const candidate = between(
      'isReviewedCloudstoneCurioCandidate(\n',
      'private static boolean isReviewedGateToTheAfterlifeSearchCandidate',
    );
    expect(candidate).toContain('card != entered');
    expect(candidate).toContain('card.getController() == player');
    expect(candidate).toContain('card.sharesPermanentTypeWith(entered)');
    expect(bridge.match(/isReviewedCloudstoneCurioCandidate\(player, card, curioTriggered\)/gu)).toHaveLength(
      2,
    );
  });
});
