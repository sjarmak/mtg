/**
 * The page's half of `/deck-api`, and every answer it will accept.
 *
 * Six routes: the staged sets a pool can be cut from, the judgment on a draft,
 * the build that starts a job, the job's state, the shelf, and one variation in
 * full. The server is `@mtg/decklab`'s `workbench/server.ts` and
 * `npm run deckbench` starts it; Vite proxies the prefix, so the page always
 * talks to its own origin.
 *
 * The same server also keeps the deck library, and that half is in
 * `../deck-keeping.ts` rather than here: those three routes are read and written
 * by the Decks tab whether or not a workbench is on screen, and the store they
 * mirror is `../saved-decks.ts`. What they share is the transport below, which
 * is exported for them.
 *
 * # Why the shapes are declared here rather than imported
 *
 * `@mtg/decklab` reaches `@mtg/data` and therefore `better-sqlite3`. Nothing in
 * that graph can be bundled into a browser, which is the reason the deck server
 * exists at all. So these schemas are written out, the way `../../design/
 * client.ts` and `../../../curate/client.ts` write out theirs, and for the
 * stronger of the same two reasons: this document crossed a network, so it is
 * checked on arrival regardless of where its type came from. A field the server
 * renames fails at `safeParse` with a sentence rather than at a property access
 * with `undefined`.
 *
 * # Why a missing server is a state and not an error
 *
 * A person can open this tab with no server running: the sets they can see are
 * the sets the lab already staged, and the tab says what it cannot do rather
 * than throwing. So every call here resolves to a value that includes "could not
 * reach it", the screen draws that as a sentence naming the command that starts
 * one, and nothing throws.
 *
 * # And why "cannot build" is a third state, not a failure
 *
 * The server answers 404 for `POST /deck-api/build` when it was started without
 * a spend ceiling. That is not the server being broken and not the page being
 * wrong: it is the deliberate arrangement that stops a button from spending
 * money nobody authorized. So it comes back as `unarmed` with the server's own
 * sentence, and the screen draws a disabled button beside the command that arms
 * it.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';
import { isHelperAbsent } from '../../../net/helper-absent';

/** Mirrors `WorkbenchSet` in `@mtg/decklab`'s `workbench/server.ts`. */
export const WorkbenchSetSchema = z.object({
  code: z.string(),
  name: z.string(),
  cardCount: z.number(),
});

export type WorkbenchSet = z.infer<typeof WorkbenchSetSchema>;

/**
 * The pools, and whether this server can build at all.
 *
 * `builds` defaults to true rather than being required, because an older server
 * that does not send it is a server that was started the ordinary way, and
 * refusing to draw the form over a missing boolean would be worse than the
 * optimism. A server that cannot build says so, and one build attempt against a
 * server that lied costs a 404 and no money.
 */
const SetsSchema = z.object({
  sets: z.array(WorkbenchSetSchema),
  builds: z.boolean().default(true),
});

/** One refusal, addressed to the field that earned it. */
const IssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  pointer: z.string(),
  message: z.string(),
});

export type Issue = z.infer<typeof IssueSchema>;

const ValidationSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), issues: z.array(IssueSchema) }),
]);

/** Mirrors `WorkbenchCriteriaSchema`. The form's own draft is looser than this. */
export const CriteriaSchema = z.object({
  prompt: z.string().min(1),
  sets: z.array(z.string().min(1)).min(1),
  colors: z.array(z.enum(COLORS)),
  size: z.number(),
  landCount: z.number().optional(),
  maxCopies: z.number(),
  archetype: z.string().optional(),
  themes: z.array(z.string()),
  maxManaValue: z.number().optional(),
  powerBand: z.string().optional(),
  opponentPopulation: z
    .object({
      id: z.string(),
      members: z.array(z.object({ id: z.string(), share: z.number(), strategy: z.string() })),
    })
    .optional(),
});

export type Criteria = z.infer<typeof CriteriaSchema>;

const EntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number(),
  manaCost: z.string().nullable(),
  manaValue: z.number(),
  typeLine: z.string(),
  criteria: z.array(z.string()),
  reason: z.string(),
});

export type VariationEntry = z.infer<typeof EntrySchema>;

const BasicSchema = z.object({ color: z.enum(COLORS), count: z.number(), id: z.string() });

const ManaBaseSchema = z.object({
  totalLands: z.number(),
  nonBasicLands: z.number(),
  castabilityTarget: z.number(),
  heavyCastabilityTarget: z.number(),
  colors: z.array(
    z.object({
      color: z.enum(COLORS),
      pipCount: z.number(),
      sources: z.number(),
      sourceFloor: z.number(),
      castability: z.number(),
      meetsTarget: z.boolean(),
    }),
  ),
  landReason: z.string(),
  landSource: z.enum(['stated', 'model']),
});

const ConstructionSchema = z.object({
  format: z.object({
    id: z.literal('decklab-constructed-format/v1'),
    source: z.union([
      z.object({ kind: z.literal('format'), format: z.string() }),
      z.object({ kind: z.literal('sets'), sets: z.array(z.string()) }),
    ]),
    deckSize: z.number(),
    landCount: z.number(),
    spellCount: z.number(),
    copyLimit: z.number(),
    opponentPopulation: z
      .object({
        id: z.string(),
        members: z.array(z.object({ id: z.string(), share: z.number(), strategy: z.string() })),
      })
      .nullable(),
  }),
  selection: z.object({
    id: z.literal('decklab-model-repair/v1'),
    provider: z.string(),
    model: z.string(),
    fallbackId: z.literal('decklab-verified-partial/v1'),
  }),
});

export const VariationSchema = z.object({
  version: z.number(),
  id: z.string(),
  name: z.string(),
  builtAt: z.string(),
  parentId: z.string().nullable(),
  criteria: CriteriaSchema,
  statedCriteria: z.array(
    z.object({ id: z.string(), kind: z.enum(['structural', 'semantic']), statement: z.string() }),
  ),
  plan: z.string(),
  spells: z.array(EntrySchema),
  lands: z.array(EntrySchema),
  basics: z.array(BasicSchema),
  manaBase: ManaBaseSchema,
  universeSize: z.number(),
  shortfalls: z.array(z.string()),
  construction: ConstructionSchema.optional(),
  /**
   * What the build cost, and the ceiling it ran under. Optional, because every
   * variation written before `mtg-yp33.7` has none; the view then says nothing
   * about the cost rather than drawing a figure nobody was charged.
   */
  build: z.object({ rounds: z.number(), spentUsd: z.number(), maxSpendUsd: z.number() }).optional(),
});

export type Variation = z.infer<typeof VariationSchema>;
export type VariationBasic = z.infer<typeof BasicSchema>;

const SummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  builtAt: z.string(),
  parentId: z.string().nullable(),
  prompt: z.string(),
  sets: z.array(z.string()),
  /**
   * What the deck casts, in WUBRG order, off its mana base rather than off the
   * criteria. Defaulted so a shelf written by an older server still reads: the
   * page then draws no colors rather than claiming colorless.
   */
  colors: z.array(z.string()).default([]),
  totalCards: z.number(),
  shortfallCount: z.number(),
  /**
   * What the build cost and how many rounds it took, or `null` on a variation
   * written before either was kept. Defaulted the way `colors` is, so a shelf
   * from an older server still reads: the row then says nothing about the cost
   * rather than drawing a $0.00 nobody was charged.
   */
  spentUsd: z.number().nullable().default(null),
  rounds: z.number().nullable().default(null),
});

export type VariationSummary = z.infer<typeof SummarySchema>;

const ShelfSchema = z.object({
  variations: z.array(SummarySchema),
  unreadable: z.array(z.object({ file: z.string(), reason: z.string() })),
});

export type Shelf = z.infer<typeof ShelfSchema>;

const JobSchema = z.object({
  id: z.string(),
  state: z.enum(['running', 'done', 'failed']),
  name: z.string(),
  startedAt: z.string(),
  variation: VariationSchema.optional(),
  error: z.string().optional(),
});

export type Job = z.infer<typeof JobSchema>;

const RefusalSchema = z.object({ refused: z.string() });

/**
 * Every call's answer, in one shape.
 *
 * `unreachable` is the server not being there and is drawn as a sentence.
 * `unarmed` is the server being there and deliberately unable to build, which is
 * a different sentence and a different button state. `refused` is the server
 * declining this particular request, which is usually the person's to fix.
 */
export type Answer<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'unarmed'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

export const DECK_API = '/deck-api';

/** What to say when nothing answers. Names the command rather than the port. */
export const NO_SERVER_NOTE =
  'The deck workbench needs its server. Start it with `npm run deckbench -- --max-usd 7`; ' +
  'the sets and any variations already built stay readable without it.';

/**
 * One request, one answer, and no throw. Exported because the deck library's
 * half of this API (`../deck-keeping.ts`) is the same server on the same prefix,
 * and reaching it needed exactly this: the unreachable-Vite-proxy reading below
 * was measured rather than guessed, and a second copy of it would be a second
 * chance to get it wrong.
 */
export async function deckApiCall<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { readonly method: string; readonly body?: unknown },
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(`${DECK_API}${path}`, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
  } catch (cause: unknown) {
    return { kind: 'unreachable', message: `${NO_SERVER_NOTE} (${String(cause)})` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // Vite's proxy with nothing behind it answers `500 text/plain` with an empty
    // body — measured against a running lab, not assumed. That is the same
    // situation as a refused connection and reads better said the same way, so
    // the parse is attempted before the status is looked at: a body that is not
    // JSON means nothing answered, whatever status came with it.
    return { kind: 'unreachable', message: NO_SERVER_NOTE };
  }
  if (isHelperAbsent(payload)) return { kind: 'unreachable', message: NO_SERVER_NOTE };

  if (!response.ok) {
    const refusal = RefusalSchema.safeParse(payload);
    const message = refusal.success
      ? refusal.data.refused
      : `the deck server answered ${String(response.status)}`;
    // 404 on the build route is the spend-ceiling arrangement, not a missing
    // server: the server answered, and what it said is the reason.
    if (response.status === 404 && message.includes('--max-usd')) return { kind: 'unarmed', message };
    return { kind: 'refused', message };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      kind: 'refused',
      message: `the deck server sent something this page cannot read: ${parsed.error.message}`,
    };
  }
  return { kind: 'ok', value: parsed.data };
}

export function fetchSets(): Promise<
  Answer<{ readonly sets: readonly WorkbenchSet[]; readonly builds: boolean }>
> {
  return deckApiCall('/sets', SetsSchema);
}

export function validateCriteria(draft: unknown): Promise<Answer<z.infer<typeof ValidationSchema>>> {
  return deckApiCall('/criteria/validate', ValidationSchema, { method: 'POST', body: draft });
}

export function startBuild(request: {
  readonly criteria: unknown;
  readonly name: string;
  readonly parentId: string | null;
}): Promise<Answer<Job>> {
  return deckApiCall('/build', JobSchema, { method: 'POST', body: request });
}

export function fetchJob(id: string): Promise<Answer<Job>> {
  return deckApiCall(`/build/${encodeURIComponent(id)}`, JobSchema);
}

export function fetchShelf(): Promise<Answer<Shelf>> {
  return deckApiCall('/variations', ShelfSchema);
}

export function fetchVariation(id: string): Promise<Answer<Variation>> {
  return deckApiCall(`/variations/${encodeURIComponent(id)}`, VariationSchema);
}

export function deleteVariation(id: string): Promise<Answer<{ readonly deleted: string }>> {
  return deckApiCall(`/variations/${encodeURIComponent(id)}`, z.object({ deleted: z.string() }), {
    method: 'DELETE',
  });
}
