/**
 * Model-labeled card roles for one printed format, bound to the printings they describe.
 *
 * A role is a reading of a card's rules text (does it answer a threat, draw a
 * card, fix mana), not a power rating, so it sits beside ADR-0005's quality
 * ladder rather than on it: no source here claims to measure how good a card
 * is. The labels come from a model through `@mtg/llm` (see
 * `tools/printed-roles/`), and this file owns only the contract: complete
 * coverage of every catalog the format names, and refusal of any printing
 * whose source fingerprint no longer matches the one that was labeled.
 */
import { z } from 'zod';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { CARD_ROLES } from './model';
import type { CardRole, EvaluationCard } from './model';
import { createRng } from '../rng';
import { printedSourceFingerprint } from './printed';

const HexSha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const Roles = z
  .array(z.enum(CARD_ROLES))
  .refine((roles) => new Set(roles).size === roles.length, 'duplicate role')
  .refine(
    (roles) =>
      roles.every(
        (role, index) => index === 0 || CARD_ROLES.indexOf(roles[index - 1]!) < CARD_ROLES.indexOf(role),
      ),
    'roles must be in vocabulary order',
  );

export const PrintedCardRolesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-card-roles'),
  formatId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  source: z.strictObject({
    kind: z.literal('model-oracle-reading'),
    /** The model the provider reported, e.g. `claude-fable-5`. */
    model: z.string().trim().min(1),
    /** SHA-256 of the system prompt and the response schema the labels were asked under. */
    promptSha256: HexSha256,
    vocabulary: z.array(z.enum(CARD_ROLES)),
  }),
  catalogs: z.array(
    z.strictObject({
      code: z.string().regex(/^[A-Z0-9]+$/u),
      catalogSha256: HexSha256,
      cards: z.array(
        z.strictObject({
          physicalId: z.string().min(1),
          sourceFingerprint: z.number().int().nonnegative(),
          roles: Roles,
        }),
      ),
    }),
  ),
});
export type PrintedCardRoles = z.infer<typeof PrintedCardRolesSchema>;

/**
 * Parse a roles file and check it against the catalogs the format actually
 * loads. Every catalog must be covered card for card, and a printing whose
 * fingerprint moved is refused by name rather than silently keeping old roles.
 */
export function validatePrintedCardRoles(
  input: unknown,
  catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[],
): PrintedCardRoles {
  const roles = PrintedCardRolesSchema.parse(input);
  if (roles.catalogs.length !== catalogs.length)
    throw new Error(`Printed card roles for ${roles.formatId} do not cover exactly its catalogs`);
  for (const { code, catalog } of catalogs) {
    const labeled = roles.catalogs.find(
      (candidate) => candidate.code === code && candidate.catalogSha256 === catalog.contentSha256,
    );
    if (labeled === undefined) throw new Error(`Printed card roles do not match catalog ${code}`);
    const byId = new Map(labeled.cards.map((card) => [card.physicalId, card]));
    if (byId.size !== labeled.cards.length)
      throw new Error(`Printed card roles repeat a ${code} physical card id`);
    if (byId.size !== catalog.cards.length)
      throw new Error(`Printed card roles do not provide complete ${code} catalog coverage`);
    for (const card of catalog.cards) {
      const row = byId.get(card.physicalId);
      if (row === undefined)
        throw new Error(`Printed card roles do not provide complete ${code} catalog coverage`);
      if (row.sourceFingerprint !== printedSourceFingerprint(card))
        throw new Error(`Printed card roles are stale for ${card.correctedName}`);
    }
  }
  return roles;
}

/** The labeled roles for one printing; throws when the file does not hold it. */
export function printedCardRolesOf(
  roles: PrintedCardRoles,
  card: PrintedCardCatalogEntry,
): readonly CardRole[] {
  for (const catalog of roles.catalogs) {
    const row = catalog.cards.find((candidate) => candidate.physicalId === card.physicalId);
    if (row === undefined) continue;
    if (row.sourceFingerprint !== printedSourceFingerprint(card))
      throw new Error(`Printed card roles are stale for ${card.correctedName}`);
    return row.roles;
  }
  throw new Error(`No printed card roles for ${card.correctedName}`);
}

/**
 * A bot policy id that also names the roles file, so a saved draft never
 * replays under labels it was not picked with. `base` is the roleless policy
 * the roles are layered on (structural or ranked), which stays a valid,
 * separate policy: it is the control #21's paired protocol compares against.
 */
export function printedRolesPolicy(base: string, roles: PrintedCardRoles): string {
  return `${base}+roles/${String(createRng(JSON.stringify(roles)).state)}`;
}

/** Replace an evaluation's roles with the labeled ones; everything else is unchanged. */
export function withPrintedCardRoles(
  roles: PrintedCardRoles,
  card: PrintedCardCatalogEntry,
  evaluation: EvaluationCard,
): EvaluationCard {
  // Replacing is only exact while the base reading carries no roles of its own
  // (structural and ranked emit none); refuse rather than silently drop some.
  if (evaluation.roles.length > 0)
    throw new Error(`${card.correctedName} already carries roles; labeled roles would replace them`);
  return { ...evaluation, roles: [...printedCardRolesOf(roles, card)] };
}
