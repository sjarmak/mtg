import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyLegacyCubeForgeScript,
  legacyCubeReviewedFreeCounterspellRefusals,
  loadLegacyCubeDecisionLedger,
  loadLegacyCubeSyntaxReview,
  verifyLegacyCubeDecisionScript,
} from '@mtg/data';

const FORCE_OF_NEGATION = [
  'Name:Force of Negation',
  'ManaCost:1 U U',
  'Types:Instant',
  "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ ExileFromHand<1/Card.Blue+Other> | Condition$ NotPlayerTurn | Description$ If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.",
  "A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target noncreature spell | ValidTgts$ Card.nonCreature | Destination$ Exile | SpellDescription$ Counter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard. | StackDescription$ SpellDescription",
  "Oracle:If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
] as const;

const FORCE_OF_WILL = [
  'Name:Force of Will',
  'ManaCost:3 U U',
  'Types:Instant',
  "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ PayLife<1> ExileFromHand<1/Card.Blue+Other> | Description$ You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.",
  'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | Destination$ Graveyard | AILogic$ MinCMC.3 | SpellDescription$ Counter target spell.',
  "Oracle:You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\\nCounter target spell.",
] as const;

const DAZE = [
  'Name:Daze',
  'ManaCost:1 U',
  'Types:Instant',
  "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ Return<1/Island> | Description$ You may return an Island you control to its owner's hand rather than pay this spell's mana cost.",
  'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 1 | AILogic$ MinCMC.4 | SpellDescription$ Counter target spell unless its controller pays {1}.',
  "Oracle:You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\\nCounter target spell unless its controller pays {1}.",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const ledger = loadLegacyCubeDecisionLedger();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedFreeCounterspellRefusals(Buffer.from(lines.join('\n')), syntax);

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

describe('Legacy Cube reviewed free-counterspell cohort', () => {
  it.each([
    ['Force of Negation', FORCE_OF_NEGATION],
    ['Force of Will', FORCE_OF_WILL],
    ['Daze', DAZE],
  ] as const)('admits only the exact complete installed %s script', (_name, lines) => {
    expect(refusal(lines)).toEqual([]);
  });

  it.each([
    [143, FORCE_OF_NEGATION],
    [150, FORCE_OF_WILL],
    [155, DAZE],
  ] as const)(
    'keeps position %i admitted when the complete ledger verifier reloads it',
    (position, lines) => {
      expect(() => verifyPosition(position, lines)).not.toThrow();
    },
  );

  it.each([
    ['identity', FORCE_OF_WILL.map((line) => line.replace('Name:Force of Will', 'Name:Other'))],
    ['mana cost', FORCE_OF_WILL.map((line) => line.replace('ManaCost:3 U U', 'ManaCost:2 U U'))],
    ['card type', FORCE_OF_NEGATION.map((line) => line.replace('Types:Instant', 'Types:Sorcery'))],
    [
      'alternate mode',
      FORCE_OF_WILL.map((line) => line.replace('Mode$ AlternativeCost', 'Mode$ Continuous')),
    ],
    ['Force life cost', FORCE_OF_WILL.map((line) => line.replace('PayLife<1>', 'PayLife<2>'))],
    ['Force exile count', FORCE_OF_WILL.map((line) => line.replace('ExileFromHand<1/', 'ExileFromHand<2/'))],
    ['Force exile filter', FORCE_OF_NEGATION.map((line) => line.replace('Card.Blue+Other', 'Card+Other'))],
    [
      'Negation condition',
      FORCE_OF_NEGATION.map((line) => line.replace('Condition$ NotPlayerTurn', 'Condition$ PlayerTurn')),
    ],
    ['Negation target', FORCE_OF_NEGATION.map((line) => line.replace('Card.nonCreature', 'Card'))],
    [
      'Negation destination',
      FORCE_OF_NEGATION.map((line) => line.replace('Destination$ Exile', 'Destination$ Graveyard')),
    ],
    ['Daze return count', DAZE.map((line) => line.replace('Return<1/Island>', 'Return<2/Island>'))],
    ['Daze return filter', DAZE.map((line) => line.replace('Return<1/Island>', 'Return<1/Land>'))],
    ['Daze tax', DAZE.map((line) => line.replace('UnlessCost$ 1', 'UnlessCost$ 2'))],
    ['Oracle', DAZE.map((line) => line.replace('Counter target spell unless', 'Counter a spell unless'))],
    ['ordering', [DAZE[1]!, DAZE[0]!, ...DAZE.slice(2)]],
    ['missing line', FORCE_OF_NEGATION.filter((line) => !line.startsWith('S:Mode$'))],
    ['extra syntax', [...FORCE_OF_WILL, 'SVar:Unreviewed:DB$ Draw | NumCards$ 1']],
  ])('refuses hostile %s drift', (_label, lines) => {
    expect(refusal(lines)).not.toEqual([]);
  });
});
