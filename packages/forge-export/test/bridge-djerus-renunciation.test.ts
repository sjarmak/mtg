import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("Djeru's Renunciation target controller", () => {
  it('admits only its exact optional zero-to-two creature target shape', () => {
    expect(
      [
        'isReviewedDjerusRenunciationTarget',
        '"Djeru\'s Renunciation".equals(source.getName())',
        'source.isInstant()',
        'ability.getApi() == ApiType.Tap',
        'ability.getMinTargets() == 0 && ability.getMaxTargets() == 2',
        '"Creature".equals(ability.getParam("ValidTgts"))',
        '"djerus-renunciation-targets-done"',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
