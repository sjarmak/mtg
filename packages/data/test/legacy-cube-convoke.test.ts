import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyLegacyCubeForgeScript,
  legacyCubeReviewedConvokeRefusals,
  loadLegacyCubeDecisionLedger,
  loadLegacyCubeSyntaxReview,
  verifyLegacyCubeDecisionScript,
} from '@mtg/data';

const VENERATED_LOXODON = [
  'Name:Venerated Loxodon',
  'ManaCost:4 W',
  'Types:Creature Elephant Cleric',
  'PT:4/4',
  'K:Convoke',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigPutCounterAll | TriggerDescription$ When CARDNAME enters, put a +1/+1 counter on each creature that convoked it.',
  'SVar:TrigPutCounterAll:DB$ PutCounter | Defined$ Convoked | CounterType$ P1P1 | CounterNum$ 1',
  'DeckHas:Ability$Counters',
  "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nWhen Venerated Loxodon enters, put a +1/+1 counter on each creature that convoked it.",
] as const;

const CONCLAVE_TRIBUNAL = [
  'Name:Conclave Tribunal',
  'ManaCost:3 W',
  'Types:Enchantment',
  'K:Convoke',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile target nonland permanent an opponent controls until CARDNAME leaves the battlefield.',
  'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.nonLand+OppCtrl | TgtPrompt$ Select target nonland permanent an opponent controls | Duration$ UntilHostLeavesPlay',
  'SVar:OblivionRing:TRUE',
  "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nWhen Conclave Tribunal enters, exile target nonland permanent an opponent controls until Conclave Tribunal leaves the battlefield.",
] as const;

const STOKE_THE_FLAMES = [
  'Name:Stoke the Flames',
  'ManaCost:2 R R',
  'Types:Instant',
  'K:Convoke',
  'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 4 | SpellDescription$ CARDNAME deals 4 damage to any target.',
  "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nStoke the Flames deals 4 damage to any target.",
] as const;

const CHORD_OF_CALLING = [
  'Name:Chord of Calling',
  'ManaCost:X G G G',
  'Types:Instant',
  'K:Convoke',
  'A:SP$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | ChangeNum$ 1 | StackDescription$ SpellDescription | AIXMax$ Y | SpellDescription$ Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.',
  'SVar:X:Count$xPaid',
  'SVar:Y:Count$ValidLibrary Creature.YouOwn+cmcLEX$GreatestCardManaCost',
  "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const ledger = loadLegacyCubeDecisionLedger();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedConvokeRefusals(Buffer.from(lines.join('\n')), syntax);

function verifyPosition(position: number, lines: readonly string[]): void {
  const bytes = Buffer.from(lines.join('\n'));
  const entry = ledger.auditedCards.find((candidate) => candidate.position === position);
  if (entry === undefined) throw new Error(`Missing reviewed position ${position}`);
  const classified = classifyLegacyCubeForgeScript(bytes, syntax);
  verifyLegacyCubeDecisionScript(
    {
      ...entry,
      families: [...classified.families],
      evidenceMarkers: [...classified.evidenceMarkers],
      unknownDecisionSyntax: [...classified.unknownDecisionSyntax],
      forgeScriptSha256: createHash('sha256').update(bytes).digest('hex'),
    },
    bytes,
    syntax,
  );
}

describe('Legacy Cube reviewed Convoke cohort', () => {
  it.each([
    ['Venerated Loxodon', VENERATED_LOXODON],
    ['Conclave Tribunal', CONCLAVE_TRIBUNAL],
    ['Stoke the Flames', STOKE_THE_FLAMES],
    ['Chord of Calling', CHORD_OF_CALLING],
  ] as const)('admits only the exact complete installed %s script', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    [33, VENERATED_LOXODON],
    [58, CONCLAVE_TRIBUNAL],
    [310, STOKE_THE_FLAMES],
    [400, CHORD_OF_CALLING],
  ] as const)(
    'keeps position %i admitted when the complete ledger verifier reloads it',
    (position, lines) => {
      expect(() => verifyPosition(position, lines)).not.toThrow();
    },
  );

  it.each([
    ['identity', VENERATED_LOXODON.map((line) => line.replace('Name:Venerated Loxodon', 'Name:Other'))],
    ['mana cost', VENERATED_LOXODON.map((line) => line.replace('ManaCost:4 W', 'ManaCost:3 W'))],
    [
      'card type',
      VENERATED_LOXODON.map((line) => line.replace('Creature Elephant Cleric', 'Creature Elephant')),
    ],
    ['entry mode', VENERATED_LOXODON.map((line) => line.replace('Mode$ ChangesZone', 'Mode$ Phase'))],
    ['entry origin', VENERATED_LOXODON.map((line) => line.replace('Origin$ Any', 'Origin$ Stack'))],
    [
      'counter recipients',
      VENERATED_LOXODON.map((line) => line.replace('Defined$ Convoked', 'Defined$ YouCtrl')),
    ],
    ['counter type', VENERATED_LOXODON.map((line) => line.replace('CounterType$ P1P1', 'CounterType$ M1M1'))],
    [
      'Tribunal target',
      CONCLAVE_TRIBUNAL.map((line) => line.replace('Permanent.nonLand+OppCtrl', 'Permanent')),
    ],
    [
      'Tribunal duration',
      CONCLAVE_TRIBUNAL.map((line) => line.replace('Duration$ UntilHostLeavesPlay', 'Duration$ Permanent')),
    ],
    ['Stoke target', STOKE_THE_FLAMES.map((line) => line.replace('ValidTgts$ Any', 'ValidTgts$ Player'))],
    ['Stoke damage', STOKE_THE_FLAMES.map((line) => line.replace('NumDmg$ 4', 'NumDmg$ 3'))],
    ['Chord origin', CHORD_OF_CALLING.map((line) => line.replace('Origin$ Library', 'Origin$ Graveyard'))],
    [
      'Chord destination',
      CHORD_OF_CALLING.map((line) => line.replace('Destination$ Battlefield', 'Destination$ Hand')),
    ],
    ['Chord filter', CHORD_OF_CALLING.map((line) => line.replace('Creature.cmcLEX', 'Creature'))],
    ['Chord count', CHORD_OF_CALLING.map((line) => line.replace('ChangeNum$ 1', 'ChangeNum$ 2'))],
    ['Chord X binding', CHORD_OF_CALLING.map((line) => line.replace('Count$xPaid', 'Count$ChosenX'))],
    ['Oracle', STOKE_THE_FLAMES.map((line) => line.replace('deals 4 damage', 'deals 3 damage'))],
    ['ordering', [VENERATED_LOXODON[1]!, VENERATED_LOXODON[0]!, ...VENERATED_LOXODON.slice(2)]],
    ['missing line', CONCLAVE_TRIBUNAL.filter((line) => !line.startsWith('SVar:OblivionRing:'))],
    ['extra syntax', [...CHORD_OF_CALLING, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });

  it('refuses an unknown special-payment keyword at the syntax-inventory boundary', () => {
    expect(() => refusal(VENERATED_LOXODON.map((line) => line.replace('K:Convoke', 'K:Improvise')))).toThrow(
      'unknown Forge decision syntax keyword "Improvise"',
    );
  });
});
