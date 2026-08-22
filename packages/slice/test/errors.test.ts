import { describe, expect, it } from 'vitest';
import type { SliceStageError } from '@mtg/slice';
import { SLICE_STAGES, STAGE_LABELS, failStage, isSliceStageError, runStage } from '@mtg/slice';

describe('stage attribution', () => {
  it('labels every stage it declares', () => {
    for (const stage of SLICE_STAGES) {
      expect(STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
  });

  it('passes a stage result through untouched', async () => {
    await expect(runStage('sim', () => 41 + 1)).resolves.toBe(42);
    await expect(runStage('sim', async () => 'ok')).resolves.toBe('ok');
  });

  it('attributes an unattributed throw to the stage that was running', async () => {
    const error = await runStage('deckbuild', () => {
      throw new Error('pool is empty');
    }).catch((thrown: unknown) => thrown);

    expect(isSliceStageError(error)).toBe(true);
    const stageError = error as SliceStageError;
    expect(stageError.stage).toBe('deckbuild');
    expect(stageError.reason).toBe('pool is empty');
    expect(stageError.message).toContain('stage "deckbuild" failed');
    expect(stageError.cause).toBeInstanceOf(Error);
  });

  it('keeps the innermost attribution when stages nest', async () => {
    const error = await runStage('sim', () =>
      runStage('metrics', () => {
        failStage('metrics', 'no gates were produced');
      }),
    ).catch((thrown: unknown) => thrown);

    expect((error as SliceStageError).stage).toBe('metrics');
    expect((error as SliceStageError).reason).toBe('no gates were produced');
  });

  it('attributes non-Error throws too, so nothing escapes unlabeled', async () => {
    const error = await runStage('bench', () => {
      throw 'string failure';
    }).catch((thrown: unknown) => thrown);

    expect((error as SliceStageError).stage).toBe('bench');
    expect((error as SliceStageError).reason).toBe('string failure');
  });
});
