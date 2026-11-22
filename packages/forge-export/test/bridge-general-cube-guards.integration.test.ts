/** Compile the bridge against Forge and mutation-test the two Cube guard profiles. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts the installed Cube scripts and rejects adjacent search and discard shapes',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'GeneralCubeGuardProbe.java');
      writeFileSync(
        source,
        `
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.List;
public class GeneralCubeGuardProbe {
  private static Card card(String edition, String... script) {
    var rules = CardRules.fromScript(List.of(script));
    return CardFactory.getCard(new PaperCard(rules, edition, CardRarity.Uncommon), null, null);
  }
  private static boolean invoke(String owner, String name, SpellAbility ability) throws Exception {
    var method = Class.forName(owner).getDeclaredMethod(name, SpellAbility.class);
    method.setAccessible(true);
    return (boolean) method.invoke(null, ability);
  }
  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");

    Card searchCard = card(
      "TSP",
      "Name:Search for Tomorrow",
      "ManaCost:2 G",
      "Types:Sorcery",
      "K:Suspend:2:G",
      "A:SP$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | SpellDescription$ Search your library for a basic land card, put it onto the battlefield, then shuffle."
    );
    SpellAbility search = AbilityFactory.getAbility(
      "SP$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | SpellDescription$ Search your library for a basic land card, put it onto the battlefield, then shuffle.",
      searchCard
    );
    boolean searchNormal = invoke("ForgeBridge$BridgeController", "isReviewedSearchForTomorrowSearch", search);
    search.putParam("WithoutManaCost", "True");
    boolean searchSuspended = invoke("ForgeBridge$BridgeController", "isReviewedSearchForTomorrowSearch", search);
    search.putParam("ChangeType", "Land");
    boolean searchMutated = invoke("ForgeBridge$BridgeController", "isReviewedSearchForTomorrowSearch", search);

    Card carefulCard = card(
      "TSP",
      "Name:Careful Consideration",
      "ManaCost:2 U U",
      "Types:Instant",
      "A:SP$ Draw | NumCards$ 4 | ValidTgts$ Player | SubAbility$ DBDiscard | SpellDescription$ Target player draws four cards, then discards three cards. If you cast this spell during your main phase, instead that player draws four cards, then discards two cards.",
      "SVar:DBDiscard:DB$ Discard | NumCards$ X | Mode$ TgtChoose | Defined$ Targeted",
      "SVar:X:Count$IfCastInOwnMainPhase.2.3"
    );
    carefulCard.setSVar("DBDiscard", "DB$ Discard | NumCards$ X | Mode$ TgtChoose | Defined$ Targeted");
    carefulCard.setSVar("X", "Count$IfCastInOwnMainPhase.2.3");
    SpellAbility carefulRoot = AbilityFactory.getAbility(
      "SP$ Draw | NumCards$ 4 | ValidTgts$ Player | SubAbility$ DBDiscard | SpellDescription$ Target player draws four cards, then discards three cards. If you cast this spell during your main phase, instead that player draws four cards, then discards two cards.",
      carefulCard
    );
    SpellAbility careful = carefulRoot.getSubAbility();
    boolean carefulExact = invoke("ForgeBridge$BridgeController", "isReviewedCarefulConsiderationDiscard", careful);
    careful.putParam("Defined", "You");
    boolean carefulMutated = invoke("ForgeBridge$BridgeController", "isReviewedCarefulConsiderationDiscard", careful);

    System.out.println("search=" + searchNormal + ",suspended=" + searchSuspended + ",mutated=" + searchMutated);
    System.out.println("careful=" + carefulExact + ",mutated=" + carefulMutated);
    System.out.flush();
    System.exit(0);
  }
}
`,
      );
      const output = execFileSync(
        'java',
        ['-cp', `${compiled.classDirectory}${delimiter}${install.jar}`, source],
        { cwd: install.home, encoding: 'utf8', timeout: 120_000 },
      );
      expect(
        output
          .trim()
          .split('\n')
          .filter((line) => /^(search|careful)=/u.test(line)),
      ).toEqual(['search=true,suspended=true,mutated=false', 'careful=true,mutated=false']);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
