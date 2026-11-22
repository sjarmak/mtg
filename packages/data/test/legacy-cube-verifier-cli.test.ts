/** The flagless provenance gate is offline and depends only on tracked state. */
import { describe, expect, it } from 'vitest';
import { main } from '../tools/verify-legacy-cube';

function capture(): {
  readonly output: string[];
  readonly errors: string[];
  readonly io: { readonly out: (line: string) => void; readonly error: (line: string) => void };
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: {
      out: (line) => output.push(line),
      error: (line) => errors.push(line),
    },
  };
}

describe('Legacy Cube provenance verifier command', () => {
  it('verifies only the committed artifact when given no flags', async () => {
    const result = capture();
    expect(await main([], result.io)).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.output.join('\n')).toContain('600 Full Cardlist rows');
    expect(result.output.join('\n')).toContain('optional external inputs were not checked');
  });

  it('makes live retrieval an explicit option', async () => {
    const result = capture();
    expect(await main(['--snapshot', 'page.html', '--fetch'], result.io)).toBe(2);
    expect(result.errors[0]).toMatch(/mutually exclusive/i);
    expect(result.errors.join('\n')).toContain('--fetch');
  });
});
