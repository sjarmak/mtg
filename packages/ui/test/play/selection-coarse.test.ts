// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ObjectId } from '@mtg/kernel';
import { useEnumeratedSelection } from '../../src/routes/play/selection';
import type { EnumeratedSelection } from '../../src/routes/play/selection';
import type { PlayChoice } from '../../src/routes/play/prompt';

afterEach(cleanup);

function choice(index: number, oid: ObjectId): PlayChoice {
  return { index, label: 'Play', detail: null, kind: 'other', oids: [oid] };
}

function hook(
  byObject: ReadonlyMap<string, readonly PlayChoice[]>,
  coarse: boolean,
): {
  readonly result: { readonly current: EnumeratedSelection };
  readonly onChoose: ReturnType<typeof vi.fn>;
} {
  const onChoose = vi.fn();
  const rendered = renderHook(() => useEnumeratedSelection({ decisions: 0, byObject, onChoose, coarse }));
  return { result: rendered.result, onChoose };
}

describe('a single-choice card on a coarse pointer', () => {
  it('reads on the first tap and plays on the second', () => {
    const byObject = new Map([['o0', [choice(0, 'o0')]]]);
    const { result, onChoose } = hook(byObject, true);

    act(() => result.current.select('o0'));
    expect(onChoose).not.toHaveBeenCalled();
    expect(result.current.openKey).toBe('o0');

    act(() => result.current.select('o0'));
    expect(onChoose).toHaveBeenCalledWith(0);
  });

  it('draws no picker between the two taps', () => {
    const byObject = new Map([['o0', [choice(0, 'o0')]]]);
    const { result } = hook(byObject, true);

    act(() => result.current.select('o0'));
    expect(result.current.pickerFor('o0', 'Mountain')).toBeNull();
  });
});

describe('a single-choice card on a fine pointer', () => {
  it('plays on the first tap, as it always has', () => {
    const byObject = new Map([['o0', [choice(0, 'o0')]]]);
    const { result, onChoose } = hook(byObject, false);

    act(() => result.current.select('o0'));
    expect(onChoose).toHaveBeenCalledWith(0);
  });
});

describe('a fast double tap on a single-choice card', () => {
  it('plays it, where the single-choice guard used to do nothing', () => {
    const byObject = new Map([['o0', [choice(0, 'o0')]]]);
    const { result, onChoose } = hook(byObject, true);

    act(() => result.current.activate('o0'));
    expect(onChoose).toHaveBeenCalledWith(0);
  });
});

describe('a card with several choices on a coarse pointer', () => {
  it('opens a menu on the first tap and closes it on the second, neither committing', () => {
    const byObject = new Map([['o0', [choice(0, 'o0'), choice(1, 'o0')]]]);
    const { result, onChoose } = hook(byObject, true);

    act(() => result.current.select('o0'));
    expect(onChoose).not.toHaveBeenCalled();
    expect(result.current.openKey).toBe('o0');

    act(() => result.current.select('o0'));
    expect(onChoose).not.toHaveBeenCalled();
    expect(result.current.openKey).toBeNull();
  });
});
