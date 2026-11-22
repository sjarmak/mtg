import { describe, expect, it } from 'vitest';
import type { RunManifest } from '@mtg/llm';
import {
  CURRENT_GENERATION_SEMANTICS_VERSION,
  generationSemanticsFor,
  LEGACY_GENERATION_SEMANTICS_VERSION,
  SETGEN_GENERATOR_NAME,
} from '@mtg/setgen';

const LEGACY_MANIFEST: RunManifest = {
  id: 'recorded-run',
  run: 'recorded-run',
  brief: 'brief.json',
  recordedAt: '2026-08-01T00:00:00.000Z',
  calls: 1,
  keys: ['aaa'],
};

describe('generation semantics at the recorded-run boundary', () => {
  it('treats manifests from before explicit versioning as legacy recordings', () => {
    expect(generationSemanticsFor(LEGACY_MANIFEST)).toBe(LEGACY_GENERATION_SEMANTICS_VERSION);
  });

  it('uses the semantics version a current setgen run records', () => {
    expect(
      generationSemanticsFor({
        ...LEGACY_MANIFEST,
        generator: { name: SETGEN_GENERATOR_NAME, semanticsVersion: 2 },
      }),
    ).toBe(CURRENT_GENERATION_SEMANTICS_VERSION);
  });

  it('refuses another producer or an unsupported version instead of guessing', () => {
    expect(() =>
      generationSemanticsFor({
        ...LEGACY_MANIFEST,
        generator: { name: 'another-generator', semanticsVersion: 2 },
      }),
    ).toThrow(/another-generator/);
    expect(() =>
      generationSemanticsFor({
        ...LEGACY_MANIFEST,
        generator: { name: SETGEN_GENERATOR_NAME, semanticsVersion: 3 },
      }),
    ).toThrow(/version 3/);
  });
});
