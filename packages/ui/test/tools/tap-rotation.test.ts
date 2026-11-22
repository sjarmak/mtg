import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../tools/tap-rotation.ts', import.meta.url)), 'utf8');

describe('tap rotation measurement', () => {
  it('measures bare permanents against their rendered row', () => {
    expect(source).toContain("place.getAttribute('data-holds') === 'false' ? place.parentElement : place");
    expect(source).not.toContain('slot.parentElement.getBoundingClientRect()');
  });
});
