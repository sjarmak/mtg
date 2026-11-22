/**
 * The recorded-games family: every game the lab recorded, folded into one
 * evidence record per subject and matchup.
 *
 * The index is `data/gameplay/index.jsonl`, one row per recorded game, read
 * line by line through the scanner's io seam. Each line is parsed against the
 * writer's own schema (`../src/routes/replay/gameplay-record.ts`), and a line
 * that fails it is a refusal labeled by line number rather than a crash: an
 * index written by an older recorder is a real state on a machine that has
 * been playing for a while, and the snapshot has to say which row it could not
 * read rather than lose the file.
 *
 * The join key comes from the row's set identity. A printed format or the
 * Legacy Cube states `formatId`, which is the key as written; a kernel set
 * states `setCode` alone, which is the key for a set. A row stating neither is
 * about nothing the page can select and is refused by name. The matchup is the
 * two seats' deck names with their kinds, sorted so a rematch with the seats
 * swapped lands in the same row.
 */
import { LEGACY_CUBE_FORMAT } from '../src/routes/legacy-cube/model';
import type { EvidenceRecord, EvidenceSubject } from '../src/routes/analysis/evidence-record';
import { GAMEPLAY_RECORD_SCHEMA, GameplayIndexRowSchema } from '../src/routes/replay/gameplay-record';
import type { GameplayIndexRow } from '../src/routes/replay/gameplay-record';
import { issueSentence } from './ledger-families';

export interface RecordedGamesRead {
  readonly records: readonly EvidenceRecord[];
  readonly skipped: readonly { readonly path: string; readonly why: string }[];
}

interface MatchupTally {
  readonly subject: EvidenceSubject;
  readonly matchup: string;
  attempted: number;
  completed: number;
  latest: string;
}

/** The join key a row states, or null when it states none. */
export function subjectOfRow(row: GameplayIndexRow): EvidenceSubject | null {
  const { setCode, formatId } = row.set;
  if (formatId !== null) {
    if (formatId === LEGACY_CUBE_FORMAT) return { kind: 'cube', id: formatId, code: null };
    return { kind: 'format', id: formatId, code: setCode };
  }
  if (setCode !== null) return { kind: 'set', id: setCode, code: setCode };
  return null;
}

/** The two seats as one label, order-independent. */
export function matchupOfRow(row: GameplayIndexRow): string {
  const names = row.seats.map(
    (seat) => `${seat.deck.name === '' ? 'unnamed deck' : seat.deck.name} (${seat.kind})`,
  );
  return [...names].sort().join(' vs ');
}

function parseLine(line: string): { ok: true; row: GameplayIndexRow } | { ok: false; why: string } {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, why: 'is not JSON' };
  }
  const parsed = GameplayIndexRowSchema.safeParse(json);
  if (!parsed.success) return { ok: false, why: issueSentence(parsed.error) };
  return { ok: true, row: parsed.data };
}

function toRecord(path: string, tally: MatchupTally): EvidenceRecord {
  return {
    family: 'recorded-games',
    path,
    version: GAMEPLAY_RECORD_SCHEMA,
    subject: tally.subject,
    matchup: tally.matchup,
    produced: tally.latest,
    evidence: {
      strength: 'games',
      trials: { attempted: tally.attempted, completed: tally.completed },
      arms: null,
      source: 'gameplay-index',
      episode: null,
      status: null,
    },
  };
}

/**
 * Folds the index's lines into records. `path` is the repository-relative
 * label the records and refusals carry (`data/gameplay/index.jsonl`); a blank
 * line is not a row and is passed over without a refusal, since a trailing
 * newline is how the recorder ends the file.
 */
export async function readRecordedGames(
  path: string,
  lines: AsyncIterable<string>,
): Promise<RecordedGamesRead> {
  const tallies = new Map<string, MatchupTally>();
  const skipped: { path: string; why: string }[] = [];
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === '') continue;
    const parsed = parseLine(line);
    if (!parsed.ok) {
      skipped.push({ path: `${path}:${String(lineNumber)}`, why: parsed.why });
      continue;
    }
    const subject = subjectOfRow(parsed.row);
    if (subject === null) {
      skipped.push({
        path: `${path}:${String(lineNumber)}`,
        why: `record ${parsed.row.path} names neither a set code nor a format id`,
      });
      continue;
    }
    const matchup = matchupOfRow(parsed.row);
    const key = `${subject.id}\u0000${matchup}`;
    const tally = tallies.get(key) ?? { subject, matchup, attempted: 0, completed: 0, latest: parsed.row.at };
    tally.attempted += 1;
    if (parsed.row.result.winner !== null) tally.completed += 1;
    if (parsed.row.at > tally.latest) tally.latest = parsed.row.at;
    tallies.set(key, tally);
  }
  return { records: [...tallies.values()].map((tally) => toRecord(path, tally)), skipped };
}
