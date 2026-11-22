import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge exposes permanent sacrifice progress structurally', () => {
  it('keeps the callback generic and puts its bounds in every bridge-owned move id', () => {
    expect(bridge).toContain('choosePermanentsToSacrifice(');
    expect(bridge).toContain('"sacrifice-selection"');
    expect(bridge).toContain('kind, shape.identify().apply(candidate), chosen.size(), floor, ceiling');
    expect(bridge).toContain('progressiveChoiceId(kind, "done", chosen.size(), floor, ceiling)');
    expect(bridge).toContain('kind + "-" + candidateId + "-chosen-" + chosen');
    expect(bridge).toContain('+ "-min-" + minimum + "-max-" + maximum');
  });
});
