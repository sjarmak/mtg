/** Installed Forge 2.0.14 parity for RTR Guild Feud. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Guild Feud Forge export', () => {
  it('emits the installed two-pick remembered-fight chain exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'rtr-97-guild-feud-forge',
      name: 'Guild Feud',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 97 },
      manaCost: { generic: 5, R: 1 },
      colors: ['R'],
      subtypes: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [],
          guildFeudContest: true,
        },
      ],
    } satisfies CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Guild Feud',
        'ManaCost:5 R',
        'Types:Enchantment',
        'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ OppPick | TriggerDescription$ At the beginning of your upkeep, target opponent reveals the top three cards of their library, may put a creature card from among them onto the battlefield, then puts the rest into their graveyard. You do the same with the top three cards of your library. If two creatures are put onto the battlefield this way, those creatures fight each other.',
        'SVar:OppPick:DB$ Dig | ValidTgts$ Opponent | DigNum$ 3 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Creature | DestinationZone$ Battlefield | DestinationZone2$ Graveyard | Choser$ Targeted | Optional$ True | RememberChanged$ True | SubAbility$ YouPick',
        'SVar:YouPick:DB$ Dig | Defined$ You | DigNum$ 3 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Creature | DestinationZone$ Battlefield | DestinationZone2$ Graveyard | Optional$ True | RememberChanged$ True | SubAbility$ PicksFight',
        'SVar:PicksFight:DB$ Fight | Defined$ Remembered | SubAbility$ DBCleanup | ConditionCheckSVar$ NumFighters | ConditionSVarCompare$ EQ2 | StackDescription$ If two creatures are put onto the battlefield this way, those creatures fight each other.',
        'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
        'SVar:NumFighters:Remembered$Amount',
        'AI:RemoveDeck:Random',
        'Oracle:At the beginning of your upkeep, target opponent reveals the top three cards of their library, may put a creature card from among them onto the battlefield, then puts the rest into their graveyard. You do the same with the top three cards of your library. If two creatures are put onto the battlefield this way, those creatures fight each other.',
        '',
      ].join('\n'),
    );
  });
});
