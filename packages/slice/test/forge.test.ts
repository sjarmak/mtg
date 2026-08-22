import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { SliceStageError } from '@mtg/slice';
import { runForgeStage } from '@mtg/slice';
import { tempDir, removeDir } from './helpers';

describe('the Forge boot gate stage', () => {
  it('reports a requested skip as a skip, never as a pass', async () => {
    const result = await runForgeStage(EXAMPLE_CARDS, { skip: true, forgeHome: null });
    expect(result.status).toBe('skipped');
    expect(result.skippedByRequest).toBe(true);
    expect(result.reason).toContain('unproven');
    expect(result.forgeVersion).toBeNull();
  });

  it('skips with the path it looked in when Forge is absent', async () => {
    const dir = tempDir('mtg-slice-forge-');
    try {
      const missing = join(dir, 'no-forge-here');
      const result = await runForgeStage(EXAMPLE_CARDS, { skip: false, forgeHome: missing });
      expect(result.status).toBe('skipped');
      expect(result.skippedByRequest).toBe(false);
      expect(result.reason).toContain(missing);
      // Transpilation runs before the engine lookup, so a skip here still means
      // every card mapped to a Forge script.
      expect(result.cardCount).toBe(EXAMPLE_CARDS.length);
    } finally {
      removeDir(dir);
    }
  });

  it('fails, attributed, when there is nothing to boot', async () => {
    const error: unknown = await runForgeStage([], { skip: false, forgeHome: null }).then(
      (result) => result,
      (thrown: unknown) => thrown,
    );
    const stageError = error as SliceStageError;
    expect(stageError.stage).toBe('forge');
    expect(stageError.reason).toContain('empty');
  });
});
