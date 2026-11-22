/**
 * Whether chrome-headless-shell can run Stagehand's bundled extension is
 * unverified. Two distinct failures must both become one clean, named
 * `StagehandRuntimeRefusalError`: the untyped `Extensions.loadUnpacked`
 * message, and the typed `StagehandRuntimeIncompatibleError` protocol
 * mismatch. No network, no browser: the SDK's own error classes are
 * constructed directly, off its own schema.
 */
import { describe, expect, it } from 'vitest';
import { StagehandRuntimeIncompatibleError } from '@browserbasehq/stagehand';
import { StagehandRuntimeRefusalError, withRuntimePreflight } from '../../tools/stagehand-runtime';

describe('withRuntimePreflight', () => {
  it('passes a successful run through unchanged', async () => {
    await expect(withRuntimePreflight(async () => 'ok')).resolves.toBe('ok');
  });

  it('turns the untyped Extensions.loadUnpacked message into a named refusal', async () => {
    const original = new Error(
      'Protocol error (Extensions.loadUnpacked): This Chrome build does not support Extensions.loadUnpacked.',
    );
    await expect(
      withRuntimePreflight(async () => {
        throw original;
      }),
    ).rejects.toBeInstanceOf(StagehandRuntimeRefusalError);

    try {
      await withRuntimePreflight(async () => {
        throw original;
      });
      throw new Error('expected withRuntimePreflight to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(StagehandRuntimeRefusalError);
      const refusal = error as StagehandRuntimeRefusalError;
      expect(refusal.message).toContain('Extensions.loadUnpacked');
      expect(refusal.cause).toBe(original);
    }
  });

  it('turns a typed protocol-version mismatch into the same named refusal', async () => {
    const original = new StagehandRuntimeIncompatibleError({
      kind: 'incompatible',
      reason: 'protocol-major-mismatch',
      detail: 'the extension reports protocol 1.0.0, this SDK speaks 2.0.0',
      required: { protocolVersion: '2.0.0' },
      reported: {
        protocolVersion: '1.0.0',
        serverInfo: { name: 'stagehand-extension', version: '1.0.0' },
      },
    });

    try {
      await withRuntimePreflight(async () => {
        throw original;
      });
      throw new Error('expected withRuntimePreflight to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(StagehandRuntimeRefusalError);
      const refusal = error as StagehandRuntimeRefusalError;
      expect(refusal.message).toContain('protocol-major-mismatch');
      expect(refusal.cause).toBe(original);
    }
  });

  it('leaves any other error untouched', async () => {
    const original = new Error('a network timeout, unrelated to the runtime');
    await expect(
      withRuntimePreflight(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });
});
