/** Installed-runtime activation proof; expensive and opt-in outside release qualification. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { DeckRef, ObservedSession, SessionSpec } from '@mtg/engine';
import { parsePrintedFormat } from '@mtg/printed-card';
import { httpObservedBackend } from '../../src/net/backend-gateway';
import { preparePreconMatch } from '../../src/routes/printed/precon-match';
import { startBackendService } from '../../tools/backend-service';
import { loadPrintedAdmissionSource, parsePrintedFormatRegistry } from '../../tools/printed-format-registry';
import { samplePrintedLimitedDecks } from '../../tools/printed-limited-decks';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const admissionIt = process.env['MTG_REQUIRE_PRINTED_ADMISSIONS'] === '1' ? it : it.skip;

function deckRef(
  name: string,
  cards: readonly { readonly name: string; readonly setCode?: string }[],
): DeckRef {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  return { name, cards: [...counts].map(([cardName, count]) => ({ name: cardName, count })) };
}

/**
 * The table each format kind seats: a Limited format deals two sealed pools and
 * builds a deck from each, a constructed format hands two of its own decks
 * across the table under the rules it states (a Commander precon brings its
 * general and its forty life). Either way the table is the one a player opens.
 */
async function admittedTable(
  admission: NonNullable<ReturnType<typeof loadPrintedAdmissionSource>>,
  index: number,
): Promise<SessionSpec> {
  const format = parsePrintedFormat(admission.format);
  const formatId = format.id;
  if (format.kind === 'printed-constructed-format') {
    const [human, opponent] = format.decks;
    if (human === undefined)
      throw new Error(`${formatId}: a constructed format needs a deck to seat a table`);
    return preparePreconMatch(
      format,
      { human, opponent: opponent ?? human },
      { seed: `${formatId}/installed-admission/v3`, humanSeat: 0 },
    );
  }
  const prepared = await preparePrintedLimitedFormat(admission.format, admission.catalogs, async (body) =>
    createHash('sha256').update(body).digest('hex'),
  );
  const [human, bot] = samplePrintedLimitedDecks(prepared, 'sealed', 73 + index);
  return {
    content: { kind: 'printed', format: formatId },
    seats: [
      { name: 'You', controller: 'local', deck: deckRef(`${formatId} sealed seat 1`, human.cards) },
      { name: 'Forge bot', controller: 'engine', deck: deckRef(`${formatId} sealed seat 2`, bot.cards) },
    ],
    seed: `${formatId}/installed-admission/v3`,
    maximumTurns: null,
  };
}

/**
 * One open, three moves and a close per registered format, measured at about
 * 25 s each on a loaded host (load 15 to 25). The budget grows with the registry
 * so that onboarding a format cannot be what times the gateway test out; a fixed
 * 480 s did exactly that at the twentieth format.
 */
const PER_FORMAT_BUDGET_MS = 45_000;
const FIXED_BUDGET_MS = 120_000;
const registeredFormats = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8')) as {
    formats: readonly unknown[];
  }
).formats.length;

/**
 * Every registered format with installed admission evidence, admitted together
 * through one backend service, each opened as a real match on the one gateway.
 * The registry is the subject: a format registered as supported that cannot be
 * admitted or opened fails here rather than in a browser.
 */
admissionIt(
  'opens an installed admitted match on every registered printed format through one gateway',
  async () => {
    const registryBody = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/data/data/printed-formats-v1.json'), 'utf8'),
    ) as unknown;
    const admissions = parsePrintedFormatRegistry(REPO_ROOT, registryBody)
      .map(loadPrintedAdmissionSource)
      .filter((admission) => admission !== undefined);
    if (admissions.length === 0) throw new Error('No registered printed format has installed admission');
    const tables = await Promise.all(admissions.map(admittedTable));
    const service = await startBackendService({
      repoRoot: REPO_ROOT,
      port: 0,
      printedAdmissions: admissions,
    });
    try {
      for (const table of tables) {
        if (table.content.kind !== 'printed') throw new Error('Every admitted table is a printed one');
        expect(service.message).toContain(
          `Printed format ${table.content.format}: verified runtime admission loaded.`,
        );
      }
      const backend = httpObservedBackend({
        id: 'forge-2.0.14',
        baseUrl: `http://127.0.0.1:${String(service.gateway.port)}/engine-api`,
      });
      for (const table of tables) {
        if (table.content.kind !== 'printed') throw new Error('Every admitted table is a printed one');
        const formatId = table.content.format;
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(`${formatId}: ${JSON.stringify(opened.error)}`);
        let session: ObservedSession = opened.session;
        expect(session.backend).toBe('forge-2.0.14');
        expect(session.table.content).toEqual({ kind: 'printed', format: formatId });
        let submitted = 0;
        while (session.status === 'awaiting' && submitted < 3) {
          const move = session.decision?.options[0]?.id;
          if (move === undefined) break;
          const result = await session.submit(move);
          if (!result.ok) throw new Error(`${formatId}: ${JSON.stringify(result.error)}`);
          session = result.session;
          submitted += 1;
        }
        expect(submitted).toBeGreaterThan(0);
        await session.close();
      }
    } finally {
      await service.close();
    }
  },
  FIXED_BUDGET_MS + PER_FORMAT_BUDGET_MS * registeredFormats,
);
