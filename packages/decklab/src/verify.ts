/**
 * The gate between what the model proposed and what the deck may contain.
 *
 * A proposal is a card name, a count, and a cited criterion. None of those can
 * be trusted: the name may be a card that does not exist, or exists but is
 * banned in the format; the count may exceed the four-copy rule; the cited
 * criterion may be one the user never stated. Each is checked against the
 * universe and the stated criteria, and every rejection carries a reason
 * specific enough to hand back to the model as feedback for the next attempt.
 *
 * Rejections are data, not errors. A model that proposes forty cards and gets
 * three wrong should produce a deck of thirty-seven plus three named problems,
 * not an exception.
 */
import type { CandidateCard, CandidateUniverse } from './candidates';
import { isLandCard, normalizeName } from './candidates';
import type { DeckCriteria, ResolvedCriteria } from './criteria';
import { criterionIds } from './criteria';

/** One line of what the model asked for. */
export interface Proposal {
  readonly name: string;
  readonly count: number;
  /** Criterion ids this inclusion claims to serve. */
  readonly criteria: readonly string[];
  /** The model's stated reason, in its own words. */
  readonly reason: string;
}

export type RejectionCode =
  | 'unknown-card'
  | 'not-in-universe'
  | 'unstated-criterion'
  | 'no-criterion'
  | 'duplicate'
  | 'over-deck-budget'
  | 'basic-land'
  | 'over-land-slot';

export interface Rejection {
  readonly name: string;
  readonly code: RejectionCode;
  /** Feedback phrased for the model, naming the fix. */
  readonly detail: string;
}

export type AdjustmentCode = 'copies-trimmed';

/**
 * A proposal that was kept and changed, rather than refused.
 *
 * A separate channel from `Rejection` because the two say opposite things to
 * the reader of the next prompt: a rejection means *replace this card* and an
 * adjustment means *this card is in the deck, at a different number*. Folding
 * them together tells the model to find a replacement for a card it already
 * has, which is a round spent to arrive back where it started.
 */
export interface Adjustment {
  readonly name: string;
  readonly code: AdjustmentCode;
  /** What was changed and why, phrased for the model and for the report. */
  readonly detail: string;
}

/** A proposal that survived every check, bound to its store row. */
export interface Inclusion {
  readonly card: CandidateCard;
  readonly count: number;
  readonly criteria: readonly string[];
  readonly reason: string;
}

export interface VerifyResult {
  readonly inclusions: readonly Inclusion[];
  readonly rejections: readonly Rejection[];
  /** Proposals kept with a changed count. Empty from the whole-deck passes. */
  readonly adjustments: readonly Adjustment[];
}

/**
 * A card whose name is not in the universe fails for one of two different
 * reasons, and the model needs to be told which: it does not exist in the store
 * at all (a hallucination), or it exists but the criteria exclude it (a real
 * card that is illegal, off-color, or over budget here).
 */
export interface UniverseLookup {
  /** Every real card name in the store, normalized. Used to tell the two apart. */
  readonly knownNames: ReadonlySet<string>;
  /**
   * What to call the world a name can fail to be in, for the rejection message.
   *
   * Over the store it is the store, and "not a card in the store" is the right
   * sentence. Over a staged set it is that set, where the same sentence is both
   * wrong and unhelpful — the card is not in the store either way, and what the
   * model needs to hear is that it must choose from the pool it was given.
   */
  readonly worldName?: string;
}

export function verifyProposals(
  proposals: readonly Proposal[],
  universe: CandidateUniverse,
  criteria: DeckCriteria,
  lookup: UniverseLookup,
): VerifyResult {
  const allowed = criterionIds(criteria);
  const inclusions: Inclusion[] = [];
  const rejections: Rejection[] = [];
  const adjustments: Adjustment[] = [];
  const seen = new Set<string>();

  for (const proposal of proposals) {
    const key = normalizeName(proposal.name);

    if (seen.has(key)) {
      rejections.push({
        name: proposal.name,
        code: 'duplicate',
        detail: `${proposal.name} was listed twice; combine it into a single entry with the total count`,
      });
      continue;
    }

    const card = universe.byName.get(key);
    if (card === undefined) {
      // Basics are held out of the universe on purpose, so without this they
      // come back as "a real card that does not satisfy the criteria", which
      // is true but tells the model to find a legal replacement rather than to
      // stop choosing basics at all.
      if (BASIC_LAND_NAMES.has(key)) {
        rejections.push({
          name: proposal.name,
          code: 'basic-land',
          detail: `${proposal.name} is a basic land; the basics are computed from the pip demand of your other picks, so name only nonbasic lands`,
        });
        continue;
      }
      const known = lookup.knownNames.has(key);
      rejections.push({
        name: proposal.name,
        code: known ? 'not-in-universe' : 'unknown-card',
        detail: known
          ? `${proposal.name} is a real card but does not satisfy the stated criteria (format legality, color identity, mana value, or budget)`
          : `${proposal.name} is not a card in ${lookup.worldName ?? 'the store'}; choose only cards from the pool you were given`,
      });
      continue;
    }

    if (proposal.criteria.length === 0) {
      rejections.push({
        name: proposal.name,
        code: 'no-criterion',
        detail: `${proposal.name} cited no criterion; every inclusion must name at least one`,
      });
      continue;
    }

    const unstated = proposal.criteria.filter((id) => !allowed.has(id));
    if (unstated.length > 0) {
      rejections.push({
        name: proposal.name,
        code: 'unstated-criterion',
        detail: `${proposal.name} cited ${unstated.join(', ')}, which the user never stated; cite only from: ${[...allowed].join(', ')}`,
      });
      continue;
    }

    // Trimmed rather than refused. The count is the cheap half of a proposal
    // and the card is the expensive one — the model already did the judging —
    // so a number over the limit costs a number, not the card. Refusing it cost
    // The playtester's Vessari-v1 57 of 60 cards to a limit the prompt never stated
    // (`mtg-yp33.6`): the three that survived were the three the model happened to
    // propose as one-ofs. The limit is still enforced exactly; what changed is
    // that enforcing it no longer throws away the answer with it.
    const limit = copyLimit(card, criteria);
    const count = Math.min(proposal.count, limit);
    if (count < proposal.count) {
      adjustments.push({
        name: proposal.name,
        code: 'copies-trimmed',
        detail: `${proposal.name} asked for ${proposal.count} copies and is in the deck as ${count}; the limit here is ${limit}`,
      });
    }

    seen.add(key);
    inclusions.push({
      card,
      count,
      criteria: proposal.criteria,
      reason: proposal.reason,
    });
  }

  return { inclusions, rejections, adjustments };
}

/**
 * The deck-wide copy limit, with no card in hand.
 *
 * `copyLimit` is this plus the one card-level exception, and the prompt needs
 * the deck-level half: a rule the answer is checked against has to be stated in
 * the question, and it can only be stated before any card is named. One
 * function so the sentence in the prompt and the check on the answer cannot
 * drift apart.
 */
export function statedCopyLimit(criteria: DeckCriteria): number {
  if (criteria.format !== undefined && SINGLETON_FORMATS.has(criteria.format)) return 1;
  return criteria.maxCopies;
}

/**
 * Four copies, unless the card says otherwise or the format does. Cards reading
 * "A deck can have any number of cards named ..." are unbounded; singleton
 * formats cap everything at one.
 *
 * A deck built over a staged set states no format, so no format caps it: the
 * limit is whatever `maxCopies` says, which is where a singleton set-backed
 * deck states itself. Absent is not "commander".
 */
export function copyLimit(card: CandidateCard, criteria: DeckCriteria): number {
  const text = card.oracleText ?? '';
  if (text.includes('any number of cards named')) return criteria.size;
  return statedCopyLimit(criteria);
}

const SINGLETON_FORMATS: ReadonlySet<string> = new Set(['commander', 'brawl', 'oathbreaker', 'duel']);

/**
 * The basic land names, normalized. A fixed list of six printed names, not a
 * scan of the type line: `normalizeName` already strips the snow-covered
 * prefix's punctuation, so both spellings land here.
 */
const BASIC_LAND_NAMES: ReadonlySet<string> = new Set(
  ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'].flatMap((name) => [
    normalizeName(name),
    normalizeName(`Snow-Covered ${name}`),
  ]),
);

/**
 * Enforces the deck-wide budget against the **whole accumulated deck**.
 *
 * This is deliberately not part of `verifyProposals`. A deck budget is a
 * property of the entire list, and the selection loop verifies one round of
 * proposals at a time; checking it there compares each round against the full
 * budget in isolation, so three rounds of $19 proposals all pass a $20 budget
 * and the finished deck costs $57. That is not hypothetical — it shipped a
 * $27.91 deck against a $20 budget and reported it as compliant.
 *
 * The most expensive entries are cut until the total fits. Cheapest-first would
 * strip the deck of everything except the one card that busted the budget.
 */
export function enforceDeckBudget(inclusions: readonly Inclusion[], criteria: DeckCriteria): VerifyResult {
  const max = criteria.budget?.maxDeckUsd;
  if (max === undefined) return { inclusions, rejections: [], adjustments: [] };

  const total = deckPrice(inclusions);
  if (total <= max) return { inclusions, rejections: [], adjustments: [] };

  const byCost = [...inclusions].sort(
    (a, b) => (b.card.priceUsd ?? 0) * b.count - (a.card.priceUsd ?? 0) * a.count,
  );
  const rejections: Rejection[] = [];
  const cut = new Set<string>();
  let running = total;

  for (const entry of byCost) {
    if (running <= max) break;
    const cost = (entry.card.priceUsd ?? 0) * entry.count;
    if (cost === 0) continue;
    running -= cost;
    cut.add(entry.card.oracleId);
    rejections.push({
      name: entry.card.name,
      code: 'over-deck-budget',
      detail: `the deck totals $${total.toFixed(2)} against a $${max} budget; ${entry.count}x ${entry.card.name} at $${cost.toFixed(2)} is among the most expensive inclusions — replace it with something cheaper`,
    });
  }

  return {
    inclusions: inclusions.filter((entry) => !cut.has(entry.card.oracleId)),
    rejections,
    adjustments: [],
  };
}

/** Total USD of a verified list, at the cheapest printing of each card. */
export function deckPrice(inclusions: readonly Inclusion[]): number {
  return inclusions.reduce((sum, entry) => sum + (entry.card.priceUsd ?? 0) * entry.count, 0);
}

/**
 * Enforces the land slot against the **whole accumulated deck**.
 *
 * Nonbasic lands come out of `criteria.landCount`, so a model that names more
 * of them than the deck has land slots leaves no room for basics and pushes the
 * deck over its size. Like the budget, this is a property of the finished list
 * rather than of one round, and like the budget it is fed back by name so the
 * next round can fix it instead of the deck shipping mis-sized.
 *
 * The last-named lands are the ones cut. Cutting by price would drop the
 * expensive duals that were the point of asking; cutting from the end keeps the
 * model's own ordering, which is the closest thing to its own priority.
 */
export function enforceLandSlot(inclusions: readonly Inclusion[], criteria: ResolvedCriteria): VerifyResult {
  const total = landCount(inclusions);
  if (total <= criteria.landCount) return { inclusions, rejections: [], adjustments: [] };

  const rejections: Rejection[] = [];
  const cut = new Set<string>();
  let running = total;

  for (const entry of [...inclusions].reverse()) {
    if (running <= criteria.landCount) break;
    if (!isLandCard(entry.card)) continue;
    running -= entry.count;
    cut.add(entry.card.oracleId);
    rejections.push({
      name: entry.card.name,
      code: 'over-land-slot',
      detail: `the deck names ${total} nonbasic lands against a ${criteria.landCount}-land slot; ${entry.count}x ${entry.card.name} does not fit, so cut it or cut another land`,
    });
  }

  return {
    inclusions: inclusions.filter((entry) => !cut.has(entry.card.oracleId)),
    rejections,
    adjustments: [],
  };
}

/** Cards counted with multiplicity. */
export function cardCount(inclusions: readonly Inclusion[]): number {
  return inclusions.reduce((sum, entry) => sum + entry.count, 0);
}

/** Land cards counted with multiplicity. Basics never reach a verified list. */
export function landCount(inclusions: readonly Inclusion[]): number {
  return cardCount(inclusions.filter((entry) => isLandCard(entry.card)));
}

/** Non-land cards counted with multiplicity: what the spell target measures. */
export function spellCount(inclusions: readonly Inclusion[]): number {
  return cardCount(inclusions.filter((entry) => !isLandCard(entry.card)));
}
