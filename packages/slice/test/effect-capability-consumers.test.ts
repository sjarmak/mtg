import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`could not find source interval ${start} .. ${end}`);
  return text.slice(from, to);
}

describe('effect-kind policy consumers', () => {
  it('reads harmfulness and target scoring from the shared extension contract', () => {
    const harmfulness = source('packages/kernel/src/simple-agent.ts');
    const scoring = source('packages/sim/src/policies/target.ts');

    expect(harmfulness).toContain('EFFECT_CAPABILITIES[effect.kind].harmfulness');
    expect(scoring).toContain('EFFECT_CAPABILITIES[effect.kind].targetScoring');
    expect(between(harmfulness, 'function isHarmful(', 'function aimedValue(')).not.toMatch(
      /switch\s*\(effect\.kind\)/u,
    );
    expect(between(scoring, 'function effectScore(', 'function auraToughnessDelta(')).not.toMatch(
      /switch\s*\(effect\.kind\)/u,
    );
  });

  it('keeps UI narration and prompts free of effect-kind dispatch', () => {
    for (const path of ['packages/ui/src/log/narrate.ts', 'packages/ui/src/routes/play/prompt.ts']) {
      const text = source(path);
      expect(text, path).not.toContain('AnyEffectKind');
      expect(text, path).not.toMatch(/switch\s*\(effect\.kind\)/u);
    }
  });
});
