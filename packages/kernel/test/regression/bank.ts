/**
 * The permanent regression-fixture bank (ADR-0001 §10.7(c), `mtg-zc2o`).
 *
 * ADR-0001 §10.7 names three things that would reopen §10.6.2's refusal of
 * mass-generated coverage, and (c) is "permanent regression fixtures derived
 * from real observed divergences, on the pkmn/engine model of 109 such fixtures
 * rather than XMage's seven harvested ones". This directory is that bank. The
 * rule it exists to enforce is one sentence: **a rules defect found anywhere
 * becomes a scenario the suite replays forever.**
 *
 * The reason it is worth a named place rather than one more test beside its
 * neighbors is measured, in the composition-risk study's §3.1 and §3.2.
 * Of the `fix` commits touching `packages/kernel/src`, 13 are rules defects —
 * and **not one of the 13 was found by the test suite.** They came from live
 * play, from a bead filed off a played board, from reading the code, and once
 * from an engine/Forge divergence noticed without a harness. A suite that has
 * never caught a rules defect is not evidence that the rules are right, and the
 * standing answer to that is a bank whose entries are exactly the defects
 * something outside the suite already caught.
 *
 * **What an entry is.** Two halves that are deliberately separate files' worth
 * of concern. `LANDED_RULES_DEFECTS` below is the *ledger*: one record per
 * defect, carrying the commit it landed in, the rule it broke, what the pre-fix
 * code did (read off that commit's own diff), and where it was found. The
 * replays under `replays/` are the *scenarios*: each one names a property of
 * today's kernel that the pre-fix kernel did not have. `bank.test.ts` joins
 * them and fails when a ledger record has no replay and no stated reason for
 * not having one.
 *
 * **Why the ledger carries `preFix` in prose.** A scenario has to fail on the
 * pre-fix behavior to be worth anything, and this tree cannot check out a
 * pre-fix kernel to prove it — five other lanes share the working tree. So the
 * fail direction is recorded rather than demonstrated: the sentence says what
 * the code did before, sourced from the fix commit's diff, and it is the thing
 * to reproduce by hand when a reader wants to watch the entry go red. Each
 * replay's `property` is phrased as the assertion so a red run names the rule.
 *
 * **What this bank is not.** It is not a second copy of the kernel suite. Every
 * entry here also has fuller coverage in the mechanic-organized file it was
 * fixed alongside (`legend-rule.test.ts`, `token-death.test.ts`,
 * `autopass.test.ts`, and the rest), and those files are where a new case about
 * that mechanic belongs. What only this directory holds is the *provenance
 * index*: the list of defects that reached `main`, what found each one, and a
 * standing replay of each that survives whatever reorganization happens to the
 * file it was born in.
 */

/**
 * Where a defect was found, which is the measurement `mtg-zc2o` exists over.
 *
 * `testSuite` is in the union although nothing in the seed 13 carries it. That
 * is the point: the bank has to be able to say "the suite caught this one"
 * about a future entry, or the claim that none of the first 13 was caught that
 * way is a claim about a vocabulary rather than about the tree.
 */
export type Provenance = 'livePlay' | 'playedBoard' | 'codeReview' | 'forgeExport' | 'testSuite';

/**
 * Whether the defect needed more than one object or subsystem present at once.
 *
 * The composition-risk study's §3.1 classification, carried here so the bank can be
 * read against the question that produced it rather than re-derived from the
 * prose. `interaction` means the defect cannot be produced by one object or one
 * rule alone; `singlePath` means it reproduces on a one-object board.
 */
export type Composition = 'interaction' | 'singlePath';

export interface DefectRecord {
  /** The commit the fix landed in. `git show <commit>` is the whole source. */
  readonly commit: string;
  /** The commit subject, so a reader can find it without running git. */
  readonly subject: string;
  /** The rule the defect broke, cited so a red run names it. */
  readonly rule: string;
  /** One line: what the game did wrong. */
  readonly defect: string;
  /** What the pre-fix code did, read off the fix commit's own diff. */
  readonly preFix: string;
  readonly provenance: Provenance;
  readonly composition: Composition;
  /** The bead, where one is named; several of these predate bead discipline. */
  readonly bead: string | null;
}

/**
 * The rules defects that have landed on `main`, newest first.
 *
 * Re-derived for `mtg-zc2o` from `git log --format='%h|%s' -- packages/kernel/src`
 * filtered to `fix` commits, with each candidate's diff and body read.
 * The composition-risk study's §3.1 measured 26 such commits and classified 13 as
 * rules defects; the same command now returns 27, because `32504b5` landed
 * after that document was written. `32504b5` is not a rules defect under §3.1's
 * own rule — it refuses a session record whose move ids the neutral contract
 * cannot spell, which is plumbing at the contract seam and not a rule of Magic
 * executing wrongly — so the rules-defect list is unchanged at 13.
 */
export const LANDED_RULES_DEFECTS: readonly DefectRecord[] = [
  {
    commit: '81ac4f6',
    subject: 'a projected move points at what it targets, not only at itself',
    rule: 'engine contract: MoveOption.targets is what a move points at',
    defect:
      'two casts of one removal spell at two identically named creatures reached the engine contract carrying identical targets, so no surface could tell them apart',
    preFix:
      '`objectsIn` returned `[action.oid]` for castSpell and activateAbility and `[]` for chooseTriggerTargets, so the projected targets named the spell and never the thing it was aimed at',
    provenance: 'playedBoard',
    composition: 'interaction',
    bead: 'mtg-899w',
  },
  {
    commit: '9e8d268',
    subject: 'enumerate damage assignment orders that differ',
    rule: 'CR 509.2',
    defect:
      'a gang block by interchangeable creatures offered one option per spelling of the order instead of one per decision, so the rail printed entries that read identically',
    preFix:
      '`orderDecision` enumerated `permutations(block.blockers, cap)`, every permutation of the blocking creatures, with no notion of two blockers being one slot',
    provenance: 'playedBoard',
    composition: 'interaction',
    bead: 'mtg-2aca',
  },
  {
    commit: 'a8656b5',
    subject: 'take a decision with one legal option instead of asking',
    rule: 'a decision with one legal option is not a place anyone is asked to act',
    defect:
      'two attacking fliers over a board that could not reach them stopped the game and made the defender declare "no blocks" by hand',
    preFix:
      'the predicate was `autoPassChoice` and it returned null for every decision whose `kind` was not `priority`, so a forced blocker declaration was never taken',
    provenance: 'playedBoard',
    composition: 'singlePath',
    bead: 'mtg-y1t.3',
  },
  {
    commit: 'eb42643',
    subject: 'auto-tapping spends the lands the rest of the hand needs least',
    rule: 'CR 106.1 / auto-tap: a payment may not strand a color the hand can spend',
    defect:
      'a generic pip ate the only Forest while a green one-drop sat in the same hand, so paying one cost made the next cast impossible',
    preFix:
      '`planPayment` built its plan from the pool and the untapped sources alone; there was no reserve, and the hand was not read at all',
    provenance: 'playedBoard',
    composition: 'interaction',
    bead: 'mtg-3xo',
  },
  {
    commit: 'f17d6d5',
    subject: 'a stop does not fire where the player can only pass',
    rule: 'a stop offers a player their plays; a priority with no plays has none to offer',
    defect:
      'a step named by the stop set asked the player to press "let it resolve" at windows whose entire content was the pass and a land',
    preFix:
      'the stop set was consulted through `isStopped` alone; `canRespond` already existed and already gated the stack rule, and the stop side was not gated on it',
    provenance: 'livePlay',
    composition: 'singlePath',
    bead: 'mtg-hmy',
  },
  {
    commit: '1bced2d',
    subject: 'a spell you can only watch is not a spell you are asked about',
    rule: 'CR 605.1 (a mana ability is not an answer), applied to the opposing-stack rule',
    defect:
      'every spell the other seat cast handed the game back, whatever the player could do about it, so one untapped land bought a prompt whose only content was the pass',
    preFix:
      'the opposing-stack rule was `opposingStack(state, player).size > 0` unqualified, with no `canRespond` beside it',
    provenance: 'livePlay',
    composition: 'singlePath',
    bead: null,
  },
  {
    commit: 'd1c57f6',
    subject: 'the legend rule asks its controller, and stops until it answers',
    rule: 'CR 704.5j',
    defect:
      'the state-based action picked which duplicate legend survived, on a fixed tiebreak over entry order, so the wrong copy died in silence',
    preFix:
      'the sweep buried the losers itself and raised no question; there was no `legendRule` value in `awaiting`, no `keepLegend` action, and no `legendRule` decision',
    provenance: 'codeReview',
    composition: 'interaction',
    bead: null,
  },
  {
    commit: 'ec93a00',
    subject: 'a stop set that skips the priorities it does not name',
    rule: 'the stop set is authoritative: a priority no stop names is passed',
    defect:
      'unticking every step but the two main phases skipped nothing, and a yield to the next turn handed the game back in the upkeep',
    preFix:
      'stops could only add a question. The only mechanism that removed one fired where the kernel enumerated a single option, and one untapped land puts a mana ability in every enumeration, so from the first land on the set was inert',
    provenance: 'livePlay',
    composition: 'singlePath',
    bead: null,
  },
  {
    commit: 'bb0338d',
    subject: 'haste lifts what summoning sickness forbids, on the table and at the cost',
    rule: 'CR 702.10c',
    defect:
      'a creature cast with haste could attack the turn it arrived and could not pay a {T} activation cost, so the two halves of one keyword disagreed',
    preFix:
      '`activationBlocker` refused a `tapSelf` cost on any summoning-sick creature with no haste check at all, while `eligibleAttackers` had carried the equivalent CR 702.10b check from the start',
    provenance: 'codeReview',
    composition: 'interaction',
    bead: null,
  },
  {
    commit: '2856157',
    subject: 'a token is placed by the same two helpers that place everything else',
    rule: 'CR 604.3',
    defect:
      "a created token's printed static ability did not take effect, because the placement path never registered it",
    preFix:
      '`createToken` hand-spread `objects` and `battlefield` into the state instead of calling `putObject` and `addToZone`, and the token was already in the battlefield list when the CR 614 pass ran',
    provenance: 'codeReview',
    composition: 'interaction',
    bead: 'mtg-4vf',
  },
  {
    commit: '793fe7e',
    subject: "a token's arrival goes through the same path every arrival does",
    rule: 'CR 614.1 / CR 111.3',
    defect:
      'a token entered without the replacement pass, without registering statics and without announcing an arrival, so nothing could react to it',
    preFix:
      '`createToken` built its object and appended it to the battlefield itself, skipping everything `moveObject` does on entry: the CR 614 replacement pass, `registerStatics`, and `permanentEntered`',
    provenance: 'codeReview',
    composition: 'interaction',
    bead: null,
  },
  {
    commit: '6452a17',
    subject: 'a token that dies fires its death trigger',
    rule: 'CR 111.7 / CR 704.5d',
    defect:
      'a token printed with a death trigger was destroyed and nothing happened, so the kernel and the Forge export of the same card disagreed',
    preFix:
      '`moveObject` redirected any token leaving the battlefield to exile in a single line, so a token never emitted a `zoneChanged` into a graveyard and `conditionsFrom` never derived `selfDies` for one',
    provenance: 'forgeExport',
    composition: 'interaction',
    bead: null,
  },
  {
    commit: '0b2e140',
    subject: 'SBA draws: simultaneous losses produce a draw',
    rule: 'CR 104.4b',
    defect:
      'every player still in the game losing at the same instant scored player 0 the loser instead of a draw',
    preFix:
      '`endGame` took the first loss and handed the win to its opponent unconditionally; there was no test against the number of players still in the game',
    provenance: 'codeReview',
    composition: 'singlePath',
    bead: 'mtg-bc2.34',
  },
];

/** A defect this bank replays: a property of today's kernel, run as a test. */
export interface ReplayedDefect {
  readonly kind: 'replayed';
  /** The `DefectRecord.commit` this replays. */
  readonly commit: string;
  /** The property, phrased as the assertion, so a red run says what broke. */
  readonly property: string;
  readonly run: () => void;
}

/**
 * A defect this bank cannot replay, and why.
 *
 * Present so partial coverage is stated rather than silently smaller. A bank
 * that claims coverage it does not have is worse than a smaller honest one, so
 * `bank.test.ts` reports these by name and refuses one with an empty reason.
 */
export interface UnreconstructedDefect {
  readonly kind: 'unreconstructed';
  readonly commit: string;
  readonly reason: string;
}

export type BankEntry = ReplayedDefect | UnreconstructedDefect;

/** Builds a replay entry; the one constructor, so every entry has the fields. */
export function replay(commit: string, property: string, run: () => void): ReplayedDefect {
  return { kind: 'replayed', commit, property, run };
}

/** Builds an explicit gap; see `UnreconstructedDefect` for why one exists. */
export function unreconstructed(commit: string, reason: string): UnreconstructedDefect {
  return { kind: 'unreconstructed', commit, reason };
}

/** The ledger record a bank entry replays; throws when the commit is unknown. */
export function defectOf(commit: string): DefectRecord {
  const found = LANDED_RULES_DEFECTS.find((record) => record.commit === commit);
  if (found === undefined) throw new Error(`no landed rules defect is recorded for ${commit}`);
  return found;
}
