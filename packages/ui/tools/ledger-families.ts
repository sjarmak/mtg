/**
 * Readers for the ledger families whose evidence is one metadata file: parsed
 * JSON in, an evidence record or a named refusal out, and no file system.
 *
 * Each schema reads only what its record carries and stays a loose object, so
 * a field the producing tool adds later passes through. What each artifact is
 * and where it is read from is stated per reader; the campaign families whose
 * evidence spans a directory (plan, comparison, trials) live in
 * `./stage-strength-family.ts`, the recorded-games index in
 * `./recorded-games-family.ts`, and the walk that hands paths to all of them
 * in `./scan-ledgers.ts`.
 *
 * A refusal names the first zod issue by path, which is the line a person
 * opens the file at. Nothing here throws on a bad artifact: a ledger somebody
 * left half-written is a fact about that ledger, and `npm run play` has to
 * stage the other forty.
 */
import { z } from 'zod';
import { LEGACY_CUBE_FORMAT } from '../src/routes/legacy-cube/model';
import type { EvidenceRecord, EvidenceSubject } from '../src/routes/analysis/evidence-record';

export type FamilyRead =
  | { readonly kind: 'records'; readonly records: readonly EvidenceRecord[] }
  | { readonly kind: 'skip'; readonly path: string; readonly why: string };

/** What every reader is handed beside the parsed JSON. */
export interface ReadContext {
  /** Repository-relative label, e.g. `out/legacy-cube-bot-campaign-20260910`. */
  readonly path: string;
  /** The metadata file's modification time as ISO, or null when the io could not stat it. */
  readonly modified: string | null;
}

/** The first issue's path and message, in the words a person would grep for. */
export function issueSentence(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'did not match the schema';
  const where = issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  return `${issue.message}${where}`;
}

export function skip(path: string, why: string): FamilyRead {
  return { kind: 'skip', path, why };
}

/** The join key, typed by what it names. */
export function subjectFor(id: string, code: string | null): EvidenceSubject {
  if (id === LEGACY_CUBE_FORMAT) return { kind: 'cube', id, code: null };
  return { kind: 'format', id, code };
}

const CampaignReportSchema = z.object({
  version: z.literal('legacy-cube-bot-calibration/v1'),
  options: z.object({
    seed: z.string().min(1),
    split: z.string().min(1),
    pods: z.number().int().nonnegative(),
    gamesPerOrder: z.number().int().nonnegative(),
    opponents: z.number().int().nonnegative(),
    policies: z.array(z.string().min(1)),
  }),
  games: z.array(z.object({ outcome: z.string().min(1), eligible: z.boolean() })),
});

const DECIDED_OUTCOMES: ReadonlySet<string> = new Set(['win', 'loss', 'draw']);

/**
 * `out/legacy-cube-bot-<run>-<stamp>/report.json`: the Legacy Cube bot
 * calibration campaign, every game of which was played, so this is games
 * evidence. A game finished when its outcome is a decided result; anything
 * else (a timeout, an engine failure) was attempted and is counted as such.
 */
export function readCampaignReport(context: ReadContext, json: unknown): FamilyRead {
  const parsed = CampaignReportSchema.safeParse(json);
  if (!parsed.success) return skip(context.path, `report.json ${issueSentence(parsed.error)}`);
  const { options, games } = parsed.data;
  return {
    kind: 'records',
    records: [
      {
        family: 'legacy-cube-bot-calibration',
        path: context.path,
        version: parsed.data.version,
        subject: subjectFor(LEGACY_CUBE_FORMAT, null),
        matchup: `${options.policies.join(', ')} against ${String(options.opponents)} built opponent deck(s)`,
        produced: context.modified,
        evidence: {
          strength: 'games',
          trials: {
            attempted: games.length,
            completed: games.filter((game) => DECIDED_OUTCOMES.has(game.outcome)).length,
          },
          arms: null,
          source: 'report',
          episode: null,
          status: `${options.split} split, seed ${options.seed}`,
        },
      },
    ],
  };
}

const ObservedSweepSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-observed-sweep'),
  qualification: z.string().min(1),
  formatId: z.string().min(1),
  catalogs: z.array(z.object({ code: z.string().min(1) })),
  mode: z.string().min(1),
  sessions: z.array(z.object({ status: z.string().min(1) })),
});

/**
 * `out/validation-pilot/<format>-observed-sweep-<run>/report.json`: Forge
 * sessions over a printed format, observed rather than reproduced. Games
 * evidence with no arms, carrying the report's own qualification word so a
 * sweep that qualified nothing says so in its status column.
 */
export function readObservedSweep(context: ReadContext, json: unknown): FamilyRead {
  const parsed = ObservedSweepSchema.safeParse(json);
  if (!parsed.success) return skip(context.path, `report.json ${issueSentence(parsed.error)}`);
  const report = parsed.data;
  const codes = report.catalogs.map((catalog) => catalog.code);
  return {
    kind: 'records',
    records: [
      {
        family: 'printed-observed-sweep',
        path: context.path,
        version: `${report.kind}/${String(report.schemaVersion)}`,
        subject: subjectFor(report.formatId, codes.length === 0 ? null : codes.join('+')),
        matchup: `${report.mode} sessions, sampled deck against sampled deck`,
        produced: context.modified,
        evidence: {
          strength: 'games',
          trials: {
            attempted: report.sessions.length,
            completed: report.sessions.filter((session) => session.status === 'finished').length,
          },
          arms: null,
          source: 'report',
          episode: null,
          status: report.qualification,
        },
      },
    ],
  };
}

const QualityCollectionSchema = z.object({
  version: z.literal('legacy-cube-quality-collection/v1'),
  quality: z.object({
    version: z.string().min(1),
    status: z.string().min(1),
    origin: z.string().min(1),
    independentHumanEvidence: z.boolean(),
    adoptionEligible: z.boolean(),
  }),
});

/**
 * `out/legacy-cube-live-quality-<run>/collected/report.json`: a model's
 * paired quality reviews of Legacy Cube drafts, gated. Judgment evidence: the
 * gate's own `origin` and its two booleans are what a reader needs to know
 * before trusting it, and its status word rides in the matchup so the table
 * says what the gate decided.
 */
export function readQualityCollection(context: ReadContext, json: unknown): FamilyRead {
  const parsed = QualityCollectionSchema.safeParse(json);
  if (!parsed.success) return skip(context.path, `collected/report.json ${issueSentence(parsed.error)}`);
  const { quality } = parsed.data;
  return {
    kind: 'records',
    records: [
      {
        family: 'legacy-cube-quality',
        path: context.path,
        version: parsed.data.version,
        subject: subjectFor(LEGACY_CUBE_FORMAT, null),
        matchup: `candidate against current advisor, gate ${quality.status}`,
        produced: context.modified,
        evidence: {
          strength: 'judgment',
          origin: quality.origin,
          independentHumanEvidence: quality.independentHumanEvidence,
          adoptionEligible: quality.adoptionEligible,
        },
      },
    ],
  };
}

const DeckReviewManifestSchema = z.object({
  version: z.literal('legacy-cube-deck-sample/v1'),
  origin: z.string().min(1),
  split: z.string().min(1),
  policy: z.string().min(1),
  builderVersion: z.string().min(1),
});

/**
 * `out/legacy-cube-deck-review-pilot-<run>/manifest.json`: one sampled deck
 * sent to a model for review. Judgment evidence whose manifest states its
 * origin and nothing about human evidence or adoption, so both are null and the
 * panel prints them as not stated rather than as false.
 */
export function readDeckReviewManifest(context: ReadContext, json: unknown): FamilyRead {
  const parsed = DeckReviewManifestSchema.safeParse(json);
  if (!parsed.success) return skip(context.path, `manifest.json ${issueSentence(parsed.error)}`);
  const manifest = parsed.data;
  return {
    kind: 'records',
    records: [
      {
        family: 'legacy-cube-deck-review',
        path: context.path,
        version: manifest.version,
        subject: subjectFor(LEGACY_CUBE_FORMAT, null),
        matchup: `${manifest.policy} deck by ${manifest.builderVersion}, ${manifest.split} split`,
        produced: context.modified,
        evidence: {
          strength: 'judgment',
          origin: manifest.origin,
          independentHumanEvidence: null,
          adoptionEligible: null,
        },
      },
    ],
  };
}
