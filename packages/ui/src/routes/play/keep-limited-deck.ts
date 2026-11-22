/**
 * A finished Limited deck, written down as the document the deck library keeps.
 *
 * `mtg-j1rg`. The lab could build a deck out of a sealed pool or a draft and
 * keep neither: `./sealed-session.ts` records the *pool* so a session survives a
 * reload, deliberately one session rather than a list, and the finished 40 cards
 * had nowhere to go. `../deck/saved-decks.ts` is where a deck goes, and this
 * module is the translation into it.
 *
 * # Why the entries are not `savedEntries`
 *
 * The Constructed builder's derivation walks its pool, which lists every
 * playable card once, and asks the build how many copies it plays. A Limited
 * pool is the opposite shape: it is 72 dealt cards with duplicates in it, and
 * the build is a list of *positions* in that pool, because two copies of one
 * common are two separate things to click. Counting that by pool position
 * records three copies of a card as three one-ofs, which then reopens as a
 * three-card deck of the same card. So the copies are counted by card id here,
 * in the order the pool first offers each card, which is the same order
 * `savedEntries` writes and for the same reason: two builds of one list are one
 * list, so the document is the same whichever order the cards were clicked in.
 *
 * # Why the basics are written down rather than left null
 *
 * `null` in that document means *the builder never overrode the computed base*,
 * and reopening re-suggests one. A Limited deck's base is seventeen lands for a
 * 40-card deck and the surface that reopens it is the Constructed builder, whose
 * config is 60; re-suggesting there hands back a different deck under the name
 * of this one. The counted base is a fact about the deck that was built, so it
 * is recorded whether or not somebody adjusted it.
 */
import { COLORS } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import { savedDeckDocument } from '../deck/saved-decks';
import type { Keeper } from '../deck/deck-keeping';
import type {
  SavedDeck,
  SavedDeckBasic,
  SavedDeckEntry,
  SavedDeckSet,
  SavedDeckSource,
} from '../deck/saved-decks';
import { nameTaken } from '../deck/saved-decks';
import type { SealedBuild } from './sealed';

/** The two surfaces that cut a deck out of a dealt pool. */
export type LimitedSource = Exclude<SavedDeckSource, 'constructed'>;

/** The control's label, which is also the name a test presses it by. */
export const KEEP_DECK_LABEL = 'Keep this deck';

/** What each pool is called in the name a save proposes. */
const POOL_LABELS: Readonly<Record<LimitedSource, string>> = {
  sealed: 'Sealed deck',
  draft: 'Draft deck',
};

/**
 * The chosen cards, counted by id, in the order the pool first offers each.
 *
 * A chosen position the pool does not hold is skipped rather than thrown on: the
 * builder derives its own selection bar the same way, because a build and the
 * pool it indexes into are two values and only one of them is this function's.
 */
export function limitedEntries(build: SealedBuild): readonly SavedDeckEntry[] {
  const counts = new Map<string, SavedDeckEntry>();
  const order: string[] = [];
  for (const index of [...build.chosen].sort((left, right) => left - right)) {
    const card = build.pool[index];
    if (card === undefined) continue;
    const held = counts.get(card.id);
    if (held === undefined) {
      counts.set(card.id, { id: card.id, name: card.name, count: 1 });
      order.push(card.id);
      continue;
    }
    counts.set(card.id, { ...held, count: held.count + 1 });
  }
  return order.map((id) => {
    const entry = counts.get(id);
    if (entry === undefined) throw new Error(`the chosen cards lost ${id} between two passes`);
    return entry;
  });
}

/** The mana base as the document writes it: WUBRG order, colors with none dropped. */
export function limitedBasics(landsByColor: Readonly<Record<Color, number>>): readonly SavedDeckBasic[] {
  return COLORS.filter((color) => (landsByColor[color] ?? 0) > 0).map((color) => ({
    color,
    count: landsByColor[color] ?? 0,
  }));
}

/**
 * A name for a deck nobody has named, and a name nothing else has.
 *
 * The seed's own token rather than a count of the decks in the list: a pool is
 * reopened by `#/play?seed=…`, so the token is the one word that says which
 * pool this deck came out of, and a person looking at two sealed decks can tell
 * them apart without opening either. The prefix is dropped because it says
 * `lab/sealed` beside a name that already says Sealed.
 */
export function limitedDeckName(source: LimitedSource, seed: string, decks: readonly SavedDeck[]): string {
  const token = seed.split('/').at(-1) ?? seed;
  // A token that is already the word for this pool is dropped rather than
  // repeated: `ui/fixtures/sealed` and a hand-typed `#/play?seed=lab/sealed`
  // both proposed *Sealed deck sealed*, which the phone shot of this screen is
  // where anybody would have noticed it. Dropping it leaves the label alone and
  // the dedup below numbers the second one.
  const proposed =
    token.toLowerCase() === source ? POOL_LABELS[source] : `${POOL_LABELS[source]} ${token}`.trim();
  if (!nameTaken(decks, proposed, null)) return proposed;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${proposed} (${String(attempt)})`;
    if (!nameTaken(decks, candidate, null)) return candidate;
  }
}

export interface LimitedDeckFields {
  readonly id: string;
  readonly name: string;
  /** ISO 8601, passed in so a test is not a clock. */
  readonly savedAt: string;
  readonly build: SealedBuild;
  /** The basics the deck's mana base counted out: `ManualDeck.manaBase.landsByColor`. */
  readonly landsByColor: Readonly<Record<Color, number>>;
  readonly source: LimitedSource;
  /** Absent when the screen cannot name the set its pool was dealt from. */
  readonly set?: SavedDeckSet;
}

/** The document a Limited save writes. */
export function limitedSavedDeck(fields: LimitedDeckFields): SavedDeck {
  return savedDeckDocument({
    id: fields.id,
    name: fields.name,
    savedAt: fields.savedAt,
    entries: limitedEntries(fields.build),
    basics: limitedBasics(fields.landsByColor),
    source: fields.source,
    ...(fields.set === undefined ? {} : { set: fields.set }),
  });
}

/**
 * What the screen says when nothing took the deck.
 *
 * The Constructed panel's sentence for the same refusal is about a private
 * window alone, because that panel predates the deck library; here both stores
 * have to be named, since the machine keeping the decks is exactly what makes a
 * private window survivable.
 */
export const KEEP_REFUSED_NOTE =
  'Nothing kept this deck: this browser refused to store it and no deck library answered. ' +
  'It is still on screen and will not survive a reload.';

/**
 * What the screen says when something did. The name is the point of the sentence.
 *
 * One sentence, and the browser case is one clause longer rather than a
 * paragraph. This line is drawn above a frame that divides a fixed height
 * between two panes, and photographed on a 844x390 phone the full keeper
 * paragraph took two rows off the panes to say what the Decks tab says
 * permanently a press away (`../deck/SavedDecksPanel.ts` draws
 * `KEPT_BY_BROWSER_NOTE` there). The clause stays because a deck this browser
 * alone is holding is exactly the deck the sentence above it over-promises.
 */
export function keptDeckNote(name: string, keeper: Keeper): string {
  const where = keeper.kind === 'server' ? '' : ', in this browser only';
  return `Kept “${name}”. It is on the Decks tab${where}.`;
}
