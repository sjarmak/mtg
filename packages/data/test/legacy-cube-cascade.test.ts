import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedCascadeRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));

const bloodbraid = [
  'Name:Bloodbraid Elf',
  'ManaCost:2 R G',
  'Types:Creature Elf Berserker',
  'PT:3/2',
  'K:Haste',
  'K:Cascade',
  'Oracle:Haste\\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
] as const;

const shardless = [
  'Name:Shardless Agent',
  'ManaCost:1 G U',
  'Types:Artifact Creature Human Rogue',
  'PT:2/2',
  'K:Cascade',
  'SVar:PlayMain1:TRUE',
  'Oracle:Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
] as const;

describe('Legacy Cube reviewed cascade spells', () => {
  it.each([
    ['Bloodbraid Elf', bloodbraid],
    ['Shardless Agent', shardless],
  ] as const)('admits only the exact %s cascade route', (_label, script) => {
    expect(legacyCubeReviewedCascadeRefusals(bytes(script), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', bloodbraid.map((line) => line.replace('Name:Bloodbraid Elf', 'Name:Other'))],
    ['another mana value', bloodbraid.map((line) => line.replace('ManaCost:2 R G', 'ManaCost:3 R G'))],
    ['another body', shardless.map((line) => line.replace('PT:2/2', 'PT:3/2'))],
    ['another keyword', shardless.map((line) => line.replace('K:Cascade', 'K:Haste'))],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedCascadeRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
