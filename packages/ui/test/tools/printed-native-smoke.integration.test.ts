/** Private native-game discovery, not observed-bridge compatibility admission. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runPrintedNativeSmoke } from '../../tools/printed-native-smoke';

const nativeIt = process.env['MTG_REQUIRE_PRINTED_NATIVE_SMOKE'] === '1' ? it : it.skip;
nativeIt.each(['draft', 'sealed'] as const)(
  'runs an installed native %s game and retains private diagnostic evidence',
  async (mode) => {
    const output = process.env['MTG_PRINTED_NATIVE_SMOKE_OUT'];
    if (output === undefined || output.trim() === '')
      throw new Error('Explicit smoke output directory required');
    const read = async (name: string): Promise<unknown> =>
      JSON.parse(
        await readFile(new URL(`../../../data/data/akh-hou/${name}`, import.meta.url), 'utf8'),
      ) as unknown;
    const result = await runPrintedNativeSmoke({
      format: await read('akh-hou-limited-format-v1.json'),
      catalogs: await Promise.all(
        ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
      ),
      mode,
      seed: 42,
      outputDirectory: join(output, mode),
      timeoutMs: 180_000,
    });
    expect(result.qualification).toBe('unproven');
    expect(result.bridgeCoverage).toBe('not-exercised');
    expect(result.native.error, `See private artifacts in ${output}/${mode}`).toBeNull();
    expect(result.status).toBe('completed-native-game');
    expect(result.native.report?.games).toHaveLength(1);
  },
  240_000,
);
