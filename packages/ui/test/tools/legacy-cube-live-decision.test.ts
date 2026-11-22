import { describe, expect, it, vi } from 'vitest';
import { waitForLegacyCubeDecision } from '../../tools/legacy-cube-live-decision';

describe('waitForLegacyCubeDecision', () => {
  it('continues a combat beat and returns the next enabled legal moves', async () => {
    const enabledMove = {};
    const group = {
      querySelector: vi.fn(() => enabledMove),
    };
    let paused = true;
    const click = vi.fn();
    click.mockImplementation(() => {
      paused = false;
    });
    const waits: string[] = [];
    const waitFor = async <T>(description: string, predicate: () => T | null): Promise<T> => {
      waits.push(description);
      const value = predicate();
      if (value === null) throw new Error('predicate did not resolve');
      return value;
    };

    const decision = await waitForLegacyCubeDecision(
      waitFor,
      () => (paused ? null : group),
      () => (paused ? { disabled: false, click } : undefined),
      'decision',
      120_000,
    );

    expect(decision).toBe(group);
    expect(click).toHaveBeenCalledOnce();
    expect(waits).toHaveLength(2);
  });

  it('returns enabled legal moves without pressing Continue', async () => {
    const group = {
      querySelector: vi.fn(() => ({})),
    };
    const click = vi.fn();
    const waits: string[] = [];
    const waitFor = async <T>(description: string, predicate: () => T | null): Promise<T> => {
      waits.push(description);
      const value = predicate();
      if (value === null) throw new Error('predicate did not resolve');
      return value;
    };

    expect(
      await waitForLegacyCubeDecision(
        waitFor,
        () => group,
        () => ({ disabled: false, click }),
        'decision',
        120_000,
      ),
    ).toBe(group);
    expect(click).not.toHaveBeenCalled();
    expect(waits).toHaveLength(1);
  });
});
