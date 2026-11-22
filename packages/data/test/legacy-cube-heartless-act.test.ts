import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedHeartlessActRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Heartless Act',
  'ManaCost:1 B',
  'Types:Instant',
  'A:SP$ Charm | Choices$ Destroy,Remove',
  'SVar:Destroy:DB$ Destroy | ValidTgts$ Creature.!HasCounters | TgtPrompt$ Select target creature with no counters on it | SpellDescription$ Destroy target creature with no counters on it.',
  'SVar:Remove:DB$ RemoveCounter | ValidTgts$ Creature | CounterType$ Any | CounterNum$ 3 | UpTo$ True | SpellDescription$ Remove up to three counters from target creature.',
  'Oracle:Choose one —\\n• Destroy target creature with no counters on it.\\n• Remove up to three counters from target creature.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedHeartlessActRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Heartless Act boundary', () => {
  it('lifts exactly the installed destroy-or-remove-counters composition', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Heartless Act', 'Name:Heartless Deed'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 B', 'ManaCost:B'))],
    ['card type', EXACT.map((line) => line.replace('Types:Instant', 'Types:Sorcery'))],
    ['choice order', EXACT.map((line) => line.replace('Choices$ Destroy,Remove', 'Choices$ Remove,Destroy'))],
    ['destroy API', EXACT.map((line) => line.replace('Destroy:DB$ Destroy', 'Destroy:DB$ Pump'))],
    ['destroy restriction', EXACT.map((line) => line.replace('Creature.!HasCounters', 'Creature'))],
    ['remove API', EXACT.map((line) => line.replace('Remove:DB$ RemoveCounter', 'Remove:DB$ PutCounter'))],
    ['remove target', EXACT.map((line) => line.replace('ValidTgts$ Creature', 'ValidTgts$ Player'))],
    ['counter type', EXACT.map((line) => line.replace('CounterType$ Any', 'CounterType$ P1P1'))],
    ['counter amount', EXACT.map((line) => line.replace('CounterNum$ 3', 'CounterNum$ 4'))],
    ['bounded amount', EXACT.map((line) => line.replace('UpTo$ True', 'UpTo$ False'))],
    [
      'destroy prompt',
      EXACT.map((line) =>
        line.replace('Select target creature with no counters on it', 'Select target creature'),
      ),
    ],
    [
      'Oracle text',
      EXACT.map((line) => line.replace('Remove up to three counters', 'Remove three counters')),
    ],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:Remove:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[3], EXACT[5], EXACT[4], EXACT[6]]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ RemoveCounter | CounterType$ Any']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Heartless Act composition');
  });
});
