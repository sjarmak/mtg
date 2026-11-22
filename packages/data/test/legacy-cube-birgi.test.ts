import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedBirgiRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  'Name:Birgi, God of Storytelling',
  'ManaCost:2 R',
  'Types:Legendary Creature God',
  'PT:3/3',
  "T:Mode$ SpellCast | ValidCard$ Card | ValidActivatingPlayer$ You | Execute$ TrigMana | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end.",
  'SVar:TrigMana:DB$ Mana | Produced$ R | PersistentMana$ True',
  'S:Mode$ Activations | ValidCard$ Creature.YouCtrl | ValidSA$ Activated.Boast | ValidPlayer$ You | MinLimit$ 2 | PlayerTurn$ You | Description$ Creatures you control can boast twice during each of your turns rather than once.',
  'AlternateMode:Modal',
  "Oracle:Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end.\\nCreatures you control can boast twice during each of your turns rather than once.",
  '',
  'ALTERNATE',
  '',
  'Name:Harnfel, Horn of Bounty',
  'ManaCost:4 R',
  'Types:Legendary Artifact',
  'A:AB$ Dig | Cost$ Discard<1/Card> | Defined$ You | DigNum$ 2 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | SubAbility$ DBEffect | StackDescription$ SpellDescription | SpellDescription$ Exile the top two cards of your library. You may play those cards this turn.',
  'SVar:DBEffect:DB$ Effect | StaticAbilities$ StaticMayPlay | RememberObjects$ Remembered | ForgetOnMoved$ Exile | SubAbility$ DBCleanup',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'SVar:StaticMayPlay:Mode$ Continuous | Affected$ Card.IsRemembered | AffectedZone$ Exile | MayPlay$ True | Description$ You may play those cards this turn.',
  'Oracle:Discard a card: Exile the top two cards of your library. You may play those cards this turn.',
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedBirgiRefusals(Buffer.from(lines.join('\n')), syntax);

describe('Legacy Cube reviewed Birgi and Harnfel boundary', () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    [
      'front identity',
      EXACT.map((line) => line.replace('Name:Birgi, God of Storytelling', 'Name:Near Birgi')),
    ],
    ['front trigger', EXACT.map((line) => line.replace('Produced$ R', 'Produced$ R R'))],
    ['alternate mode', EXACT.map((line) => line.replace('AlternateMode:Modal', 'AlternateMode:DoubleFaced'))],
    ['alternate divider', EXACT.filter((line) => line !== 'ALTERNATE')],
    ['back identity', EXACT.map((line) => line.replace('Name:Harnfel, Horn of Bounty', 'Name:Near Harnfel'))],
    ['discard count', EXACT.map((line) => line.replace('Discard<1/Card>', 'Discard<2/Card>'))],
    ['discard type', EXACT.map((line) => line.replace('Discard<1/Card>', 'Discard<1/Creature>'))],
    ['dig amount', EXACT.map((line) => line.replace('DigNum$ 2', 'DigNum$ 3'))],
    ['destination', EXACT.map((line) => line.replace('DestinationZone$ Exile', 'DestinationZone$ Hand'))],
    ['remembering', EXACT.map((line) => line.replace('RememberChanged$ True', 'RememberChanged$ False'))],
    [
      'effect objects',
      EXACT.map((line) => line.replace('RememberObjects$ Remembered', 'RememberObjects$ Source')),
    ],
    ['forget zone', EXACT.map((line) => line.replace('ForgetOnMoved$ Exile', 'ForgetOnMoved$ Hand'))],
    ['cleanup', EXACT.map((line) => line.replace('ClearRemembered$ True', 'ClearRemembered$ False'))],
    ['play scope', EXACT.map((line) => line.replace('Affected$ Card.IsRemembered', 'Affected$ Card'))],
    ['play zone', EXACT.map((line) => line.replace('AffectedZone$ Exile', 'AffectedZone$ Graveyard'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Birgi and Harnfel composition');
  });
});
