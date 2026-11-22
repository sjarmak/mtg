/** Installed Forge parity for RTR Tablet of the Guilds. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const TABLET = parseCard({
  kind: 'artifact',
  id: 'rtr-235-tablet-of-the-guilds-forge',
  name: 'Tablet of the Guilds',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 235 },
  manaCost: { generic: 2 },
  colors: [],
  entryReplacement: { kind: 'chooseTwoColors' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      spellSharesChosenColors: true,
      printedSourceReference: 'thisArtifact',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringSpellChosenColorCount' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

describe('Tablet of the Guilds Forge export', () => {
  it('emits the installed two-color choice and chosen-color cast count', () => {
    const script = mustTranspile(TABLET);
    expect(script).toContain('K:ETBReplacement:Other:ChooseColors');
    expect(script).toContain(
      'SVar:ChooseColors:DB$ ChooseColor | Defined$ You | TwoColors$ True | AILogic$ MostProminentDualInComputerDeck | SpellDescription$ As CARDNAME enters, choose two colors.',
    );
    expect(script).toContain(
      "T:Mode$ SpellCast | ValidCard$ Card.AnyChosenColor | ValidActivatingPlayer$ You | Execute$ Trig1Effect1 | TriggerDescription$ Whenever you cast a spell, if it's at least one of the chosen colors, you gain 1 life for each of the chosen colors it is.",
    );
    expect(script).toContain('SVar:Trig1Effect1:DB$ GainLife | LifeAmount$ X');
    expect(script).toContain('SVar:X:Count$HasNumChosenColors.TriggeredCard');
  });
});
