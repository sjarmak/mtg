import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedTriggerTargetRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const exactLines = [
  'Name:Stratus Dancer',
  'ManaCost:1 U',
  'Types:Creature Djinn Monk',
  'PT:2/1',
  'K:Flying',
  'K:Megamorph:1 U',
  'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigCounter | TriggerZones$ Battlefield | TriggerDescription$ When CARDNAME is turned face up, counter target instant or sorcery spell.',
  'SVar:TrigCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Instant,Sorcery | TgtPrompt$ Select target instant or sorcery spell',
] as const;

function refusals(lines: readonly string[]): readonly string[] {
  return legacyCubeReviewedTriggerTargetRefusals(new TextEncoder().encode(lines.join('\n')), inventory);
}

describe('Legacy Cube exact Stratus Dancer admission boundary', () => {
  it('admits only its exact megamorph counter-trigger shape', () => {
    expect(refusals(exactLines)).toEqual([]);
  });

  it.each([
    ['identity', 'Name:Stratus Dancer', 'Name:Unreviewed Dancer'],
    ['megamorph cost', 'K:Megamorph:1 U', 'K:Megamorph:U'],
    ['trigger mode', 'T:Mode$ TurnFaceUp', 'T:Mode$ ChangesZone'],
    ['trigger zone', 'TriggerZones$ Battlefield', 'TriggerZones$ Command'],
    ['target kind', 'TargetType$ Spell', 'TargetType$ Permanent'],
    ['target filter', 'ValidTgts$ Instant,Sorcery', 'ValidTgts$ Card'],
  ] as const)('refuses a %s mutation', (_label, from, to) => {
    expect(refusals(exactLines.map((line) => line.replace(from, to)))).not.toEqual([]);
  });

  it('refuses an added second target', () => {
    expect(
      refusals(
        exactLines.map((line) => (line.startsWith('SVar:TrigCounter:') ? `${line} | TargetMax$ 2` : line)),
      ),
    ).toContain('multiple targets');
  });
});
