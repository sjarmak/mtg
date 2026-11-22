/** Static lock for Skyclave Apparition's exact optional ETB target. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('reviewed Skyclave Apparition optional trigger target', () => {
  it('owns only the exact singleton ChangeZone trigger', () => {
    expect(bridge).toContain('isReviewedSkyclaveApparitionTarget');
    expect(bridge).toContain('"Skyclave Apparition".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain(
      '"Permanent.nonLand+!token+YouDontCtrl+cmcLE4".equals(ability.getParam("ValidTgts"))',
    );
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    // Skyclave Apparition's target is the tail of the reviewed-target disjunction today; a
    // later set appends its own isReviewed* predicate after it, ahead of the semicolon.
    expect(bridge).toMatch(
      /\|\|\s*isReviewedSkyclaveApparitionTarget\(ability\)\s*(?:\|\|\s*[\w.]+(?:\([^()]*\))?\s*)*;/u,
    );
  });

  it('keeps invented, stale, and non-candidate target identities closed', () => {
    expect(bridge).toContain('reviewedSkyclaveApparitionTarget');
    expect(bridge).toContain('Forge offered a Skyclave Apparition target outside its exact profile');
    expect(bridge).toContain('selected target disappeared');
  });
});
