/**
 * `mtg-5923`: a config key the builder does not read used to be dropped in
 * silence, and the run that found it read as a clean null result.
 *
 * The incident is the first test here, spelled the way it was actually
 * mistyped, because the whole point of the check is that this particular
 * mistake is not a typo — the key is real, it lives one level down, and a bare
 * "unknown key" would have sent the reader hunting for a spelling error they
 * did not make.
 */
import { describe, expect, it } from 'vitest';
import { ALL_EFFECT_KINDS, KEYWORDS } from '@mtg/dsl';
import { checkUnknownConfigKeys, DEFAULT_SCORE_WEIGHTS, resolveConfig } from '@mtg/deckbuild';
import type { DeckBuildConfigInput } from '@mtg/deckbuild';

/** `resolveConfig` is typed, so an invented key needs the cast the caller's JSON did not. */
const asInput = (value: unknown): DeckBuildConfigInput => value as DeckBuildConfigInput;

describe('a config key the builder does not read', () => {
  it('is refused by name, and the refusal names the level that does declare it', () => {
    expect(() => resolveConfig(asInput({ formatMedianRounds: 999 }))).toThrow(
      /`formatMedianRounds`.*declared at `weights\.formatMedianRounds`/,
    );
  });

  it('resolves at the level that declares it, which is the run that was lost', () => {
    const resolved = resolveConfig({ weights: { formatMedianRounds: 999 } });
    expect(resolved.weights.formatMedianRounds).toBe(999);
    expect(DEFAULT_SCORE_WEIGHTS.formatMedianRounds).not.toBe(999);
  });

  it('names the nearest declared key when the name exists nowhere', () => {
    expect(() => resolveConfig(asInput({ landCounts: 17 }))).toThrow(
      /`landCounts`.*nearest declared key here is `landCount`/,
    );
  });

  it('says so plainly when nothing in the config is close', () => {
    expect(() => resolveConfig(asInput({ mulliganDepth: 3 }))).toThrow(
      /`mulliganDepth`.*no key of that name exists anywhere in the config/,
    );
  });
});

describe('the check reaches every level the config accepts', () => {
  it('refuses an unknown keyword inside a per-keyword record', () => {
    expect(() => resolveConfig(asInput({ weights: { keywordBase: { flyng: 2 } } }))).toThrow(
      /`weights\.keywordBase\.flyng`/,
    );
  });

  it('refuses a misspelled field inside one effect weight row', () => {
    const kind = ALL_EFFECT_KINDS[0];
    expect(() =>
      resolveConfig(asInput({ weights: { effectValue: { [kind]: { base: 1, perunit: 2 } } } })),
    ).toThrow(/perunit`.*nearest declared key here is `perUnit`/);
  });

  it('refuses an unknown mana-base key', () => {
    expect(() => resolveConfig(asInput({ manaBase: { castibilityTarget: 0.9 } }))).toThrow(
      /`manaBase\.castibilityTarget`.*nearest declared key here is `castabilityTarget`/,
    );
  });

  it('reports every offending key rather than the first, in one message', () => {
    let message = '';
    try {
      resolveConfig(asInput({ landCounts: 17, mulliganDepth: 3, weights: { flat: 1 } }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('`landCounts`');
    expect(message).toContain('`mulliganDepth`');
    expect(message).toContain('`weights.flat`');
    expect(message).toContain('unrecognized keys');
  });
});

describe('the declared key set is derived from the defaults, not written down here', () => {
  it('accepts every key the resolved config actually carries', () => {
    const resolved = resolveConfig();
    for (const key of Object.keys(resolved)) {
      expect(() => checkUnknownConfigKeys({ [key]: resolved[key as keyof typeof resolved] })).not.toThrow();
    }
    for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
      expect(() =>
        checkUnknownConfigKeys({
          weights: { [key]: DEFAULT_SCORE_WEIGHTS[key as keyof typeof DEFAULT_SCORE_WEIGHTS] },
        }),
      ).not.toThrow();
    }
  });

  it('accepts every effect kind and every keyword the DSL ships', () => {
    for (const kind of ALL_EFFECT_KINDS) {
      expect(() =>
        checkUnknownConfigKeys({ weights: { effectValue: { [kind]: { base: 0, perUnit: 0 } } } }),
      ).not.toThrow();
    }
    for (const keyword of KEYWORDS) {
      expect(() => checkUnknownConfigKeys({ weights: { keywordBase: { [keyword]: 0 } } })).not.toThrow();
    }
  });

  it('leaves an empty config and a fully-stated one alone', () => {
    expect(() => resolveConfig()).not.toThrow();
    expect(() => resolveConfig(resolveConfig())).not.toThrow();
  });
});
