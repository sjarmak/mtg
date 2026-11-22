import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Mystic Confluence boundary', () => {
  it('pins the repeatable root and its three ordered modes', () => {
    expect(
      [
        'isReviewedMysticConfluenceCharm',
        '"Mystic Confluence".equals(source.getName())',
        '!"DBCounter,DBReturn,DBDraw".equals(ability.getParam("Choices"))',
        'isReviewedMysticConfluenceCounterMode(modes.get(0), ability)',
        'isReviewedMysticConfluenceReturnMode(modes.get(1), ability)',
        'isReviewedMysticConfluenceDrawMode(modes.get(2), ability)',
        'modes.get(0).getSubAbility() != null',
        'modes.get(1).getSubAbility() != null',
        'modes.get(2).getSubAbility() != null',
        'int index = modes.indexOf(candidate)',
        'if (index <= prior) return false',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins the stack target and its exact targeted-controller pay-three branch', () => {
    expect(
      [
        'isReviewedMysticConfluenceCounterMode',
        '"ThisTargetedController".equals(ability.getParam("UnlessPayer"))',
        '"3".equals(ability.getParam("UnlessCost"))',
        '"{3}".equals(mana)',
        'reviewedMysticConfluenceCounter',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('owns only the exact creature-to-hand target mode', () => {
    expect(
      [
        'isReviewedMysticConfluenceReturnMode',
        '"Battlefield".equals(ability.getParam("Origin"))',
        '"Hand".equals(ability.getParam("Destination"))',
        '"Creature".equals(ability.getParam("ValidTgts"))',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
