import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact residual multi-target transformation boundary', () => {
  it('routes only the exact Terastodon trigger through bounded distinct 0-to-3 targeting', () => {
    expect(
      [
        'isReviewedTerastodonTargets',
        'chooseTerastodonTargets',
        '"Terastodon".equals(source.getName())',
        'ability.getApi() == ApiType.Destroy',
        '"Permanent.nonCreature".equals(ability.getParam("ValidTgts"))',
        'ability.getMinTargets() == 0',
        'ability.getMaxTargets() == 3',
        '"Targeted".equals(repeat.getParam("DefinedCards"))',
        '"True".equals(repeat.getParam("ChangeZoneTable"))',
        '"RememberedController".equals(token.getParam("TokenOwner"))',
        '"terastodon-targets-done"',
        'outside reviewed-terastodon-targets-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins both Oko target stages and their exact exchange relationship', () => {
    expect(
      [
        'isReviewedOkoTarget',
        '"Oko, Thief of Crowns".equals(source.getName())',
        'root.getApi() == ApiType.Pump',
        '"Artifact.YouCtrl,Creature.YouCtrl".equals(root.getParam("ValidTgts"))',
        'exchange.getApi() == ApiType.ExchangeControl',
        '"ParentTarget".equals(exchange.getParam("Defined"))',
        '"Creature.OppCtrl+powerLE3".equals(exchange.getParam("ValidTgts"))',
        'outside reviewed-oko-targets-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins both Saheeli target stages and excludes the first object from the copy menu', () => {
    expect(
      [
        'isReviewedSaheeliTarget',
        '"Saheeli, Sublime Artificer".equals(source.getName())',
        '"Artifact.YouCtrl".equals(root.getParam("ValidTgts"))',
        'copy.getApi() == ApiType.Clone',
        '"ParentTarget".equals(copy.getParam("CloneTarget"))',
        '"Artifact.YouCtrl,Creature.YouCtrl".equals(copy.getParam("ValidTgts"))',
        '"Artifact".equals(copy.getParam("AddTypes"))',
        '"UntilEndOfTurn".equals(copy.getParam("Duration"))',
        'candidate == root.getTargets().getFirstTargetedCard()',
        'outside reviewed-saheeli-targets-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
