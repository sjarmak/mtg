/**
 * The lab's record of every choice the computer made for a player because the
 * Forge bridge has no reviewed screen for it yet, and the review queue read back
 * from that record (#66).
 *
 * In Commander and Momir Basic the lab opens Forge sessions that let Forge's AI
 * answer such a choice instead of ending the game. The bridge says so in the
 * game log as an `Unreviewed choice` event; this module appends each one, once,
 * to `data/unreviewed-choices/choices.jsonl` with the table it happened at, so
 * the choices outlive the game and can be replayed from their seed. The queue
 * groups them in #66's working order: the bounce lands, then a player choosing
 * from a zone they own for another seat's effect, then everything else card by
 * card.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { rulesOf } from '@mtg/engine';
import type { EngineEvent, ObservedBackend, ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
import { resolveDataDir } from './data-path';
import { appendDurably } from './durable-write';

/** The bridge's event type for a choice the computer made for the seat. */
export const UNREVIEWED_CHOICE_EVENT = 'Unreviewed choice';

/** `<repo>/data/unreviewed-choices/choices.jsonl`, refusing anything `resolveDataDir` refuses. */
export function unreviewedChoiceLogPath(repoRoot: string): string {
  return join(resolveDataDir(join(repoRoot, 'data', 'unreviewed-choices'), repoRoot), 'choices.jsonl');
}

const BridgeDetail = z.object({
  kind: z.literal('unreviewed-choice'),
  method: z.string(),
  source: z.string(),
  api: z.string().nullable(),
  params: z.string().nullable(),
  trigger: z.boolean(),
  seatsOwnEffect: z.boolean().nullable(),
  seat: z.number().int(),
  turn: z.number().int(),
  refusal: z.string(),
  answer: z.string(),
});

const UnreviewedChoiceRow = BridgeDetail.omit({ kind: true }).extend({
  at: z.string(),
  game: z.string(),
  format: z.string(),
  variant: z.string(),
  seed: z.string().nullable(),
  decks: z.array(z.string()),
  seq: z.number().int().nonnegative(),
  text: z.string(),
});
export type UnreviewedChoiceRow = z.infer<typeof UnreviewedChoiceRow>;

function deckName(table: SessionSpec, index: 0 | 1): string {
  const seat = table.seats[index];
  const commanders = (seat.deck.commanders ?? []).map((slot) => slot.name);
  return commanders.length > 0 ? commanders.join(' & ') : seat.name;
}

/**
 * Every game opened through `backend` appends its new `Unreviewed choice` events to `logPath`.
 *
 * A snapshot carries the whole log, so a session remembers the last sequence it wrote and
 * appends only what came after it. A row the log cannot hold is reported on `report` and the
 * game goes on: losing a review note is not a reason to end somebody's game.
 */
export function recordUnreviewedChoices(
  backend: ObservedBackend,
  logPath: string,
  report: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  now: () => Date = () => new Date(),
): ObservedBackend {
  const write = (table: SessionSpec, game: string, events: readonly EngineEvent[], after: number): number => {
    let last = after;
    for (const event of events) {
      if (event.seq <= after || event.type !== UNREVIEWED_CHOICE_EVENT) continue;
      last = Math.max(last, event.seq);
      const detail = BridgeDetail.safeParse(event.detail);
      if (!detail.success) {
        report(`unreviewed choice ${event.seq} has an unexpected detail: ${detail.error.message}`);
        continue;
      }
      const { kind: _kind, ...fields } = detail.data;
      const row: UnreviewedChoiceRow = {
        at: now().toISOString(),
        game,
        format: table.content.kind === 'printed' ? table.content.format : table.content.kind,
        variant: rulesOf(table).variant,
        seed: table.seed,
        decks: [deckName(table, 0), deckName(table, 1)],
        seq: event.seq,
        text: event.text,
        ...fields,
      };
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        appendDurably(logPath, `${JSON.stringify(row)}\n`);
      } catch (cause) {
        report(`could not log unreviewed choice: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    return last;
  };
  const wrap = (
    table: SessionSpec,
    game: string,
    session: ObservedSession,
    after: number,
  ): ObservedSession => {
    const written = write(table, game, session.events, after);
    return {
      ...session,
      submit: async (move): Promise<SubmitResult<ObservedSession>> => {
        const submitted = await session.submit(move);
        return submitted.ok
          ? { ok: true, session: wrap(table, game, submitted.session, written) }
          : submitted;
      },
    };
  };
  return {
    ...backend,
    open: async (table) => {
      const opened = await backend.open(table);
      return opened.ok ? { ok: true, session: wrap(table, randomUUID(), opened.session, -1) } : opened;
    },
  };
}

export function readUnreviewedChoices(logPath: string): readonly UnreviewedChoiceRow[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const parsed = UnreviewedChoiceRow.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`${logPath}:${index + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
}

/** #66's working order. */
export const REVIEW_FAMILIES = [
  { id: 'bounce-land', title: 'Return a land you control to hand as a land enters (the bounce lands)' },
  {
    id: 'own-zone',
    title:
      "A player chooses a card from a zone they own: a discard, or a choice made for another seat's effect",
  },
  { id: 'one-card', title: 'The rest, one card at a time' },
] as const;
export type ReviewFamily = (typeof REVIEW_FAMILIES)[number]['id'];

export function familyOf(row: UnreviewedChoiceRow): ReviewFamily {
  const params = row.params ?? '';
  if (
    row.trigger &&
    params.includes('Origin=Battlefield') &&
    params.includes('Destination=Hand') &&
    /ChangeType=Land\b/u.test(params)
  )
    return 'bounce-land';
  // #66 groups every discard from hand here with the choices made for another seat's effect.
  if (row.seatsOwnEffect === false || row.method === 'chooseCardsToDiscardFrom') return 'own-zone';
  return 'one-card';
}

export interface ReviewQueueEntry {
  readonly source: string;
  readonly methods: readonly string[];
  readonly count: number;
  readonly games: number;
  /** The first time it was logged, with what it takes to replay it. */
  readonly first: UnreviewedChoiceRow;
}

export interface ReviewQueue {
  readonly total: number;
  readonly games: number;
  readonly families: readonly {
    readonly id: ReviewFamily;
    readonly title: string;
    readonly count: number;
    readonly entries: readonly ReviewQueueEntry[];
  }[];
}

/** The screens to review next: #66's families in order, each card most-logged first. */
export function reviewQueue(rows: readonly UnreviewedChoiceRow[]): ReviewQueue {
  const families = REVIEW_FAMILIES.map((family) => {
    const bySource = new Map<string, UnreviewedChoiceRow[]>();
    for (const row of rows) {
      if (familyOf(row) !== family.id) continue;
      bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);
    }
    const entries = [...bySource.entries()]
      .map(([source, logged]): ReviewQueueEntry => ({
        source,
        methods: [...new Set(logged.map((row) => row.method))].sort(),
        count: logged.length,
        games: new Set(logged.map((row) => row.game)).size,
        first: logged[0]!,
      }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
    return { ...family, count: entries.reduce((sum, entry) => sum + entry.count, 0), entries };
  });
  return { total: rows.length, games: new Set(rows.map((row) => row.game)).size, families };
}

export function formatReviewQueue(queue: ReviewQueue, logPath: string): string {
  if (queue.total === 0) return `No unreviewed choices logged yet (${logPath}).\n`;
  const lines = [
    `${queue.total} unreviewed choices across ${queue.games} games (${logPath})`,
    'Each is a screen to review; work them top to bottom.',
    '',
  ];
  queue.families.forEach((family, index) => {
    lines.push(`${index + 1}. ${family.title}: ${family.count}`);
    if (family.entries.length === 0) lines.push('   none logged');
    for (const entry of family.entries) {
      const first = entry.first;
      lines.push(
        `   ${entry.source}: ${entry.count} in ${entry.games} ${entry.games === 1 ? 'game' : 'games'} (${entry.methods.join(', ')})`,
        `      first: ${first.format} seed ${first.seed ?? '(none)'}, ${first.decks.join(' vs ')}, turn ${first.turn}; the computer chose ${first.answer}`,
      );
    }
    lines.push('');
  });
  return lines.join('\n');
}
