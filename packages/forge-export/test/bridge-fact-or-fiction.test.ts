/** Static boundary for Fact or Fiction's exact remembered-reveal TwoPiles chain. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Fact or Fiction's reviewed pile choices", () => {
  it('pins the root reveal, TwoPiles parameters, and both destination abilities', () => {
    expect(bridge).toContain('isReviewedFactOrFictionTwoPilesAbility');
    expect(bridge).toContain('"Fact or Fiction".equals(source.getName())');
    expect(bridge).toContain('parent.getApi() == ApiType.PeekAndReveal');
    expect(bridge).toContain('parent.getSubAbility() == ability');
    expect(bridge).toContain('"5".equals(parent.getParam("PeekAmount"))');
    expect(bridge).toContain('"True".equals(parent.getParam("RememberRevealed"))');
    expect(bridge).toContain('"True".equals(parent.getParam("NoPeek"))');
    expect(bridge).toContain('"You".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"Remembered".equals(ability.getParam("DefinedCards"))');
    expect(bridge).toContain('"Opponent".equals(ability.getParam("Separator"))');
    expect(bridge).toContain('"DBHand".equals(ability.getParam("ChosenPile"))');
    expect(bridge).toContain('"DBGrave".equals(ability.getParam("UnchosenPile"))');
    expect(bridge).toContain('"DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Hand"');
    expect(bridge).toContain('source.getSVar("DBHand")');
    expect(bridge).toContain(
      '"DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Graveyard"',
    );
    expect(bridge).toContain('source.getSVar("DBGrave")');
  });

  it('bounds the separator callback to the exact remembered library objects', () => {
    expect(bridge).toContain('chooseFactOrFictionPartition');
    expect(bridge).toContain('player.isOpponentOf(ability.getActivatingPlayer())');
    expect(bridge).toContain('sourceList.size() > 5');
    expect(bridge).toContain('sourceList.size() != remembered.size()');
    expect(bridge).toContain('!sourceList.containsAll(remembered)');
    expect(bridge).toContain('!remembered.containsAll(sourceList)');
    expect(bridge).toContain('outside reviewed-fact-or-fiction-v1');
  });

  it('bounds the caster callback to two disjoint exhaustive remembered piles', () => {
    expect(bridge).toContain('chooseFactOrFictionPile');
    expect(bridge).toContain('ability.getActivatingPlayer() != player');
    expect(bridge).toContain('Collections.disjoint(first, second)');
    expect(bridge).toContain('union.size() != remembered.size()');
    expect(bridge).toContain('!union.containsAll(remembered)');
    expect(bridge).toContain('!remembered.containsAll(union)');
    expect(bridge).toContain('firstTargets.add(cardTarget(card))');
    expect(bridge).toContain('secondTargets.add(cardTarget(card))');
    expect(bridge).toContain('new Choice(\n                            "choose-pile-first"');
    expect(bridge).toContain('new Choice(\n                            "choose-pile-second"');
  });
});
