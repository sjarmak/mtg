import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const PHYLACTERY_LICH = parseCard({
  kind: 'creature',
  id: 'm11-phylactery-lich',
  name: 'Phylactery Lich',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 110 },
  manaCost: { B: 3 },
  colors: ['B'],
  subtypes: ['Zombie'],
  power: 5,
  toughness: 5,
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: {
    kind: 'putCounterOnControlledPermanent',
    permanentType: 'artifact',
    counter: 'phylactery',
    count: 1,
  },
  abilities: [
    {
      kind: 'stateTriggered',
      condition: { kind: 'controllerControlsNoPermanentWithCounter', counter: 'phylactery' },
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    },
  ],
});

describe('Phylactery Lich at the Forge parity boundary (mtg-nhyv.130)', () => {
  it('emits Forge current-script exact entry choice and state trigger', () => {
    const result = transpileCardScript(PHYLACTERY_LICH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        'K:ETBReplacement:Other:EntryCounterChoice',
        'SVar:EntryCounterChoice:DB$ ChooseCard | Choices$ Artifact.YouCtrl | Mandatory$ True | SubAbility$ EntryPutCounter | AILogic$ Phylactery | SpellDescription$ As CARDNAME enters, put a phylactery counter on an artifact you control.',
        'SVar:EntryPutCounter:DB$ PutCounter | CounterType$ PHYLACTERY | CounterNum$ 1 | Defined$ ChosenCard | SubAbility$ EntryCounterCleanup',
        'SVar:EntryCounterCleanup:DB$ Cleanup | ClearChosenCard$ True',
        'T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Permanent.counters_GE1_PHYLACTERY+YouCtrl | PresentCompare$ EQ0 | Execute$ Trig1Effect1 | TriggerDescription$ When you control no permanents with phylactery counters on them, sacrifice CARDNAME.',
        'SVar:Trig1Effect1:DB$ Sacrifice | SacValid$ Self',
      ]),
    );
  });
});
