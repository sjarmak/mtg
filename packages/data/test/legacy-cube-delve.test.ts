import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyLegacyCubeForgeScript,
  legacyCubeReviewedDelveRefusals,
  loadLegacyCubeDecisionLedger,
  loadLegacyCubeSyntaxReview,
  verifyLegacyCubeDecisionScript,
} from '@mtg/data';

const MURKTIDE_REGENT = [
  'Name:Murktide Regent',
  'ManaCost:5 U U',
  'Types:Creature Dragon',
  'PT:3/3',
  'K:Delve',
  'K:Flying',
  'K:etbCounter:P1P1:X:no Condition:CARDNAME enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.',
  'SVar:X:Count$ValidExile Instant.ExiledWithSource,Sorcery.ExiledWithSource',
  'T:Mode$ ChangesZone | ValidCard$ Instant.YouOwn,Sorcery.YouOwn | Origin$ Graveyard | Destination$ Any | TriggerZones$ Battlefield | Execute$ TrigPutCounter | TriggerDescription$ Whenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on CARDNAME.',
  'SVar:TrigPutCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1',
  'DeckHas:Ability$Counters',
  'DeckNeeds:Type$Instant|Sorcery',
  'Oracle:Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\\nFlying\\nMurktide Regent enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on Murktide Regent.',
] as const;

const TASIGUR = [
  'Name:Tasigur, the Golden Fang',
  'ManaCost:5 B',
  'Types:Legendary Creature Human Shaman',
  'PT:4/5',
  'K:Delve',
  "A:AB$ Mill | Cost$ 2 GU GU | Defined$ You | NumCards$ 2 | SubAbility$ DBReturn | SpellDescription$ Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.",
  'SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | DefinedPlayer$ You | Chooser$ Opponent | Hidden$ True | Mandatory$ True | ChangeType$ Card.nonLand+YouOwn | AILogic$ WorstCard',
  'DeckHints:Ability$Graveyard',
  "Oracle:Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\\n{2}{G/U}{G/U}: Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.",
] as const;

const HOGAAK = [
  'Name:Hogaak, Arisen Necropolis',
  'ManaCost:5 BG BG',
  'Types:Legendary Creature Avatar',
  'PT:8/8',
  'K:Convoke',
  'K:Delve',
  'K:Trample',
  "Text:You can't spend mana to cast this spell.",
  'A:SP$ PermanentCreature | Cost$ 5 BG BG | ManaRestriction$ None',
  'S:Mode$ Continuous | Affected$ Card.Self | MayPlay$ True | AffectedZone$ Graveyard | EffectZone$ Graveyard | Description$ You may cast CARDNAME from your graveyard.',
  "Oracle:You can't spend mana to cast this spell.\\nConvoke, delve (Each creature you tap while casting this spell pays for {1} or one mana of that creature's color. Each card you exile from your graveyard pays for {1}.)\\nYou may cast Hogaak, Arisen Necropolis from your graveyard.\\nTrample",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const ledger = loadLegacyCubeDecisionLedger();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedDelveRefusals(Buffer.from(lines.join('\n')), syntax);

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

describe('Legacy Cube reviewed Delve cohort', () => {
  it.each([
    ['Murktide Regent', MURKTIDE_REGENT],
    ['Tasigur, the Golden Fang', TASIGUR],
    ['Hogaak, Arisen Necropolis', HOGAAK],
  ] as const)('admits only the exact complete installed %s script', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    [111, MURKTIDE_REGENT],
    [195, TASIGUR],
    [462, HOGAAK],
  ] as const)(
    'keeps position %i admitted when the complete ledger verifier reloads it',
    (position, lines) => {
      expect(() => verifyPosition(position, lines)).not.toThrow();
    },
  );

  it.each([
    ['identity', MURKTIDE_REGENT.map((line) => line.replace('Name:Murktide Regent', 'Name:Other'))],
    ['mana cost', MURKTIDE_REGENT.map((line) => line.replace('ManaCost:5 U U', 'ManaCost:4 U U'))],
    ['card type', MURKTIDE_REGENT.map((line) => line.replace('Creature Dragon', 'Creature Drake'))],
    ['Delve keyword', TASIGUR.filter((line) => line !== 'K:Delve')],
    [
      'Murktide exile count',
      MURKTIDE_REGENT.map((line) =>
        line.replace('Instant.ExiledWithSource,Sorcery.ExiledWithSource', 'Card.ExiledWithSource'),
      ),
    ],
    [
      'Murktide trigger origin',
      MURKTIDE_REGENT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Exile')),
    ],
    [
      'Murktide counter type',
      MURKTIDE_REGENT.map((line) => line.replace('CounterType$ P1P1', 'CounterType$ M1M1')),
    ],
    ['Tasigur mill count', TASIGUR.map((line) => line.replace('NumCards$ 2', 'NumCards$ 3'))],
    ['Tasigur chooser', TASIGUR.map((line) => line.replace('Chooser$ Opponent', 'Chooser$ You'))],
    ['Tasigur filter', TASIGUR.map((line) => line.replace('Card.nonLand+YouOwn', 'Card.YouOwn'))],
    [
      'Hogaak mana restriction',
      HOGAAK.map((line) => line.replace('ManaRestriction$ None', 'ManaRestriction$ Colorless')),
    ],
    [
      'Hogaak cast zone',
      HOGAAK.map((line) => line.replace('AffectedZone$ Graveyard', 'AffectedZone$ Exile')),
    ],
    ['Oracle', TASIGUR.map((line) => line.replace('Mill two cards', 'Mill three cards'))],
    ['ordering', [TASIGUR[1]!, TASIGUR[0]!, ...TASIGUR.slice(2)]],
    ['missing line', HOGAAK.filter((line) => !line.startsWith('S:Mode$ Continuous'))],
    ['extra syntax', [...MURKTIDE_REGENT, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });
});
