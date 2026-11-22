/** Static ownership and refusal boundary for the exact three-card Delve cohort. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the reviewed Delve payment route', () => {
  it('puts Forge-enumerated graveyard identities on the wire with exact bounds', () => {
    expect(bridge).toContain('chooseCardsToDelve(int genericAmount, CardCollection grave)');
    expect(bridge).toContain('"Exile cards from your graveyard to pay for delve"');
    expect(bridge).toContain('grave,');
    expect(bridge).toContain('0,');
    expect(bridge).toContain('genericAmount));');
  });

  it("keeps combined Convoke and Delve behind Hogaak's exact spell shape", () => {
    expect(bridge).toContain('"Hogaak, Arisen Necropolis".equals(source.getName())');
    expect(bridge).toContain('source.hasKeyword(Keyword.CONVOKE)');
    expect(bridge).toContain('source.hasKeyword(Keyword.DELVE)');
    expect(bridge).toContain('root.getApi() == ApiType.PermanentCreature');
    expect(bridge).toContain('"None".equals(root.getParam("ManaRestriction"))');
  });

  it("keeps Tasigur's opponent-selected return behind its exact subability shape", () => {
    expect(bridge).toContain('boolean tasigurOpponentReturn = destination == ZoneType.Hand');
    expect(bridge).toContain('"Tasigur, the Golden Fang".equals(source.getName())');
    expect(bridge).toContain('parent.getApi() == ApiType.Mill');
    expect(bridge).toContain('"Card.nonLand+YouOwn".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain(
      'Player graveyardOwner = tasigurOpponentReturn ? ability.getActivatingPlayer() : player',
    );
    expect(bridge).toContain('graveyardOwner.getCardsIn(ZoneType.Graveyard).contains(card)');
    expect(bridge).toContain('card.isLand()');
  });
});
