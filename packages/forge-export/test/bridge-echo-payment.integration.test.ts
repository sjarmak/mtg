/** Compile the bridge and mutation-test the general Echo payment boundary. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts exact self-sacrifice Echo costs and rejects adjacent shapes',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'EchoPaymentProbe.java');
      writeFileSync(
        source,
        `
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.cost.Cost;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class EchoPaymentProbe {
  private static Card card(String name) {
    var rules = CardRules.fromScript(List.of(
      "Name:" + name,
      "ManaCost:2 B",
      "Types:Creature Human Mercenary"
    ));
    return CardFactory.getCard(new PaperCard(rules, "ULG", CardRarity.Uncommon), null, null);
  }

  private static AbilitySub echo(String name, String amount) {
    return new AbilitySub(
      ApiType.Sacrifice,
      card(name),
      null,
      new LinkedHashMap<>(Map.of("DB", "Sacrifice", "SacValid", "Self", "Echo", amount))
    );
  }

  private static boolean accepts(Cost cost, SpellAbility ability) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeSession").getDeclaredMethod(
      "isReviewedEchoSelfSacrificePayment",
      Cost.class,
      SpellAbility.class
    );
    method.setAccessible(true);
    return (boolean) method.invoke(null, cost, ability);
  }

  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");

    AbilitySub bone = echo("Bone Shredder", "2 B");
    AbilitySub hermit = echo("Deranged Hermit", "3 G G");
    boolean boneExact = accepts(new Cost("2 B", true), bone);
    boolean hermitExact = accepts(new Cost("3 G G", true), hermit);
    boolean wrongAmount = accepts(new Cost("2 B", true), echo("Other Echo", "3 B"));
    boolean zero = accepts(new Cost("0", true), echo("Zero Echo", "0"));
    boolean variable = accepts(new Cost("X B", true), echo("Variable Echo", "X B"));

    AbilitySub extra = echo("Extra", "2 B");
    extra.putParam("AILogic", "Sacrifice");
    boolean extraParam = accepts(new Cost("2 B", true), extra);

    AbilitySub foreign = echo("Foreign", "2 B");
    foreign.setParent(echo("Parent", "2 B"));
    boolean foreignParent = accepts(new Cost("2 B", true), foreign);

    AbilitySub wrongSubject = echo("Wrong subject", "2 B");
    wrongSubject.putParam("SacValid", "Creature.YouCtrl");
    boolean wrongSacrifice = accepts(new Cost("2 B", true), wrongSubject);

    System.out.println(
      "bone=" + boneExact
        + ",hermit=" + hermitExact
        + ",wrongAmount=" + wrongAmount
        + ",zero=" + zero
        + ",variable=" + variable
        + ",extraParam=" + extraParam
        + ",foreignParent=" + foreignParent
        + ",wrongSacrifice=" + wrongSacrifice
    );
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
          .find((line) => line.startsWith('bone=')),
      ).toBe(
        'bone=true,hermit=true,wrongAmount=false,zero=false,variable=false,extraParam=false,foreignParent=false,wrongSacrifice=false',
      );
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
