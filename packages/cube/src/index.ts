/**
 * `@mtg/cube` — a cube as a checkable artifact: stated criteria in, a
 * constructed list plus the measurements that say whether it met them out.
 *
 * The package is the cube-scale sibling of `@mtg/decklab` and it splits the
 * same way. Code owns the facts: what is legal in a format, what a color
 * identity contains, how many cards each color holds, how the curve falls, how
 * many cards an archetype has, how many a pod consumes. The model owns the one
 * judgment code must not make: which cards serve which archetype.
 *
 * ```ts
 * const cube = await constructCube({
 *   store: openStore('data/store/mtg.sqlite', { readonly: true }),
 *   provider: resolveProvider(),
 *   criteria: {
 *     prompt: 'a low-power singleton cube for eight drafters',
 *     format: 'modern',
 *     maxCardUsd: 5,
 *     archetypes: [{ name: 'boros aggro', colors: ['W', 'R'], minPlayable: 24 }],
 *   },
 * });
 * console.log(formatCubeReport(cube));
 * ```
 *
 * The same thing from a shell, which is how a person reaches it:
 *
 * ```
 * npx tsx packages/cube/src/cli.ts --prompt "a low-power singleton cube" \
 *   --format modern --max-card-usd 5 --archetypes "boros aggro:WR:24"
 * ```
 *
 * **The draft half of `mtg-bc2.25` is here now.** A finished list whose cards
 * are DSL cards is drafted `DEFAULT_AVAILABILITY_DRAFTS` times through
 * `@mtg/draft-export`'s `runDraft`, and each seat's pool is offered to
 * `buildDeck` in every stated archetype's colors; the share of seats that could
 * assemble each archetype is reported beside pod capacity and the playable
 * census, and failed against a minimum the cube stated. A cube cut from the card
 * store is measured but not drafted, and `availability.ts` carries the reason —
 * `runDraft` drafts DSL cards, and a real printing's rules text is not one.
 */

export {
  cubeBoosterRecipe,
  DEFAULT_AVAILABILITY_DRAFTS,
  DEFAULT_AVAILABILITY_SEED,
  measureAvailability,
  UndraftableCubeError,
} from './availability';
export type {
  ArchetypeAvailability,
  AvailabilityMeasured,
  AvailabilityOptions,
  AvailabilityUnmeasured,
  CubeAvailability,
} from './availability';

export {
  bandHolds,
  bandLabel,
  CUBE_DEFAULT_CARDS_PER_SEAT,
  CUBE_DEFAULT_SEATS,
  CUBE_DEFAULT_SIZE,
  CubeArchetypeSchema,
  CubeCriteriaSchema,
  cubeCopyLimit,
  CurveBandSchema,
  draftCapacity,
  parseArchetypeSpecs,
} from './criteria';
export type { CubeArchetype, CubeCriteria, CubeCriteriaInput, CurveBand } from './criteria';

export {
  assembleCube,
  constructCube,
  cubeRoundCostUsd,
  DEFAULT_CUBE_ROUNDS,
  defaultMaxCubeSpendUsd,
  EmptyCubePoolError,
} from './construct';
export type { AssembleCubeInput, ConstructCubeInput, ConstructedCube, ConstructionStop } from './construct';

export {
  candidateFromDslCard,
  DuplicateSetCardError,
  setCubePool,
  UnpriceableCubePoolError,
} from './set-pool';
export type { GeneratedSet } from './set-pool';

export { formatCubeReport } from './report';

export {
  buildCubePrompt,
  cubeProposalSchema,
  cubeSystem,
  proposeCubeCards,
  verifyCubeProposals,
} from './propose';
export type {
  CubeCardProposal,
  CubeProposal,
  CubeRejection,
  CubeRejectionCode,
  CubeVerifyResult,
  VerifyCubeInput,
} from './propose';

export { selectCubePool, toPoolQuery } from './universe';
export type { CubePool } from './universe';

export { measureCube, measuredColors, validateCube, withinArchetype } from './validate';
export type {
  ArchetypeMeasure,
  ColorMeasure,
  CubeEntry,
  CubeFinding,
  CubeFindingCode,
  CubeMeasurement,
  CubeValidation,
  CurveMeasure,
} from './validate';
