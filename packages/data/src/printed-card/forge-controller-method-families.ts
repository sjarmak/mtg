/**
 * The decision family each `PlayerController` callback belongs to.
 *
 * `forge-effect-controller-calls-v1.json` says which callbacks an effect class
 * calls; this table says what a callback is. Most rows are the Legacy Cube
 * ledger's reviewed translation (`controllerSurface.abstractCallbacks`), keyed by
 * method name; the ledger lists abstract callbacks only, so the few concrete
 * methods an effect also calls are reviewed here and say why they are not
 * decisions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import {
  LegacyCubeDecisionFamilySchema,
  type LegacyCubeDecisionFamily,
} from '../legacy-cube/decision-ledger';

export const FORGE_CONTROLLER_METHOD_FAMILIES_PATH = fileURLToPath(
  new URL('../../data/forge-controller-method-families-v1.json', import.meta.url),
);

export const ForgeControllerMethodFamiliesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  forge: z.strictObject({ version: z.string().min(1), jarSha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
  source: z.string().min(1),
  methods: z
    .array(
      z.strictObject({
        method: z.string().min(1),
        disposition: z.enum(['decision', 'non-decision', 'outside-legacy-cube-session']),
        families: z.array(LegacyCubeDecisionFamilySchema),
        basis: z.enum(['legacy-cube-ledger', 'reviewed-here']),
        /** Required when the row is reviewed here: the reason it raises no decision. */
        note: z.string().min(1).optional(),
      }),
    )
    .min(1),
});
export type ForgeControllerMethodFamilies = z.infer<typeof ForgeControllerMethodFamiliesSchema>;

export function parseForgeControllerMethodFamilies(value: unknown): ForgeControllerMethodFamilies {
  const parsed = ForgeControllerMethodFamiliesSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('Forge controller method families', parsed.error.message);
  const seen = new Set<string>();
  for (const row of parsed.data.methods) {
    if (seen.has(row.method)) {
      throw new InvalidInputError('Forge controller method families', `duplicate method: ${row.method}`);
    }
    seen.add(row.method);
    if ((row.disposition === 'decision') !== row.families.length > 0) {
      throw new InvalidInputError(
        'Forge controller method families',
        `${row.method}: a decision has families and every other disposition has none`,
      );
    }
    if (row.basis === 'reviewed-here' && row.note === undefined) {
      throw new InvalidInputError(
        'Forge controller method families',
        `${row.method}: reviewed rows carry a note`,
      );
    }
  }
  return parsed.data;
}

export function loadForgeControllerMethodFamilies(
  path: string = FORGE_CONTROLLER_METHOD_FAMILIES_PATH,
): ForgeControllerMethodFamilies {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Forge controller method families',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  return parseForgeControllerMethodFamilies(value);
}

/** The families a set of called methods raises; a method with no row is an error, never a guess. */
export function familiesOfCalls(
  calls: readonly string[],
  table: ForgeControllerMethodFamilies,
): ReadonlySet<LegacyCubeDecisionFamily> {
  const byMethod = new Map(table.methods.map((row) => [row.method, row]));
  const families = new Set<LegacyCubeDecisionFamily>();
  for (const call of calls) {
    const row = byMethod.get(call);
    if (row === undefined) {
      throw new InvalidInputError('Forge controller method families', `no translation for callback ${call}`);
    }
    for (const family of row.families) families.add(family);
  }
  return families;
}
