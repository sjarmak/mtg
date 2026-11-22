import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Cryptic Command's exact modal stack target", () => {
  it('requires the exact source, Counter API, subability shape, and root Charm spell', () => {
    expect(bridge).toContain('"Cryptic Command".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Counter');
    expect(bridge).toContain('ability.getParent() != null');
    expect(bridge).toContain('root != ability');
    expect(bridge).toContain('root.isSpell()');
    expect(bridge).toContain('root.getApi() == ApiType.Charm');
  });

  it('keeps every other stack-target shape on the existing fail-closed path', () => {
    expect(bridge).toContain('(stackTarget && !isOwnedStackTargeter(ability))');
    expect(bridge).toContain('|| reviewedCrypticCounter');
    // The stack-target counter list, in order. Every later set that counters something on the
    // stack adds its own reviewed guard to it, so tolerate terms between any two members.
    expect(bridge).toMatch(
      /return ability\.isSpell\(\)\s*(?:\|\|\s*\w+\s*)*\|\|\s*ability\.getApi\(\) == ApiType\.ChangeTargets\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedCrypticCounter\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSupremeWillCounter\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedMysticConfluenceCounter\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedGlenElendraCounter\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedStratusDancerCounter\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedNimbleObstructionistCounter\s*(?:\|\|\s*\w+\s*)*;/u,
    );
  });
});
