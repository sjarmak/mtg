import type { RunManifest } from '@mtg/llm';

export const SETGEN_GENERATOR_NAME = '@mtg/setgen';
export const LEGACY_GENERATION_SEMANTICS_VERSION = 1;
export const CURRENT_GENERATION_SEMANTICS_VERSION = 2;

export type GenerationSemanticsVersion =
  typeof LEGACY_GENERATION_SEMANTICS_VERSION | typeof CURRENT_GENERATION_SEMANTICS_VERSION;

/**
 * Resolve the control-flow semantics a recorded request sequence used.
 *
 * Manifests written before this field existed are the v1 corpus. New recordings
 * state their version explicitly, so future behavior changes do not silently
 * re-key historical runs. Ordinary generation does not call this function and
 * stays on the current version.
 */
export function generationSemanticsFor(manifest: RunManifest): GenerationSemanticsVersion {
  const generator = manifest.generator;
  if (generator === undefined) return LEGACY_GENERATION_SEMANTICS_VERSION;
  if (generator.name !== SETGEN_GENERATOR_NAME) {
    throw new Error(
      `run ${manifest.id} was produced by ${generator.name}, not ${SETGEN_GENERATOR_NAME}; ` +
        'its generation semantics cannot be inferred',
    );
  }
  if (
    generator.semanticsVersion !== LEGACY_GENERATION_SEMANTICS_VERSION &&
    generator.semanticsVersion !== CURRENT_GENERATION_SEMANTICS_VERSION
  ) {
    throw new Error(
      `run ${manifest.id} uses unsupported ${SETGEN_GENERATOR_NAME} semantics version ${generator.semanticsVersion}`,
    );
  }
  return generator.semanticsVersion;
}
