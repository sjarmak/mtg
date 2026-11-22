/** Flagless decision-ledger verification is tracked-state-only and deterministic. */
import { describe, expect, it } from 'vitest';
import { main } from '../tools/verify-legacy-cube-decisions';

function output() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    io: { out: (line: string) => lines.push(line), error: (line: string) => errors.push(line) },
  };
}

describe('Legacy Cube decision-ledger verifier CLI', () => {
  it('verifies committed state without a network or machine-local input', () => {
    const capture = output();
    expect(main([], capture.io)).toBe(0);
    expect(capture.errors).toEqual([]);
    expect(capture.lines[0]).toMatch(/600 positions.*14 closed decision families/i);
    expect(capture.lines[1]).toMatch(
      /^reviewed bridge card-family-safe names \(606, not session-safe\): Abbot of Keral Keep, Abrade, Abrupt Decay,.*Worn Powerstone, Wrath of God, Wretched Confluence, Wurmcoil Engine, Xenagos, the Reveler, Yawgmoth, Thran Physician, Yorion, Sky Nomad, Young Pyromancer, Zareth San, the Trickster, Zealous Conscripts, Zurgo Bellstriker$/u,
    );
  });

  it('keeps external archive checks explicit and rejects unknown options', () => {
    const help = output();
    expect(main(['--help'], help.io)).toBe(0);
    expect(help.lines.join('\n')).toContain('--forge-scripts PATH');
    expect(help.lines.join('\n')).toContain('--forge-token-scripts PATH');
    expect(help.lines.join('\n')).toContain('--controller-javap PATH');
    expect(help.lines.join('\n')).toContain('--choose-even-odd-class PATH');
    expect(help.lines.join('\n')).toContain('--choose-even-odd-source PATH');
    expect(help.lines.join('\n')).toContain('--bridge-source PATH');

    const tokenOnly = output();
    expect(main(['--forge-token-scripts', '/not-read-without-root-card-archive'], tokenOnly.io)).toBe(1);
    expect(tokenOnly.errors[0]).toMatch(/requires --forge-scripts/i);

    const unknown = output();
    expect(main(['--fetch'], unknown.io)).toBe(2);
    expect(unknown.errors[0]).toMatch(/unknown option/i);
  });
});
