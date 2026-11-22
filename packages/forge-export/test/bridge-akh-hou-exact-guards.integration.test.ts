/** Mutate installed Forge abilities to prove reviewed AKH/HOU guards fail closed. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'compiled AKH/HOU guards accept installed scripts and reject added semantics',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'AkhHouExactGuardProbe.java');
      writeFileSync(
        source,
        `
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.cost.Cost;
import forge.game.cost.CostPutCounter;
import forge.game.ability.AbilityFactory;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.List;
public class AkhHouExactGuardProbe {
  private static Card card(String... script) {
    var rules = CardRules.fromScript(List.of(script));
    return CardFactory.getCard(new PaperCard(rules, "AKH", CardRarity.Rare), null, null);
  }
  private static SpellAbility ability(Card card, String definition) {
    return AbilityFactory.getAbility(definition, card);
  }
  private static boolean invoke(String owner, String name, Class<?>[] types, Object... arguments) throws Exception {
    var method = Class.forName(owner).getDeclaredMethod(name, types);
    method.setAccessible(true);
    return (boolean) method.invoke(null, arguments);
  }
  private static boolean torment(SpellAbility ability) throws Exception {
    return invoke(
      "ForgeBridge$BridgeController",
      "isReviewedTormentAlternativePayment",
      new Class<?>[] { Cost.class, SpellAbility.class },
      new Cost(ability.getParam("UnlessCost"), true),
      ability
    );
  }
  private static void verdict(String label, boolean accepted, boolean mutated) {
    System.out.println(label + "=" + accepted + ",mutated=" + mutated);
  }
  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");
    Card hourCard = card(
      "Name:Hour of Eternity",
      "ManaCost:X X U U U",
      "Types:Sorcery",
      "A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Exile | TgtPrompt$ Choose X target creature cards from your graveyard | ValidTgts$ Creature.YouOwn | TargetMin$ X | TargetMax$ X | SubAbility$ DBClone | RememberChanged$ True | StackDescription$ {p:You} exiles {c:Targeted} from their graveyard. | SpellDescription$ Exile X target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.",
      "SVar:DBClone:DB$ CopyPermanent | Defined$ Remembered | SetPower$ 4 | SetToughness$ 4 | SetColor$ Black | SetCreatureTypes$ Zombie | SubAbility$ DBCleanup | StackDescription$ For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.",
      "SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True",
      "SVar:X:Count$xPaid",
      "Oracle:Exile X target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie."
    );
    hourCard.setSVar("DBClone", "DB$ CopyPermanent | Defined$ Remembered | SetPower$ 4 | SetToughness$ 4 | SetColor$ Black | SetCreatureTypes$ Zombie | SubAbility$ DBCleanup | StackDescription$ For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.");
    hourCard.setSVar("DBCleanup", "DB$ Cleanup | ClearRemembered$ True");
    hourCard.setSVar("X", "Count$xPaid");
    SpellAbility hour = ability(hourCard, "SP$ ChangeZone | Origin$ Graveyard | Destination$ Exile | TgtPrompt$ Choose X target creature cards from your graveyard | ValidTgts$ Creature.YouOwn | TargetMin$ X | TargetMax$ X | SubAbility$ DBClone | RememberChanged$ True | StackDescription$ {p:You} exiles {c:Targeted} from their graveyard. | SpellDescription$ Exile X target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.");
    hour.setXManaCostPaid(1);
    boolean hourAccepted = invoke("ForgeBridge$BridgeSession", "isReviewedHourOfEternityTarget", new Class<?>[] { SpellAbility.class }, hour);
    hour.putParam("NumCopies", "2");
    verdict("hour", hourAccepted, invoke("ForgeBridge$BridgeSession", "isReviewedHourOfEternityTarget", new Class<?>[] { SpellAbility.class }, hour));

    Card tragicCard = card(
      "Name:Tragic Lesson",
      "ManaCost:2 U",
      "Types:Instant",
      "A:SP$ Draw | NumCards$ 2 | SpellDescription$ Draw two cards. Then discard a card unless you return a land you control to its owner's hand. | SubAbility$ DBDiscard",
      "SVar:DBDiscard:DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose | UnlessCost$ Return<1/Land> | UnlessPayer$ You",
      "Oracle:Draw two cards. Then discard a card unless you return a land you control to its owner's hand."
    );
    tragicCard.setSVar("DBDiscard", "DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose | UnlessCost$ Return<1/Land> | UnlessPayer$ You");
    SpellAbility tragicRoot = ability(tragicCard, "SP$ Draw | NumCards$ 2 | SpellDescription$ Draw two cards. Then discard a card unless you return a land you control to its owner's hand. | SubAbility$ DBDiscard");
    SpellAbility tragic = tragicRoot.getSubAbility();
    boolean tragicAccepted = invoke("ForgeBridge$BridgeController", "isReviewedTragicLessonDiscard", new Class<?>[] { SpellAbility.class }, tragic);
    tragicRoot.putParam("Defined", "Opponent");
    verdict("tragic", tragicAccepted, invoke("ForgeBridge$BridgeController", "isReviewedTragicLessonDiscard", new Class<?>[] { SpellAbility.class }, tragic));

    Card lethalCard = card(
      "Name:Lethal Sting",
      "ManaCost:2 B",
      "Types:Sorcery",
      "A:SP$ Destroy | Cost$ 2 B AddCounter<1/M1M1/Creature.YouCtrl/a creature you control> | ValidTgts$ Creature | SpellDescription$ Destroy target creature.",
      "Oracle:As an additional cost to cast this spell, put a -1/-1 counter on a creature you control. Destroy target creature."
    );
    SpellAbility lethal = ability(lethalCard, "SP$ Destroy | Cost$ 2 B AddCounter<1/M1M1/Creature.YouCtrl/a creature you control> | ValidTgts$ Creature | SpellDescription$ Destroy target creature.");
    CostPutCounter lethalCounter = (CostPutCounter) lethal.getPayCosts().getCostParts().get(1);
    boolean lethalAccepted = invoke(
      "ForgeBridge$BridgeController",
      "isReviewedLethalStingPutCounterCost",
      new Class<?>[] { CostPutCounter.class, SpellAbility.class },
      lethalCounter,
      lethal
    );
    lethal.putParam("NoRegen", "True");
    verdict(
      "lethal",
      lethalAccepted,
      invoke(
        "ForgeBridge$BridgeController",
        "isReviewedLethalStingPutCounterCost",
        new Class<?>[] { CostPutCounter.class, SpellAbility.class },
        lethalCounter,
        lethal
      )
    );

    Card hailCard = card(
      "Name:Torment of Hailfire",
      "ManaCost:X B B",
      "Types:Sorcery",
      "A:SP$ Repeat | MaxRepeat$ X | RepeatSubAbility$ RepeatTorment | AILogic$ MaxX | StackDescription$ SpellDescription | SpellDescription$ Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent or discards a card.",
      "SVar:RepeatTorment:DB$ GenericChoice | Defined$ Opponent | TempRemember$ Chooser | Choices$ SacNonland,Discard | FallbackAbility$ LoseLifeFallback | AILogic$ PayUnlessCost",
      "SVar:Discard:DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3 | UnlessCost$ Discard<1/Card> | UnlessPayer$ Remembered | SpellDescription$ You lose 3 life unless you discard a card.",
      "SVar:SacNonland:DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3 | UnlessCost$ Sac<1/Permanent.nonLand/nonland permanent> | UnlessPayer$ Remembered | SpellDescription$ You lose 3 life unless you sacrifice a nonland permanent.",
      "SVar:LoseLifeFallback:DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3",
      "SVar:X:Count$xPaid"
    );
    hailCard.setSVar("RepeatTorment", "DB$ GenericChoice | Defined$ Opponent | TempRemember$ Chooser | Choices$ SacNonland,Discard | FallbackAbility$ LoseLifeFallback | AILogic$ PayUnlessCost");
    hailCard.setSVar("Discard", "DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3 | UnlessCost$ Discard<1/Card> | UnlessPayer$ Remembered | SpellDescription$ You lose 3 life unless you discard a card.");
    hailCard.setSVar("SacNonland", "DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3 | UnlessCost$ Sac<1/Permanent.nonLand/nonland permanent> | UnlessPayer$ Remembered | SpellDescription$ You lose 3 life unless you sacrifice a nonland permanent.");
    hailCard.setSVar("LoseLifeFallback", "DB$ LoseLife | Defined$ Remembered | LifeAmount$ 3");
    hailCard.setSVar("X", "Count$xPaid");
    SpellAbility hailRoot = ability(hailCard, "SP$ Repeat | MaxRepeat$ X | RepeatSubAbility$ RepeatTorment | AILogic$ MaxX | StackDescription$ SpellDescription | SpellDescription$ Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent or discards a card.");
    SpellAbility hailChoice = hailRoot.getAdditionalAbility("RepeatSubAbility");
    ((AbilitySub) hailChoice).setParent(hailRoot);
    SpellAbility hailSacrifice = hailChoice.getAdditionalAbilityList("Choices").get(0);
    ((AbilitySub) hailSacrifice).setParent(hailChoice);
    boolean hailAccepted = torment(hailSacrifice);
    hailCard.setSVar("X", "Number$2");
    verdict("hail", hailAccepted, torment(hailSacrifice));

    Card venomCard = card(
      "Name:Torment of Venom",
      "ManaCost:2 B B",
      "Types:Instant",
      "A:SP$ PutCounter | ValidTgts$ Creature | CounterType$ M1M1 | CounterNum$ 3 | IsCurse$ True | RememberTargets$ True | SubAbility$ DBGenericChoice | SpellDescription$ Put three -1/-1 counters on target creature. Its controller loses 3 life unless they sacrifice another nonland permanent or discards a card.",
      "SVar:DBGenericChoice:DB$ GenericChoice | Choices$ PaySac,PayDiscard | Defined$ TargetedController | FallbackAbility$ LoseLifeFallback | AILogic$ PayUnlessCost | SubAbility$ DBCleanup",
      "SVar:PaySac:DB$ LoseLife | LifeAmount$ 3 | Defined$ TargetedController | UnlessCost$ Sac<1/Permanent.!IsRemembered+nonLand/another nonland permanent> | UnlessPayer$ TargetedController | SpellDescription$ You lose 3 life unless you sacrifice another nonland permanent.",
      "SVar:PayDiscard:DB$ LoseLife | LifeAmount$ 3 | Defined$ TargetedController | UnlessCost$ Discard<1/Card> | UnlessPayer$ TargetedController | SpellDescription$ You lose 3 life unless you discard a card.",
      "SVar:LoseLifeFallback:DB$ LoseLife | Defined$ Player.IsRemembered | LifeAmount$ 3",
      "SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True"
    );
    venomCard.setSVar("DBGenericChoice", "DB$ GenericChoice | Choices$ PaySac,PayDiscard | Defined$ TargetedController | FallbackAbility$ LoseLifeFallback | AILogic$ PayUnlessCost | SubAbility$ DBCleanup");
    venomCard.setSVar("PaySac", "DB$ LoseLife | LifeAmount$ 3 | Defined$ TargetedController | UnlessCost$ Sac<1/Permanent.!IsRemembered+nonLand/another nonland permanent> | UnlessPayer$ TargetedController | SpellDescription$ You lose 3 life unless you sacrifice another nonland permanent.");
    venomCard.setSVar("PayDiscard", "DB$ LoseLife | LifeAmount$ 3 | Defined$ TargetedController | UnlessCost$ Discard<1/Card> | UnlessPayer$ TargetedController | SpellDescription$ You lose 3 life unless you discard a card.");
    venomCard.setSVar("LoseLifeFallback", "DB$ LoseLife | Defined$ Player.IsRemembered | LifeAmount$ 3");
    venomCard.setSVar("DBCleanup", "DB$ Cleanup | ClearRemembered$ True");
    SpellAbility venomRoot = ability(venomCard, "SP$ PutCounter | ValidTgts$ Creature | CounterType$ M1M1 | CounterNum$ 3 | IsCurse$ True | RememberTargets$ True | SubAbility$ DBGenericChoice | SpellDescription$ Put three -1/-1 counters on target creature. Its controller loses 3 life unless they sacrifice another nonland permanent or discards a card.");
    SpellAbility venomChoice = venomRoot.getSubAbility();
    SpellAbility venomSacrifice = venomChoice.getAdditionalAbilityList("Choices").get(0);
    ((AbilitySub) venomSacrifice).setParent(venomChoice);
    boolean venomAccepted = torment(venomSacrifice);
    venomChoice.setSubAbility((AbilitySub) ability(venomCard, "DB$ LoseLife | Defined$ Opponent | LifeAmount$ 1"));
    verdict("venom", venomAccepted, torment(venomSacrifice));
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
          .filter((line) => /^(hour|tragic|lethal|hail|venom)=/u.test(line)),
      ).toEqual([
        'hour=true,mutated=false',
        'tragic=true,mutated=false',
        'lethal=true,mutated=false',
        'hail=true,mutated=false',
        'venom=true,mutated=false',
      ]);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
