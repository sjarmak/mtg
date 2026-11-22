/**
 * The page's half of `/design-api`, and every answer it will accept.
 *
 * `mtg-yddw.2`. Four routes: the vocabulary the editor offers, the validation
 * that judges a draft, the free skeleton plan, and the fixture replay. The
 * server is `@mtg/setgen`'s `design/server.ts` and `npm run design` starts it;
 * Vite proxies the prefix, so the page always talks to its own origin.
 *
 * # Why the shapes are declared here rather than imported
 *
 * `@mtg/setgen`'s brief schema reaches `@mtg/design-data`, which reads its canon
 * off disk at module scope. Nothing in that graph can be bundled into a browser,
 * which is the reason the design server exists at all. So these schemas are
 * written out, the way `../../curate/client.ts` writes out the four causes it
 * cannot import, and for the stronger of the same two reasons: this document
 * crossed a network, so it is checked on arrival regardless of where its type
 * came from. A field the server renames fails at `safeParse` with a sentence
 * rather than at a property access with `undefined`.
 *
 * # Why a missing server is a state and not an error
 *
 * A person can write an entire brief with no server running: the draft is the
 * page's own, the JSON is on screen, and the file downloads. What they lose is
 * the judgment. So every call here resolves to a value that includes "could not
 * reach it", the editor draws that as a sentence naming the command that starts
 * one, and nothing throws.
 */
import { z } from 'zod';
import { isHelperAbsent } from '../../net/helper-absent';

const SizeBoundsSchema = z.object({ min: z.number(), max: z.number(), default: z.number() });
const MechanicBoundsSchema = z.object({ min: z.number(), max: z.number() });

/** Mirrors `DesignVocabulary` in `@mtg/setgen`'s `design/vocabulary.ts`. */
export const VocabularySchema = z.object({
  keywords: z.array(z.string()),
  effectKinds: z.array(z.string()),
  abilityKinds: z.array(z.string()),
  triggerConditions: z.array(z.string()),
  colors: z.array(z.string()),
  requiredPools: z.array(z.string()),
  rarities: z.array(z.string()),
  sliceRarities: z.array(z.string()),
  cardKinds: z.array(z.string()),
  counterKinds: z.array(z.string()),
  spellRoles: z.array(z.string()),
  colorPieSubjects: z.array(z.string()),
  targetSize: SizeBoundsSchema,
  mechanics: MechanicBoundsSchema,
  setCodePattern: z.string(),
  subtypePattern: z.string(),
});

export type Vocabulary = z.infer<typeof VocabularySchema>;

/** One refusal, addressed to the field that earned it. */
const IssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  pointer: z.string(),
  message: z.string(),
});

export type BriefIssue = z.infer<typeof IssueSchema>;

const DerivationSchema = z.object({
  tertiaryBudget: z.number(),
  requiredCards: z.number(),
  authoredCards: z.number(),
  mechanics: z.number(),
});

export type BriefDerivation = z.infer<typeof DerivationSchema>;

/**
 * The validation answer.
 *
 * The parsed brief comes back too and is deliberately not modeled: the page
 * never reads it. What it reads is whether the draft passed, the issues if it
 * did not, and the derived numbers, which are why a *valid* draft still shows a
 * panel — `tertiaryBudget` is defaulted from the set size, and a blank field
 * cannot say what the run will use.
 */
const ValidationSchema = z.union([
  z.object({ ok: z.literal(true), derived: DerivationSchema }),
  z.object({ ok: z.literal(false), issues: z.array(IssueSchema) }),
]);

const SkeletonPoolCensusSchema = z.object({
  pool: z.string(),
  byRarity: z.record(z.string(), z.number()),
  total: z.number(),
});

const CurvePointSchema = z.object({ manaValue: z.number(), slots: z.number() });

const SeatedCardSchema = z.object({
  name: z.string(),
  slotId: z.string(),
  pool: z.string(),
  rarity: z.string(),
  cardKind: z.string(),
  role: z.string(),
  manaValueMin: z.number(),
  manaValueMax: z.number(),
});

const MechanicReachSchema = z.object({ name: z.string(), slots: z.number(), commonSlots: z.number() });

export const SkeletonPlanSchema = z.object({
  setCode: z.string(),
  setName: z.string(),
  targetSize: z.number(),
  slots: z.number(),
  pools: z.array(SkeletonPoolCensusSchema),
  curve: z.array(CurvePointSchema),
  mechanics: z.array(MechanicReachSchema),
  seated: z.array(SeatedCardSchema),
  unseated: z.array(z.string()),
  pinNotes: z.array(z.string()),
  notes: z.array(z.string()),
});

export type SkeletonPlan = z.infer<typeof SkeletonPlanSchema>;
export type SkeletonPoolCensus = z.infer<typeof SkeletonPoolCensusSchema>;
export type CurvePoint = z.infer<typeof CurvePointSchema>;
export type SeatedCard = z.infer<typeof SeatedCardSchema>;
export type MechanicReach = z.infer<typeof MechanicReachSchema>;

/**
 * The plan answer, which has three arms rather than two.
 *
 * A draft that does not parse comes back as `invalid`, carrying the same issues
 * the validate route returns; a draft that parses but cannot be allocated comes
 * back as a `reason`. They are different failures and the panel says different
 * sentences: the first is a field to fix, the second is a brief whose own
 * demands do not fit the set it asked for.
 */
const PlanAnswerSchema = z.union([
  z.object({ ok: z.literal(true), plan: SkeletonPlanSchema }),
  z.object({ ok: z.literal(false), invalid: z.array(IssueSchema) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

/**
 * The report is passed through unread.
 *
 * `GenerationReport` is `@mtg/setgen`'s own document, and the run panel shows
 * the two facts it can state without knowing that shape: whether every slot
 * printed a card that passes every deterministic gate, and how many cards came
 * back. Modeling the report here would be a copy of a type the page does not
 * read.
 */
const RunAnswerSchema = z.union([
  z.object({ ok: z.literal(true), enforceable: z.boolean(), cards: z.array(z.unknown()) }),
  z.object({ ok: z.literal(false), reason: z.string(), unrecorded: z.boolean() }),
  z.object({ ok: z.literal(false), invalid: z.array(IssueSchema) }),
]);

/** Anything a call can end as, including not happening. */
export interface Unreachable {
  readonly kind: 'unreachable';
  readonly reason: string;
}

export type VocabularyAnswer = { readonly kind: 'vocabulary'; readonly vocabulary: Vocabulary } | Unreachable;

export type ValidationAnswer =
  | { readonly kind: 'valid'; readonly derived: BriefDerivation }
  | { readonly kind: 'invalid'; readonly issues: readonly BriefIssue[] }
  | Unreachable;

export type PlanAnswer =
  | { readonly kind: 'plan'; readonly plan: SkeletonPlan }
  | { readonly kind: 'invalid'; readonly issues: readonly BriefIssue[] }
  | { readonly kind: 'refused'; readonly reason: string }
  | Unreachable;

export type RunAnswer =
  | { readonly kind: 'generated'; readonly enforceable: boolean; readonly cards: number }
  | { readonly kind: 'invalid'; readonly issues: readonly BriefIssue[] }
  | { readonly kind: 'refused'; readonly reason: string; readonly unrecorded: boolean }
  | Unreachable;

/** The command that starts the server the editor is missing, named in one place. */
export const DESIGN_SERVER_COMMAND = 'npm run design';

export const NO_DESIGN_SERVER =
  'This lab is running without the design server, so a brief cannot be checked or run here';

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function unreachable(reason: string): Unreachable {
  return { kind: 'unreachable', reason };
}

interface Answered {
  readonly status: number;
  readonly value: unknown;
}

async function read(path: string, init?: RequestInit): Promise<Answered | Unreachable> {
  let response: Response;
  try {
    response = init === undefined ? await fetch(path) : await fetch(path, init);
  } catch (cause: unknown) {
    return unreachable(`could not reach the design server (${describe(cause)})`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return unreachable(NO_DESIGN_SERVER);
  }
  return isHelperAbsent(value) ? unreachable(NO_DESIGN_SERVER) : { status: response.status, value };
}

function post(path: string, payload: unknown): Promise<Answered | Unreachable> {
  return read(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function unrecognized(route: string, status: number): Unreachable {
  return unreachable(`${route} answered ${String(status)} with a body this page does not recognize`);
}

/** The closed lists the editor offers. Fetched once; the page holds the answer. */
export async function fetchVocabulary(): Promise<VocabularyAnswer> {
  const answer = await read('/design-api/vocabulary');
  if ('kind' in answer) return answer;
  const parsed = VocabularySchema.safeParse(answer.value);
  return parsed.success
    ? { kind: 'vocabulary', vocabulary: parsed.data }
    : unrecognized('the vocabulary route', answer.status);
}

/** Judges a draft. Every issue comes back keyed to the field that earned it. */
export async function validateDraft(draft: unknown): Promise<ValidationAnswer> {
  const answer = await post('/design-api/brief/validate', draft);
  if ('kind' in answer) return answer;
  const parsed = ValidationSchema.safeParse(answer.value);
  if (!parsed.success) return unrecognized('the validate route', answer.status);
  return parsed.data.ok
    ? { kind: 'valid', derived: parsed.data.derived }
    : { kind: 'invalid', issues: parsed.data.issues };
}

/** Allocates the brief and censuses the skeleton. Spends nothing. */
export async function planDraft(draft: unknown): Promise<PlanAnswer> {
  const answer = await post('/design-api/brief/plan', draft);
  if ('kind' in answer) return answer;
  const parsed = PlanAnswerSchema.safeParse(answer.value);
  if (!parsed.success) return unrecognized('the plan route', answer.status);
  if (parsed.data.ok) return { kind: 'plan', plan: parsed.data.plan };
  return 'invalid' in parsed.data
    ? { kind: 'invalid', issues: parsed.data.invalid }
    : { kind: 'refused', reason: parsed.data.reason };
}

/**
 * Runs the brief against recorded fixtures.
 *
 * There is no paid arm of this call and none can be reached from the page: the
 * server is started with a fixture runner or with none at all, and one started
 * with none answers 404 here. A fixture this checkout has not recorded comes
 * back as `unrecorded`, which is the single case that names the recording
 * command, and that command is run at a terminal, by a person, with a budget.
 */
export async function runDraft(draft: unknown): Promise<RunAnswer> {
  const answer = await post('/design-api/run', draft);
  if ('kind' in answer) return answer;
  if (answer.status === 404) {
    return unreachable('this design server was started for editing only, so it runs nothing');
  }
  const parsed = RunAnswerSchema.safeParse(answer.value);
  if (!parsed.success) return unrecognized('the run route', answer.status);
  if (parsed.data.ok) {
    return { kind: 'generated', enforceable: parsed.data.enforceable, cards: parsed.data.cards.length };
  }
  return 'invalid' in parsed.data
    ? { kind: 'invalid', issues: parsed.data.invalid }
    : { kind: 'refused', reason: parsed.data.reason, unrecorded: parsed.data.unrecorded };
}
