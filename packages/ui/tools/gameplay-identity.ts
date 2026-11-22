/**
 * Which set a recorded game was played from, decided by its card ids.
 *
 * A record under `data/gameplay/` names its set so an analysis can group games
 * by the set they were played with, and a kernel game carries no set of its
 * own: its decks are card lists, and a card knows only the code it was printed
 * under. So the recorder (`./gameplay-recorder.ts`) is built over every set the
 * launcher staged, each reduced here to what identity needs, and a game's ids
 * are matched against them the way an art manifest is matched to a set in
 * `./stage-art.ts`: the set covering the most ids wins, and zero coverage is
 * another set's game rather than a weak match. Every id then has to resolve
 * inside the winner, because a deck built from two sets is not a deck this lab
 * deals, and a browser claiming one is refused by the first id that fails.
 *
 * The basics are part of the set for this purpose. `@mtg/deckbuild` mints them
 * at build time under `<code>-swamp` ids that no card list prints, so a set is
 * identified by `setBasics` over its cards, the same closure `./set-surfaces.ts`
 * paints from.
 */
import { createHash } from 'node:crypto';
import { setBasics } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { cardsOf, setCodeOf } from './set-surfaces';
import type { LibraryEntry } from './stage-set-bundles';

/** One staged set, reduced to what identifying a game needs. */
export interface SetIdentitySource {
  readonly code: string;
  /** sha256 of the set document as staged, so two builds under one code stay apart. */
  readonly sha256: string;
  /** Every printed card plus the five basics the set is played with. */
  readonly cards: readonly Card[];
}

export type CardIdentity =
  | {
      readonly ok: true;
      readonly setCode: string;
      readonly setSha256: string;
      /** sha256 over the sorted distinct ids, so the same pool hashes alike whatever the deck order. */
      readonly cardsSha256: string;
      readonly cardById: ReadonlyMap<string, Card>;
    }
  | { readonly ok: false; readonly message: string };

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The launcher's library, each entry reduced to an identity source. */
export function setIdentitySources(entries: readonly LibraryEntry[]): readonly SetIdentitySource[] {
  return entries.map((entry) => {
    const printed = cardsOf(entry.set);
    const printedIds = new Set(printed.map((card) => card.id));
    const basics = setBasics(printed).filter((card) => !printedIds.has(card.id));
    return {
      code: setCodeOf(entry.set) ?? entry.set.what,
      sha256: sha256Of(entry.set.json),
      cards: [...printed, ...basics],
    };
  });
}

function cardsSha256Of(ids: readonly string[]): string {
  return sha256Of([...new Set(ids)].sort().join('\n'));
}

/**
 * The one set every id resolves in, or the refusal naming the first id that
 * does not. Coverage decides between sets and the first entry wins a tie,
 * which is the launcher's own ranking of its library.
 */
export function identifyCards(ids: readonly string[], sets: readonly SetIdentitySource[]): CardIdentity {
  let best: {
    readonly set: SetIdentitySource;
    readonly byId: Map<string, Card>;
    readonly covered: number;
  } | null = null;
  for (const set of sets) {
    const byId = new Map(set.cards.map((card) => [card.id, card] as const));
    const covered = ids.filter((id) => byId.has(id)).length;
    if (covered > 0 && (best === null || covered > best.covered)) best = { set, byId, covered };
  }
  if (best === null) {
    const first = ids[0];
    return {
      ok: false,
      message:
        first === undefined
          ? 'the game names no cards'
          : `no staged set prints ${JSON.stringify(first)}${sets.length === 0 ? ' (no sets were staged)' : ''}`,
    };
  }
  const unresolved = ids.find((id) => !best.byId.has(id));
  if (unresolved !== undefined) {
    return {
      ok: false,
      message: `set ${best.set.code} covers most of the game's cards but does not print ${JSON.stringify(unresolved)}`,
    };
  }
  return {
    ok: true,
    setCode: best.set.code,
    setSha256: best.set.sha256,
    cardsSha256: cardsSha256Of(ids),
    cardById: best.byId,
  };
}
