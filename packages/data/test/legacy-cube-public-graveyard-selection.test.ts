import { describe, expect, it } from 'vitest';
import {
  legacyCubePublicGraveyardSelectionRefusals,
  type LegacyCubePublicGraveyardSelectionShape,
} from '../src/legacy-cube/public-graveyard-selection.js';

const fixtures = {
  'targeted-own-exile':
    'A:AB$ ChangeZone | Cost$ T | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Player | DefinedPlayer$ Targeted | Mandatory$ True | ChangeType$ Card | ChangeNum$ 1 | Hidden$ True | IsCurse$ True | Chooser$ Targeted',
  'replacement-pooled-imprint':
    'K:ETBReplacement:Other:EntrySelection\nSVar:EntrySelection:DB$ ChangeZone | Imprint$ True | ChangeType$ Creature.NotDefinedReplacedSimultaneousETB | ChangeNum$ 1 | Origin$ Graveyard | Destination$ Exile | Mandatory$ True | Hidden$ True | Chooser$ You',
  'each-player-return':
    'A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ChangeType$ Creature | DefinedPlayer$ Player | ChangeNum$ 1 | Hidden$ True | Mandatory$ True',
} satisfies Record<LegacyCubePublicGraveyardSelectionShape, string>;

function refusals(script: string, shape: LegacyCubePublicGraveyardSelectionShape) {
  return legacyCubePublicGraveyardSelectionRefusals(
    new TextEncoder().encode(`Name:Authored selection specimen\n${script}\n`),
    shape,
  );
}

describe('closed public graveyard callback shapes', () => {
  for (const [shape, script] of Object.entries(fixtures) as [
    LegacyCubePublicGraveyardSelectionShape,
    string,
  ][]) {
    it(`accepts the authored ${shape} shape`, () => {
      expect(refusals(script, shape)).toEqual([]);
    });

    for (const [field, value] of [
      ['Origin', 'Library'],
      ['Destination', 'Hand'],
      ['Hidden', 'False'],
      ['Mandatory', 'False'],
      ['ChangeNum', '2'],
      ['ChangeType', 'Card.YouOwn'],
    ]) {
      it(`refuses ${shape} with changed ${field}`, () => {
        const mutated = script.replace(new RegExp(`${field}\\$ [^|\\n]+`), `${field}$ ${value} `);
        expect(mutated).not.toBe(script);
        expect(refusals(mutated, shape)).not.toEqual([]);
      });
    }

    for (const extra of [
      'Defined$ You',
      'Chooser$ Opponent',
      'SubAbility$ Followup',
      'OriginAlternative$ Hand',
      'ChooseFromDefined$ Remembered',
      'ChangeNum$ 1',
    ]) {
      it(`refuses ${shape} with extra ${extra}`, () => {
        expect(refusals(`${script} | ${extra}`, shape)).not.toEqual([]);
      });
    }

    it(`refuses ${shape} with no callback or another callback`, () => {
      expect(refusals(script.replace('ChangeZone', 'Draw'), shape)).not.toEqual([]);
      expect(refusals(`${script}\nA:SP$ ChangeZone | Origin$ Graveyard`, shape)).not.toEqual([]);
    });

    it(`refuses ${shape} when moved under an unreviewed parent`, () => {
      const moved = script.replace(/(?:A:|SVar:EntrySelection:)(?:AB|SP|DB)\$/, 'SVar:Nested:DB$');
      expect(refusals(`${moved}\nA:SP$ Draw | SubAbility$ Nested`, shape)).not.toEqual([]);
    });
  }

  it('keeps replacement links unique and requires the exact entry replacement', () => {
    const script = fixtures['replacement-pooled-imprint'];
    for (const mutated of [
      script.replace('ETBReplacement', 'OtherReplacement'),
      script.replace('Other:EntrySelection', 'Other:Missing'),
      `${script}\nA:AB$ Draw | SubAbility$ EntrySelection`,
      `${script}\nT:Mode$ Phase | Execute$ EntrySelection`,
      `${script}\nA:SP$ Charm | Choices$ Other,EntrySelection`,
      `${script}\nK:ETBReplacement:Other:EntrySelection`,
      `${script}\nSVar:EntrySelection:DB$ Draw`,
    ])
      expect(refusals(mutated, 'replacement-pooled-imprint')).not.toEqual([]);
  });

  it('allows a renamed replacement link and unrelated nonselection effects', () => {
    const script = fixtures['replacement-pooled-imprint'].replaceAll('EntrySelection', 'EnterChoice');
    expect(refusals(`${script}\nA:AB$ Clone | Defined$ Imprinted`, 'replacement-pooled-imprint')).toEqual([]);
    expect(
      refusals(
        `${fixtures['targeted-own-exile']}\nA:AB$ ChangeZoneAll | SubAbility$ Tail\nSVar:Tail:DB$ Draw`,
        'targeted-own-exile',
      ),
    ).toEqual([]);
  });

  it('refuses malformed fields and cross-shape authority', () => {
    expect(refusals(`${fixtures['each-player-return']} | Hidden True`, 'each-player-return')).not.toEqual([]);
    expect(refusals(fixtures['targeted-own-exile'], 'each-player-return')).not.toEqual([]);
    expect(refusals(fixtures['each-player-return'], 'targeted-own-exile')).not.toEqual([]);
    expect(
      legacyCubePublicGraveyardSelectionRefusals(new Uint8Array([255]), 'each-player-return'),
    ).not.toEqual([]);
    expect(
      refusals(`${fixtures['each-player-return']}\nSVar:MissingDelimiter`, 'each-player-return'),
    ).not.toEqual([]);
  });
});
