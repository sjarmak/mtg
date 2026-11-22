/** Hermetic bounds for a set-independent variable graveyard-exile cost. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';
import { forgePolicyView } from '../src/observed/policy-observation';
import { strongestForgeObservedPolicy } from '../src/observed/policy';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts zero through the available-card bound and rejects unavailable payments',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'VariableGraveyardExileProbe.java');
      writeFileSync(
        source,
        `
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.cost.CostExile;
import forge.game.cost.CostPart;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.List;

public class VariableGraveyardExileProbe {
  private static SpellAbility ability(String amount) {
    String definition = "SP$ DealDamage | Cost$ 1 R ExileFromGrave<" + amount
        + "/Card> | ValidTgts$ Creature | NumDmg$ X";
    CardRules rules = CardRules.fromScript(List.of(
      "Name:Bounded Grave Flame",
      "ManaCost:1 R",
      "Types:Instant",
      "A:" + definition,
      "SVar:X:Count$xPaid",
      "Oracle:As an additional cost, exile X cards from your graveyard."
    ));
    Card card = CardFactory.getCard(new PaperCard(rules, "TST", CardRarity.Common), null, null);
    card.setSVar("X", "Count$xPaid");
    return AbilityFactory.getAbility(definition, card);
  }

  private static CostExile exile(SpellAbility ability) {
    for (CostPart part : ability.getPayCosts().getCostParts()) {
      if (part instanceof CostExile exile) return exile;
    }
    throw new IllegalStateException("fixture did not produce CostExile");
  }

  private static int resolve(CostExile exile, SpellAbility ability, int available) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeController").getDeclaredMethod(
      "reviewedGraveyardExileAmount", CostExile.class, SpellAbility.class, int.class
    );
    method.setAccessible(true);
    return (int) method.invoke(null, exile, ability, available);
  }

  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");
    SpellAbility variable = ability("X");
    CostExile variableExile = exile(variable);
    System.out.println("unannounced=" + resolve(variableExile, variable, 3));
    variable.setXManaCostPaid(0);
    System.out.println("zero=" + resolve(variableExile, variable, 0));
    variable.setXManaCostPaid(1);
    System.out.println("minimum=" + resolve(variableExile, variable, 3));
    variable.setXManaCostPaid(3);
    System.out.println("available=" + resolve(variableExile, variable, 3));
    variable.setXManaCostPaid(4);
    System.out.println("unavailable=" + resolve(variableExile, variable, 3));
    SpellAbility fixed = ability("2");
    System.out.println("fixed-overflow=" + resolve(exile(fixed), fixed, 1));
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
          .filter((line) => line.includes('=')),
      ).toEqual([
        'unannounced=-1',
        'zero=0',
        'minimum=1',
        'available=3',
        'unavailable=-1',
        'fixed-overflow=-1',
      ]);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);

forgeIt(
  'pays the available-card maximum through the strongest observed policy in a real match',
  async () => {
    const compiled = compileInstalledForgeBridge();
    if (compiled === null) throw new Error('Required installed Forge is absent');
    const delegate = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Harvest Pyre'],
            battlefield: ['Mountain', 'Mountain'],
            library: ['Mountain'],
            graveyard: ['Think Twice', 'Victim of Night', 'Darkthicket Wolf'],
          },
          {
            life: 20,
            hand: [],
            battlefield: ['Darkthicket Wolf'],
            library: ['Forest'],
            graveyard: [],
          },
        ],
      },
      {
        compiledBridgeClasses: compiled.classDirectory,
        diagnosticCardNames: [
          'Darkthicket Wolf',
          'Forest',
          'Harvest Pyre',
          'Mountain',
          'Think Twice',
          'Victim of Night',
        ],
      },
    );
    if (delegate === null) throw new Error('Required installed Forge is absent');
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'isd' },
      seats: [
        {
          name: 'Strongest observed pilot',
          controller: 'local',
          deck: { name: 'variable-cost-pilot', cards: [{ name: 'Mountain', count: 60 }] },
        },
        {
          name: 'Local witness',
          controller: 'local',
          deck: { name: 'variable-cost-witness', cards: [{ name: 'Forest', count: 60 }] },
        },
      ],
      seed: 'variable-graveyard-exile-strongest-v1',
      maximumTurns: 3,
    };
    let session;
    try {
      const opened = await delegate.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const recordedPolicyMoves: string[] = [];
      let cast = false;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        if (session.view.seats[1].graveyard.some((card) => card.name === 'Darkthicket Wolf')) break;
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Harvest Pyre decision');
        let move: string | undefined;
        if (decision.kind === 'priority' && decision.seat === 0 && !cast) {
          move = decision.options.find((option) => option.text.startsWith('Harvest Pyre:'))?.id;
          cast = move !== undefined;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Darkthicket Wolf')?.id;
        } else if (decision.kind === 'number' || decision.kind === 'cost-card-selection') {
          const choice = strongestForgeObservedPolicy.choose({
            seat: 0,
            view: forgePolicyView(session.view, 0),
            decision,
            play: session.play,
          });
          if (choice.status !== 'chosen') throw new Error(`Strongest policy rejected ${decision.kind}`);
          move = choice.move;
          recordedPolicyMoves.push(move);
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        }
        move ??= decision.options.find(
          (option) =>
            option.text === 'Pass priority' ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (move === undefined) throw new Error(`Unhandled Harvest Pyre decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(recordedPolicyMoves).toContain('number-3');
      expect(recordedPolicyMoves.filter((move) => move.startsWith('cost-card-selection-card-'))).toHaveLength(
        3,
      );
      expect(session.view.seats[0].exile).toHaveLength(3);
      expect(session.view.seats[1].battlefield).toEqual([]);
      expect(session.view.seats[1].graveyard.map((card) => card.name)).toEqual(['Darkthicket Wolf']);
    } finally {
      await session?.close();
      await delegate.shutdown?.();
      compiled.dispose();
    }
  },
  180_000,
);
