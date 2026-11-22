/** Mechanical exact-source accounting; semantic reviews remain explicit overlays. */
import { PrintedScriptCoveragePlanSchema } from '../script-coverage-plan';
import { buildPrintedScriptInventory } from './script-inventory';

const SOURCE_DESCRIPTION =
  'Exact non-comment Forge declarations are present and checksum-bound; behavior is not claimed.';

export function buildPrintedScriptCoveragePlan(
  catalogs: readonly unknown[],
  readScript: (path: string) => string | Uint8Array,
  semanticReviews: readonly unknown[],
) {
  const overlays = PrintedScriptCoveragePlanSchema.parse({
    schemaVersion: 1,
    kind: 'printed-script-coverage-plan',
    scripts: semanticReviews,
  }).scripts;
  const inventory = buildPrintedScriptInventory(catalogs, readScript);
  const scriptsByPath = new Map(inventory.scripts.map((script) => [script.path, script]));
  for (const review of overlays) {
    const script = scriptsByPath.get(review.sourceScript.path);
    if (script === undefined) throw new Error(`Foreign script review: ${review.sourceScript.path}`);
    if (script.sha256 !== review.sourceScript.sha256)
      throw new Error(`Stale script review: ${review.sourceScript.path}`);
  }
  const reviewsByPath = new Map(overlays.map((review) => [review.sourceScript.path, review]));
  return PrintedScriptCoveragePlanSchema.parse({
    schemaVersion: 1,
    kind: 'printed-script-coverage-plan',
    scripts: inventory.scripts.map((script) => {
      const overlay = reviewsByPath.get(script.path);
      if (overlay !== undefined) return overlay;
      if (script.lines.length === 0)
        throw new Error(`Script has no exact declarations to account for: ${script.path}`);
      return {
        sourceScript: { path: script.path, sha256: script.sha256 },
        review: 'partial',
        obligations: [
          {
            id: 'exact-source-declarations',
            description: SOURCE_DESCRIPTION,
            lines: script.lines.map((line) => line.number),
            dependsOn: [],
            proof: 'source',
          },
        ],
        dependencies: [],
      };
    }),
  });
}
