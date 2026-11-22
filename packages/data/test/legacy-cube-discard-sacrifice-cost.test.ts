import { describe, expect, it } from 'vitest';
import {
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeDiscardOrSourceSacrificeCostRefusals,
  loadLegacyCubeSyntaxReview,
} from '../src/legacy-cube/decision-ledger.js';

const script = (...lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(['Name:Payment Test', 'ManaCost:1', ...lines].join('\n'));

const fiendArtisan = [
  'Name:Fiend Artisan',
  'ManaCost:BG BG',
  'Types:Creature Nightmare',
  'PT:1/1',
  'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ Y | AddToughness$ Y | Description$ CARDNAME gets +1/+1 for each creature card in your graveyard.',
  'A:AB$ ChangeZone | Cost$ X BG T Sac<1/Creature.Other/another creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | ChangeNum$ 1 | SorcerySpeed$ True | StackDescription$ SpellDescription | SpellDescription$ Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
  'SVar:Y:Count$ValidGraveyard Creature.YouOwn',
  'SVar:X:Count$xPaid',
  'SVar:NonCombatPriority:1',
  'DeckHints:Ability$Graveyard',
  'Oracle:Fiend Artisan gets +1/+1 for each creature card in your graveyard.\\n{X}{B/G}, {T}, Sacrifice another creature: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
] satisfies readonly string[];

const exactScript = (lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(`${lines.join('\n')}\n`);

const targetedSourceSacrificeScripts = [
  [
    'Name:Thrashing Brontodon',
    'ManaCost:1 G G',
    'Types:Creature Dinosaur',
    'PT:3/4',
    'A:AB$ Destroy | Cost$ 1 Sac<1/CARDNAME> | ValidTgts$ Artifact,Enchantment | TgtPrompt$ Select target artifact or enchantment | AILogic$ AtEOTIfNotAttacking | SpellDescription$ Destroy target artifact or enchantment.',
    'Oracle:{1}, Sacrifice Thrashing Brontodon: Destroy target artifact or enchantment.',
  ],
  [
    'Name:Field of Ruin',
    'ManaCost:no cost',
    'Types:Land',
    'A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add {C}.',
    'A:AB$ Destroy | Cost$ 2 T Sac<1/CARDNAME> | ValidTgts$ Land.nonBasic+OppCtrl | TgtPrompt$ Select target nonbasic land an opponent controls. | SubAbility$ DBSearch | AILogic$ GhostQuarter | SpellDescription$ Destroy target nonbasic land an opponent controls. Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.',
    'SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | DefinedPlayer$ Player | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | StackDescription$ Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles their library.',
    'AI:RemoveDeck:Random',
    'Oracle:{T}: Add {C}.\\n{2}, {T}, Sacrifice Field of Ruin: Destroy target nonbasic land an opponent controls. Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.',
  ],
  [
    'Name:Wasteland',
    'ManaCost:no cost',
    'Types:Land',
    'A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add {C}.',
    'A:AB$ Destroy | ValidTgts$ Land.nonBasic | TgtPrompt$ Select target nonbasic land. | Cost$ T Sac<1/CARDNAME> | SpellDescription$ Destroy target nonbasic land.',
    'Oracle:{T}: Add {C}.\\n{T}, Sacrifice Wasteland: Destroy target nonbasic land.',
  ],
] satisfies readonly (readonly string[])[];

const faunaShaman = [
  'Name:Fauna Shaman',
  'ManaCost:1 G',
  'Types:Creature Elf Shaman',
  'PT:2/2',
  'A:AB$ ChangeZone | Cost$ G T Discard<1/Creature> | Origin$ Library | Destination$ Hand | ChangeType$ Creature | ChangeNum$ 1 | AILogic$ SurvivalOfTheFittest | SpellDescription$ Search your library for a Creature card and put it into your hand. Then shuffle.',
  'SVar:AIPreference:DiscardCost$Special:SurvivalOfTheFittest',
  'Oracle:{G}, {T}, Discard a creature card: Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
] satisfies readonly string[];

const chosenCreatureSacrificeScripts = [
  [
    'Name:Magus of the Order',
    'ManaCost:2 G G',
    'Types:Creature Human Wizard',
    'PT:3/3',
    'A:AB$ ChangeZone | Cost$ G T Sac<1/CARDNAME> Sac<1/Creature.Green+Other/another green creature> | CostDesc$ {G}, {T}, Sacrifice CARDNAME and another green creature: | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.Green | ChangeNum$ 1 | StackDescription$ {p:You} searches their library for a green creature card, puts it onto the battlefield, then shuffles their library. | SpellDescription$ Search your library for a green creature card, put it onto the battlefield, then shuffle.',
    'SVar:AIPreference:SacCost$Creature.Green',
    'DeckHas:Ability$Sacrifice',
    'DeckNeeds:Type$Creature',
    'Oracle:{G}, {T}, Sacrifice Magus of the Order and another green creature: Search your library for a green creature card, put it onto the battlefield, then shuffle.',
  ],
  [
    'Name:Natural Order',
    'ManaCost:2 G G',
    'Types:Sorcery',
    'A:SP$ ChangeZone | Cost$ 2 G G Sac<1/Creature.Green/green creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.Green | ChangeNum$ 1 | AILogic$ SacAndUpgrade+SacWorst | AISearchGoal$ Creature.Green | SpellDescription$ Search your library for a green creature card, put it onto the battlefield, then shuffle.',
    '# AI Preference is needed to make the AI consider the ability. Further constraints are defined by AILogic SacAndUpgrade.',
    'SVar:AIPreference:SacCost$Creature.Green',
    'Oracle:As an additional cost to cast this spell, sacrifice a green creature.\\nSearch your library for a green creature card, put it onto the battlefield, then shuffle.',
  ],
  [
    'Name:Falkenrath Aristocrat',
    'ManaCost:2 B R',
    'Types:Creature Vampire Noble',
    'PT:4/1',
    'K:Flying',
    'K:Haste',
    'A:AB$ Pump | Cost$ Sac<1/Creature> | Defined$ Self | KW$ Indestructible | AILogic$ AristocratCounters.Human | SubAbility$ DBPutCounter | SpellDescription$ CARDNAME gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on CARDNAME.',
    'SVar:DBPutCounter:DB$ PutCounter | ConditionCheckSVar$ X | CounterNum$ 1 | CounterType$ P1P1',
    'SVar:AIPreference:SacCost$Creature.Human+token,Creature.Human,Creature.Other+token,Creature.Other',
    'SVar:X:Sacrificed$Valid Human',
    'Oracle:Flying, haste\\nSacrifice a creature: Falkenrath Aristocrat gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on Falkenrath Aristocrat.',
  ],
] satisfies readonly (readonly string[])[];

describe('discard and fixed-source-sacrifice cost payments', () => {
  it.each(['Discard<1/Card>', 'Discard<0/Hand>'])(
    'requires the reviewed discard permission for %s',
    (cost) => {
      const bytes = script(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`);
      expect(legacyCubeChosenCostPaymentRefusals(bytes)).not.toEqual([]);
      expect(legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedDiscardCostParts: true })).toEqual([]);
    },
  );

  it.each([
    'Discard<2/Card>',
    'Discard<X/Card>',
    'Discard<1/Creature>',
    'Discard<1/Random>',
    'Discard<1/Card+WithDifferentNames>',
    'Sac<1/Creature.Other/another creature>',
  ])('keeps the neighboring payment shape refused: %s', (cost) => {
    expect(
      legacyCubeChosenCostPaymentRefusals(script(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`), {
        allowReviewedDiscardCostParts: true,
      }),
    ).not.toEqual([]);
  });

  it('parses a descriptive cost type containing spaces as one cost part', () => {
    expect(
      legacyCubeChosenCostPaymentRefusals(
        script('A:AB$ Draw | Cost$ X B G T Sac<1/Creature.Other/another creature> | NumCards$ 1'),
      ),
    ).toEqual(['chosen cost payment Sac<1/Creature.Other/another creature>']);
  });

  it('requires a separate permission for the exact other-creature sacrifice cost part', () => {
    const bytes = script('A:AB$ Draw | Cost$ X B G T Sac<1/Creature.Other/another creature> | NumCards$ 1');
    expect(legacyCubeChosenCostPaymentRefusals(bytes)).not.toEqual([]);
    expect(
      legacyCubeChosenCostPaymentRefusals(bytes, {
        allowReviewedDiscardCostParts: true,
      }),
    ).not.toEqual([]);
    expect(
      legacyCubeChosenCostPaymentRefusals(bytes, {
        allowReviewedOtherCreatureSacrificeCostPart: true,
      }),
    ).toEqual([]);
  });

  it.each([
    'Sac<1/Creature.Other/another creature>',
    'Return<1/Rogue.unblocked+attacking+YouCtrl/unblocked attacking Rogue you control>',
  ])('admits only the exact reviewed trigger-target cost part: %s', (cost) => {
    const bytes = script(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`);
    expect(legacyCubeChosenCostPaymentRefusals(bytes)).not.toEqual([]);
    expect(
      legacyCubeChosenCostPaymentRefusals(bytes, {
        allowReviewedTriggerTargetCostParts: true,
      }),
    ).toEqual([]);
    expect(
      legacyCubeChosenCostPaymentRefusals(
        script(`A:AB$ Draw | Cost$ ${cost.replace('<1/', '<2/')} | NumCards$ 1`),
        { allowReviewedTriggerTargetCostParts: true },
      ),
    ).not.toEqual([]);
  });

  it.each(['Discard<1/Card>', 'Discard<0/Hand>', 'Sac<1/CARDNAME>'])(
    'admits only a complete reviewed top-level shape containing %s',
    (cost) => {
      const bytes = script(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`);
      expect(legacyCubeDiscardOrSourceSacrificeCostRefusals(bytes, loadLegacyCubeSyntaxReview())).toEqual([]);
    },
  );

  it.each([
    ['missing payment', 'A:AB$ Draw | Cost$ 1 | NumCards$ 1'],
    ['unreviewed discard count', 'A:AB$ Draw | Cost$ Discard<2/Card> | NumCards$ 1'],
    ['chosen sacrifice', 'A:AB$ Draw | Cost$ Sac<1/Creature.Other/another creature> | NumCards$ 1'],
    ['generated object', 'A:AB$ Token | Cost$ Sac<1/CARDNAME> | TokenScript$ c_a_treasure_sac'],
  ])('refuses %s', (_label, line) => {
    expect(
      legacyCubeDiscardOrSourceSacrificeCostRefusals(script(line), loadLegacyCubeSyntaxReview()),
    ).not.toEqual([]);
  });

  it("admits only Fiend Artisan's complete reviewed chosen-sacrifice script", () => {
    expect(
      legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(fiendArtisan), loadLegacyCubeSyntaxReview()),
    ).toEqual([]);

    const hostile = [
      fiendArtisan.with(0, 'Name:Fiend Impostor'),
      fiendArtisan.with(5, fiendArtisan[5]!.replace('Sac<1/', 'Sac<2/')),
      fiendArtisan.with(5, fiendArtisan[5]!.replace('Creature.Other', 'Creature')),
      fiendArtisan.with(5, fiendArtisan[5]!.replace('another creature', 'a creature')),
      fiendArtisan.with(5, fiendArtisan[5]!.replace('ChangeNum$ 1', 'ChangeNum$ 2')),
      fiendArtisan.with(5, fiendArtisan[5]!.replace('SorcerySpeed$ True', 'SorcerySpeed$ False')),
      fiendArtisan.toSpliced(4, 1),
      [...fiendArtisan, 'K:Trample'],
    ];
    for (const lines of hostile) {
      expect(
        legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(lines), loadLegacyCubeSyntaxReview()),
      ).not.toEqual([]);
    }
  });

  it.each(targetedSourceSacrificeScripts.map((lines) => ({ lines, name: lines[0] })))(
    'admits the exact reviewed targeted source-sacrifice composition for $name',
    ({ lines }) => {
      expect(
        legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(lines), loadLegacyCubeSyntaxReview()),
      ).toEqual([]);

      const ability = lines.findIndex((line) => line.includes('ValidTgts$'));
      expect(ability).toBeGreaterThan(-1);
      for (const hostile of [
        lines.with(0, `${lines[0]} Impostor`),
        lines.with(ability, lines[ability]!.replace('Sac<1/CARDNAME>', 'Sac<1/Creature>')),
        lines.with(ability, `${lines[ability]} | TargetMax$ 2`),
        [...lines, 'DeckHints:Ability$Graveyard'],
      ]) {
        expect(
          legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(hostile), loadLegacyCubeSyntaxReview()),
        ).not.toEqual([]);
      }
    },
  );

  it('admits only Fauna Shaman as the exact creature-discard composition', () => {
    expect(
      legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(faunaShaman), loadLegacyCubeSyntaxReview()),
    ).toEqual([]);

    for (const hostile of [
      faunaShaman.with(0, 'Name:Fauna Impostor'),
      faunaShaman.with(4, faunaShaman[4]!.replace('Discard<1/Creature>', 'Discard<1/Card>')),
      faunaShaman.with(4, faunaShaman[4]!.replace('ChangeType$ Creature', 'ChangeType$ Card')),
      faunaShaman.with(4, faunaShaman[4]!.replace('ChangeNum$ 1', 'ChangeNum$ 2')),
      faunaShaman.toSpliced(5, 1),
      [...faunaShaman, 'DeckHints:Ability$Graveyard'],
    ]) {
      expect(
        legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(hostile), loadLegacyCubeSyntaxReview()),
      ).not.toEqual([]);
    }
  });

  it.each(chosenCreatureSacrificeScripts.map((lines) => ({ lines, name: lines[0] })))(
    'admits the exact reviewed chosen-creature-sacrifice composition for $name',
    ({ lines }) => {
      expect(
        legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(lines), loadLegacyCubeSyntaxReview()),
      ).toEqual([]);

      const ability = lines.findIndex((line) => line.startsWith('A:'));
      expect(ability).toBeGreaterThan(-1);
      for (const hostile of [
        lines.with(0, `${lines[0]} Impostor`),
        lines.with(ability, lines[ability]!.replace('Sac<1/', 'Sac<2/')),
        lines.with(ability, `${lines[ability]} | TargetMax$ 2`),
        lines.toSpliced(ability, 1),
        [...lines, 'DeckHints:Ability$Graveyard'],
      ]) {
        expect(
          legacyCubeDiscardOrSourceSacrificeCostRefusals(exactScript(hostile), loadLegacyCubeSyntaxReview()),
        ).not.toEqual([]);
      }
    },
  );
});
