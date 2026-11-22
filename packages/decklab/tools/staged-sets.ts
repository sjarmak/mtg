/**
 * The sets a deck can be cut from, read off disk.
 *
 * Split out of `./deckbench.ts` when a second launcher needed the same list:
 * `./deck-library.ts` serves the deck API beside `npm run play` and offers the
 * same pools that `npm run deckbench` does. Two readings of the candidate list
 * would agree until the day one of them learned about a set the other did not,
 * and the picker's rows are the pools a build is held to.
 *
 * `libraryCandidates` — every set the lab's own picker offers, which is the
 * flagship, anything else generated, and the reduced M11 and M13 reference
 * builds. That list rather than the staged bundles, because the bundles are
 * written by the web process a launcher spawns, and reading them here would be a
 * race with it. Both read the same candidate list, so the codes agree.
 *
 * Every one of them is DSL cards, which is the whole point: a deck built from
 * one can be dealt a game, and a deck of real printings cannot.
 */
import { readSetDocument } from '../../ui/tools/resolve-set';
import { readSetCards } from '../../ui/tools/set-file';
import { libraryCandidates } from '../../ui/tools/set-candidates';
import type { PoolSet } from '../src/pool';

export interface StagedSets {
  readonly pools: readonly PoolSet[];
  /** Files that are there and do not work, said because somebody built them. */
  readonly refused: readonly string[];
}

/**
 * Every offerable set, read and validated, with the ones that are not there
 * skipped quietly.
 *
 * A candidate list names more places than any checkout has — that is what makes
 * it a search — so a missing file is the normal case and not a warning. A file
 * that is present and malformed is a different thing and does get said, because
 * somebody built it and it does not work.
 */
export function loadStagedSets(repoRoot: string): StagedSets {
  const pools: PoolSet[] = [];
  const refused: string[] = [];

  for (const candidate of libraryCandidates(repoRoot)) {
    const document = readSetDocument(candidate.path, candidate.what);
    if (!document.ok) {
      if (!/^no set at |^could not read /.test(document.message)) refused.push(document.message);
      continue;
    }
    let parsed: { readonly set?: { readonly code?: unknown; readonly name?: unknown } };
    try {
      parsed = JSON.parse(document.json) as typeof parsed;
    } catch {
      refused.push(`${candidate.path} is not JSON`);
      continue;
    }
    const code = parsed.set?.code;
    const name = parsed.set?.name;
    if (typeof code !== 'string' || typeof name !== 'string') {
      refused.push(`${candidate.path} names no set code, so a deck could not say where its cards came from`);
      continue;
    }
    // Two staged sets sharing a code would give the picker two rows meaning one
    // pool. First wins, in the candidate list's own ranking order.
    if (pools.some((pool) => pool.code === code)) continue;
    try {
      pools.push({ code, name, cards: readSetCards(candidate.path) });
    } catch (cause: unknown) {
      refused.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return { pools, refused };
}

/** The picker's rows: a set's identity and its size, never its cards. */
export function workbenchSetsOf(pools: readonly PoolSet[]): readonly {
  readonly code: string;
  readonly name: string;
  readonly cardCount: number;
}[] {
  return pools.map((pool) => ({ code: pool.code, name: pool.name, cardCount: pool.cards.length }));
}
