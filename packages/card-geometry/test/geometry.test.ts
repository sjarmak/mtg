/**
 * The measurements hold their shape, and the package holds its dependency floor.
 *
 * Nothing here asserts a constant's literal value. A face measurement is a
 * calibration against a browser and it is expected to move; what must not move
 * is the shape of the ladder, the meaning of a step and the set of packages
 * this one is allowed to reach. `packages/ui/test/card-fit.test.ts` and
 * `packages/ui/test/card-fit.browser.test.ts` are where the numbers themselves
 * are held against hand-written cases and against a real layout.
 *
 * The last test is the whole reason this package exists (mtg-plgg). These
 * numbers describe a rectangle, and they used to live in `@mtg/ui`, which
 * depends on the kernel, the simulator and React, so `@mtg/setgen` carried all
 * of that to ask two constants a question. A floor that is only stated in a
 * docblock is a floor that the next import walks through.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import {
  NAME_FIT_STEPS,
  RULES_FIT_STEPS,
  nameFitScale,
  nameFitStepOf,
  rulesFitStepOf,
  rulesTextBlocks,
  textBoxBlocks,
} from '../src/index';

/** Every rung of a ladder, as an index. */
function steps(ladder: readonly number[]): readonly number[] {
  return ladder.map((_, index) => index);
}

describe('the fit ladders', () => {
  it('descend from full size and never reach zero', () => {
    for (const ladder of [RULES_FIT_STEPS, NAME_FIT_STEPS]) {
      expect(ladder[0]).toBe(1);
      expect(Math.min(...ladder)).toBeGreaterThan(0);
      for (const step of steps(ladder).slice(1)) {
        expect(ladder[step]).toBeLessThan(ladder[step - 1] ?? 0);
      }
    }
  });

  it('refuse a rung they do not have', () => {
    expect(() => nameFitScale(NAME_FIT_STEPS.length)).toThrow();
    expect(() => nameFitScale(-1)).toThrow();
  });
});

describe('which rung a string is set at', () => {
  it('is always a rung of the ladder it names', () => {
    const texts = [
      '',
      'Flying.',
      'x'.repeat(60),
      'y'.repeat(4000),
      EXAMPLE_CARDS.map((card) => card.name).join(' '),
    ];
    for (const text of texts) {
      expect(steps(RULES_FIT_STEPS)).toContain(rulesFitStepOf(text));
      expect(steps(NAME_FIT_STEPS)).toContain(nameFitStepOf(text));
    }
  });

  it('starts at full size for a string with nothing in it', () => {
    expect(rulesFitStepOf('')).toBe(0);
    expect(nameFitStepOf('')).toBe(0);
  });

  it('never sets a longer single paragraph larger than a shorter one', () => {
    // Within one paragraph the estimate is monotone in the character count at
    // every rung, so the rung it picks is monotone too. Across paragraphs it is
    // not, which is why this property is stated about one.
    for (const length of [1, 20, 80, 200, 600]) {
      expect(rulesFitStepOf('z'.repeat(length))).toBeLessThanOrEqual(rulesFitStepOf('z'.repeat(length * 2)));
      expect(nameFitStepOf('z'.repeat(length))).toBeLessThanOrEqual(nameFitStepOf('z'.repeat(length * 2)));
    }
  });

  it('sends a paragraph no rung can hold to the floor rather than off the end', () => {
    expect(rulesFitStepOf('w'.repeat(10_000))).toBe(RULES_FIT_STEPS.length - 1);
    expect(nameFitStepOf('w'.repeat(10_000))).toBe(NAME_FIT_STEPS.length - 1);
  });
});

describe('the composed text box', () => {
  it('opens with the rules text the ladder was sized on, on every example card', () => {
    for (const card of EXAMPLE_CARDS) {
      const rules = rulesTextBlocks(card);
      const box = textBoxBlocks(card);
      expect(box.slice(0, rules.length)).toEqual(rules);
      expect(box.length - rules.length).toBeLessThanOrEqual(1);
    }
  });

  it('adds at most a flavor block to it', () => {
    for (const card of EXAMPLE_CARDS) {
      const extra = textBoxBlocks(card).slice(rulesTextBlocks(card).length);
      for (const block of extra) expect(block.kind).toBe('flavor');
    }
  });
});

describe('the dependency floor', () => {
  it('reaches no workspace package but @mtg/dsl', () => {
    const dir = new URL('../src/', import.meta.url).pathname;
    const reached = new Set<string>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(`${dir}${file}`, 'utf8');
      for (const [, specifier = ''] of source.matchAll(/from '(@mtg\/[a-z-]+)'/g)) reached.add(specifier);
    }
    expect([...reached].sort()).toEqual(['@mtg/dsl']);
  });

  it('declares exactly what it reaches', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'),
    );
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> }).dependencies ?? {};
    expect(Object.keys(dependencies).sort()).toEqual(['@mtg/dsl']);
  });
});
