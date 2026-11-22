import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('printed-card entrypoint boundaries', () => {
  it('bundles the complete public schema for browsers without Node dependencies', async () => {
    const result = await build({
      entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
    });
    expect(result.outputFiles[0]?.text).toContain('evaluatePrintedPlayAdmission');
    expect(Object.keys(result.metafile.inputs).some((path) => path.includes('/src/node/'))).toBe(false);
  });

  it('exposes evidence verification only through the explicit Node entrypoint', async () => {
    const node = await import('@mtg/printed-card/node');
    const portable = await import('@mtg/printed-card');
    expect(typeof node.verifyPrintedLimitedPlayAdmission).toBe('function');
    expect(typeof node.verifyPrintedPlayAdmission).toBe('function');
    expect(typeof node.verifyPrintedFormatPlayAdmission).toBe('function');
    expect(typeof node.verifiedPrintedFormat).toBe('function');
    expect(portable).not.toHaveProperty('verifyPrintedLimitedPlayAdmission');
  });
});
