/**
 * The legal-move rail: every move the kernel enumerated, as a flat labeled list.
 *
 * # The rail is a contract, not a stage of the build
 *
 * **`mtg-bz2` rebuilds this surface around direct manipulation, and the rail
 * survives it.** Every one of that epic's fourteen lanes could plausibly delete
 * this list — a phase bar, a click-built attack, a target chosen on the
 * battlefield and a staged cast all read as replacements for "pick from a flat
 * text list", and `mtg-bz2.2` says so outright. Deleting it is out of scope for
 * all of them, and this paragraph is where that is written down because it is
 * the file a lane would open to do it.
 *
 * Three reasons, in the order they bind:
 *
 *  1. **It is the keyboard and screen-reader path.** A click target on a card
 *     face is a pointer affordance; the rail is a list of buttons with words on
 *     them, inside one labeled group a screen reader announces as the set being
 *     chosen from. `mtg-bz2.14` is the touch mapping and has the same shape:
 *     gestures are added *beside* the enumerated moves, never instead of them.
 *  2. **It is the complete enumeration, less the one move with a fixed home.**
 *     Direct manipulation shows the moves that have an object to hang on. The
 *     rail shows the ones that do not — a concession the kernel offers, a
 *     mulligan, a declaration of no attackers — and it is what answers "what can
 *     I even do here" when the answer is not on the table. The exception is
 *     `passPriority`, which left this list on 2026-08-20 and is drawn once, in
 *     `./priority.ts`'s foot; `UNLISTED` below carries the ruling, the reversal
 *     it is, and the two dates it sits between. So the completeness claim is
 *     about the *column* rather than about this list, and the property that
 *     matters is unchanged: every enumerated move is reachable and each submits
 *     its own index.
 *  3. **It is what the whole-game test drives.** `test/play/play.test.ts` clicks
 *     a game from opening hand to result through
 *     `screen.queryByRole('group', { name: LEGAL_MOVES_LABEL })`, and every lane
 *     runs in a worktree of its own, so a lane that removed the group would fail
 *     that test everywhere at once and be discovered at merge rather than at
 *     review. `test/play/rail-contract.test.ts` states the contract on its own
 *     so the failure names the rule instead of a click-through.
 *
 * What may change is what the rail is *for*: once clicking objects is the
 * primary path, this becomes the secondary and accessible one rather than the
 * only one. Narrowing it, reordering it, restyling it, or moving it are all in
 * scope. Removing the group or its accessible name is not.
 *
 * # Where it sits
 *
 * On the width axis (`mtg-bc2.137`), in the **pod column**, in the span between
 * the two seats (`mtg-rgc.4`). Under the hand it was up to 32% of the table's
 * height and grew with the option count, so a busy priority shrank every card on
 * the table; `styles/board/fit.ts` records those measurements. It then spent a
 * year in the side rail beside the log, where the two could not both have the
 * room — 89 log lines with two of them painted, at every viewport measured — and
 * Magic Online's own answer is that the two rails hold different kinds of thing:
 * the ask on the left, between the pods, and the history on the right.
 * `styles/board/rail.ts` records both geometries and the measurement behind the
 * split.
 *
 * All four panels in this file go to that column, not only `promptPanel`. A beat,
 * a result and a wait are the same slot answering with something other than a
 * list of moves, and a surface that put three of them in one place and the fourth
 * somewhere else would be asking the player to look in two places for the answer
 * to one question.
 *
 * # One act, printed once (`mtg-46g`)
 *
 * A move's label is its act and then what the act is aimed at, so one ability
 * with twelve legal targets is twelve labels that agree for a hundred characters
 * and then differ. Measured on the flagship set's fixture at twelve permanents
 * a side, chrome-headless-shell 151.0.7922.47: twenty-eight moves, of which
 * twelve were activations of one ability of one permanent, 110 to 167px tall
 * each in a 128px column against 36.8px for every other move on the list. Those
 * twelve were **1,600 of the panel's 2,519px of content**, and the word that told
 * one of them from another was the last one on each.
 *
 * So a run of neighbors that share an act prints the act once, above them, and
 * each button carries only its own end of the sentence. It is a fold and not a
 * summary: every option the kernel enumerated is still its own button with its
 * own index, `choice-button.ts` keeps the unfolded sentence as the button's
 * accessible name, so nothing about the screen-reader path changes, and a run of
 * one folds nothing.
 *
 * **What is shared is the act, the arrow and the detail** — all three, because
 * `sharedKey` cut the run on all three. A shared line that printed only the act
 * dropped the other half of the sentence off the visible surface, and for an
 * activation that half is the source permanent, which is the whole of what tells
 * one activation from another when the ability's text never names its own card
 * (`mtg-1or`). `test/play/rail-contract.test.ts` drives a board that folds and
 * holds this.
 *
 * **The order is the enumeration's order within a group, and the groups reorder
 * it.** `GROUP_ORDER` above puts every play first and every pass last whatever
 * order the kernel enumerated them in, and runs are cut on adjacency *after*
 * that filter, so two options that were neighbors in `decision.options` and land
 * in different groups do not fold together. What the fold itself never does is
 * move a member: within a group the buttons appear in the order they arrived,
 * because re-sorting would move a move out from under the finger going for it.
 *
 * # One button per option, except at a combat declaration (`mtg-y1t`)
 *
 * This is a deliberate narrowing of point 2 above and it is written here rather
 * than done quietly. A combat declaration is the one decision whose option count
 * is *exponential in the board*: `legal.ts` enumerates the attack as the subsets
 * of the eligible attackers and the block as the cartesian product of each
 * blocker's choices, so eight untapped creatures are 256 legal declarations and
 * every one of them is distinct. A real game reached exactly that at turn 24 —
 * 256 buttons, 63,582px of content in a 449px column, three of them fully on
 * screen — and there was no other way to block, since `mtg-bz2.5` has not
 * landed. The fold cannot help: a blocker label carries no `TARGET_ARROW`, so
 * every run is a run of one, and nothing about a taller column fixes 2^n.
 *
 * So at those two decisions the rail draws `declare-panel.ts` instead: a
 * confirm, and one row per creature saying what it is doing. What the contract
 * loses is "one button per option". What it keeps, and what
 * `test/play/rail-contract.test.ts` now asserts by walking a board's whole
 * declaration space, is the property that mattered — **every enumerated
 * declaration is reachable, and each submits its own index.** The labeled group
 * stays, its name stays, and every entry is still a real focusable button.
 * Everything the kernel asks that is *not* one of those two decisions is
 * untouched and still lists one button per option.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Beat, BeatKind, Choice, DepartureZone, GameState, PlayerId, SessionView } from '@mtg/kernel';
import { describeResult, listPhrase } from '../../log/narrate';
import { seatVerb } from '../../seat';
import { choiceButton, unfoldedName } from './choice-button';
import { declarePanel } from './declare-panel';
import { ownedName, ownedNameLeading } from './naming';
import { orderPanel } from './order-panel';
import type { SeatNames } from './position';
import { TARGET_ARROW } from './prompt';
import type { PlayChoice, PlayPrompt } from './prompt';
import type { DeclarationControl, OrderControl } from './selection';

/** The accessible name of the container holding every currently legal move. */
export const LEGAL_MOVES_LABEL = 'Legal moves';

/** The rail's title while the other seat owes the decision. */
export const WAITING_LABEL = 'Waiting';

/** What the button that picks the game up from a beat says. */
export const CONTINUE_LABEL = 'Continue';

/** Priority offers a mixed bag; grouping keeps a 30-option list readable. */
const GROUP_ORDER: readonly { readonly title: string; readonly kinds: readonly PlayChoice['kind'][] }[] = [
  { title: 'Play', kinds: ['playLand', 'castSpell'] },
  { title: 'Abilities', kinds: ['activateAbility'] },
  { title: 'Mana', kinds: ['activateManaAbility'] },
  { title: 'Combat', kinds: ['declareAttackers', 'declareBlockers', 'orderBlockers'] },
  { title: 'Hand', kinds: ['discard'] },
  { title: 'Turn', kinds: ['concede'] },
];

/**
 * The one enumerated kind this list does not draw, and the whole of where that
 * is decided.
 *
 * The playtester, 2026-08-20, playing a run of priority passes through combat: "it's
 * kind of like pass though since you're allowing certain things to happen like
 * passing through combat it's just odd for that to show up as a separate pass
 * button". Put the two controls to her and the ruling was one sentence: "get rid
 * of the list entry". So `passPriority` is the fixed button in `./priority.ts`'s
 * foot and nowhere else, in both width states of the column.
 *
 * **That reverses an argument this file and `./pass.ts` both used to make, and
 * the reversal is the point rather than a regression.** The old reasoning was
 * that the list keeps its entry because the list is the complete enumeration,
 * and `../../../test/play/pass.test.ts` went further: deleting it would leave a
 * priority whose only legal move is the pass drawing an empty list. Both halves
 * are true about the mechanics and both miss what a player sees, which is one
 * index drawn as two controls a panel apart and read as two moves. The
 * 2026-08-13 ask that produced the fixed button in the first place ("the 'pass'
 * button should always be in the same spot") is the same person's other half of
 * the same answer, so the fixed home stays and the entry goes. Both dates are
 * here so a later reader meets the whole decision rather than half of it.
 *
 * The contract at the top of this file is unchanged in substance and restated in
 * scope: **the surface** holds every enumerated move and each submits its own
 * index. What moved is where completeness is claimed, from the list to the
 * column the list sits in, and the pass's home is on that column whether it is
 * open or shut — so nothing became unreachable in either state, and `passIndex`,
 * the fixed button and the space key all still take the index the kernel handed
 * out.
 *
 * Filtered here rather than dropped from `GROUP_ORDER`, because a kind that is
 * in no group falls through to the `Other` bucket at the foot of `choiceGroups`
 * and would come straight back under a worse heading. `concede` keeps the `Turn`
 * group it always had: `@mtg/kernel`'s `legal.ts` deliberately never enumerates
 * it — it is always legal and validated rather than listed — so that group draws
 * in no position the kernel produces today, and it is the home the kind would
 * take if one ever did.
 */
const UNLISTED: readonly PlayChoice['kind'][] = ['passPriority'];

/**
 * What the list says when the pass is the whole enumeration.
 *
 * The case `../../../test/play/pass.test.ts` named as the reason not to do this,
 * answered rather than avoided. An upkeep with nothing to do is the commonest
 * position in a game and its enumeration is one option, so with the pass out of
 * the list the group would otherwise be a labeled empty box under a headline
 * reading `Priority` and a note reading `1 legal`.
 *
 * It names both doors and neither location. The pass is in the column's foot
 * when the column is open and in the strip's foot when it is shut, and a
 * sentence that said `below` would be wrong in one of those and would have to be
 * kept level with a layout by hand.
 */
export const ONLY_PASS_NOTE =
  'Passing is the only legal move here. The Pass button takes it, and so does the space key.';

/**
 * The whole of what a run's members say in common, printed once above them.
 *
 * Both halves, because a folded button prints neither: the act *and* the detail
 * are what `sharedKey` cut the run on, so a shared line carrying only the act
 * drops the other half of the sentence off the surface entirely. For an
 * activation that half is the source permanent — `prompt.ts` puts it in the
 * detail on purpose, since an ability whose text never names its own card still
 * has to say which permanent is being tapped — so two permanents printing one
 * ability folded into two identical headings over four buttons that read as a
 * duplicated pair (`mtg-1or`). The source was in the accessible name and nowhere
 * a sighted player could reach.
 *
 * `act` keeps its trailing arrow. `Cast Lightning Lash` above a bare `Windrider
 * Drake` is a verb phrase and a noun with the relation between them deleted; the
 * arrow is one character and it is the character that says the buttons under the
 * line are what the line is aimed at.
 */
interface SharedLead {
  /** The act, up to and including `TARGET_ARROW`. */
  readonly act: string;
  /** The detail every member of the run carries, which is why they are one run. */
  readonly detail: string | null;
}

/**
 * A stretch of neighboring choices that say the same thing about themselves.
 *
 * `lead` is what they share and `members` is what each of them adds. It is
 * `null` for a run of one, which is every choice that has nothing in common
 * with the choice beside it, and those print exactly as they always did.
 */
interface ChoiceRun {
  readonly lead: SharedLead | null;
  readonly members: readonly PlayChoice[];
}

/**
 * What a choice shares with the one beside it: the act, the source, and nothing
 * else.
 *
 * The act ends at `TARGET_ARROW`, which `prompt.ts` writes and exports for this.
 * A choice with no arrow is aimed at nothing and shares nothing, so it folds
 * with nobody — a key of `null`, which never matches another key.
 *
 * The two halves are joined on a newline, which is the one character no label
 * and no detail on this surface contains, so two choices whose act and source
 * differ cannot collide on a key by dividing the same string in two places.
 */
function sharedKey(choice: PlayChoice): string | null {
  const at = choice.label.indexOf(TARGET_ARROW);
  return at < 0 ? null : `${choice.label.slice(0, at)}\n${choice.detail ?? ''}`;
}

/** What one member of a folded run adds: everything after the shared arrow. */
function foldedTail(choice: PlayChoice): string {
  return choice.label.slice(choice.label.indexOf(TARGET_ARROW) + TARGET_ARROW.length);
}

/**
 * The members of one group, cut into runs at every point where the shared part
 * changes.
 *
 * Consecutive rather than gathered, because the kernel's enumeration order is
 * the order the rail lists in and re-sorting it would move a move out from
 * under the finger that was going for it. Every run of one is left alone, so the
 * fold can only ever remove a repetition and never invent a heading.
 */
function choiceRuns(members: readonly PlayChoice[]): readonly ChoiceRun[] {
  const runs: ChoiceRun[] = [];
  let current: PlayChoice[] = [];
  let key: string | null = null;
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const lead =
      key === null || current.length < 2 || first === undefined
        ? null
        : {
            act: `${first.label.slice(0, first.label.indexOf(TARGET_ARROW))}${TARGET_ARROW.trimEnd()}`,
            // Every member of a run carries this same detail — it is half of
            // what `sharedKey` matched them on — so printing it once above them
            // is the fold rather than a summary of it.
            detail: first.detail,
          };
    runs.push({ lead, members: current });
    current = [];
  };
  for (const member of members) {
    const memberKey = sharedKey(member);
    if (memberKey === null || memberKey !== key) {
      flush();
      key = memberKey;
    }
    current.push(member);
  }
  flush();
  return runs;
}

function runNodes(runs: readonly ChoiceRun[], onChoose: (index: number) => void): readonly ReactNode[] {
  return runs.map((run, at) => {
    const lead = run.lead;
    const list = createElement(
      'div',
      { className: 'mtg-choices__list' },
      ...run.members.map((choice) =>
        choiceButton(
          choice,
          onChoose,
          false,
          lead === null ? null : { text: foldedTail(choice), name: unfoldedName(choice) },
        ),
      ),
    );
    if (lead === null) return createElement('div', { key: at, className: 'mtg-choices__run' }, list);
    return createElement(
      'div',
      { key: at, className: 'mtg-choices__run' },
      // The detail above the act rather than under it, which is the one place
      // the folded block does not mirror the unfolded button. On a button the
      // act, the arrow and the target are one line and the detail sits below
      // them unambiguously; folded, the arrow points at the buttons, so
      // anything printed between the two would read as the thing being aimed
      // at. `Wind Fisher` over `Activate {1}, {T}: … →` over the targets is the
      // permanent, its ability, and what the ability can be aimed at, in that
      // order — which is also the order they appear on the card.
      lead.detail === null
        ? null
        : createElement(
            'span',
            { className: 'mtg-choices__shared-detail', 'aria-hidden': true },
            lead.detail,
          ),
      // Not a heading and not naming anything: the buttons under it carry
      // their whole name themselves, so a reader that announced this line as a
      // group name would say the act twice per option.
      createElement('span', { className: 'mtg-choices__shared', 'aria-hidden': true }, lead.act),
      list,
    );
  });
}

function choiceGroup(
  key: string,
  title: string,
  members: readonly PlayChoice[],
  onChoose: (index: number) => void,
): ReactNode {
  return createElement(
    'div',
    { key, className: 'mtg-choices__group' },
    createElement('span', { className: 'mtg-choices__group-title' }, title),
    ...runNodes(choiceRuns(members), onChoose),
  );
}

function choiceGroups(prompt: PlayPrompt, onChoose: (index: number) => void): readonly ReactNode[] {
  // The enumeration less the kind that has a fixed home of its own; `UNLISTED`
  // carries the ruling and the reversal it is. Filtered once, here, so the
  // grouped pass below and the ungrouped fallback under it cannot disagree about
  // which choices the list is drawing.
  const listed = prompt.choices.filter((choice) => !UNLISTED.includes(choice.kind));
  if (listed.length === 0)
    return prompt.choices.length === 0
      ? []
      : [
          createElement(
            'p',
            { key: 'only-pass', className: 'mtg-choices__note', role: 'note' },
            ONLY_PASS_NOTE,
          ),
        ];
  const groups: ReactNode[] = [];
  const placed = new Set<number>();
  for (const group of GROUP_ORDER) {
    const members = listed.filter((choice) => group.kinds.includes(choice.kind));
    if (members.length === 0) continue;
    for (const member of members) placed.add(member.index);
    groups.push(choiceGroup(group.title, group.title, members, onChoose));
  }
  // Anything a future action type adds still reaches the screen rather than
  // silently vanishing because nobody updated GROUP_ORDER.
  const ungrouped = listed.filter((choice) => !placed.has(choice.index));
  if (ungrouped.length > 0) groups.push(choiceGroup('other', 'Other', ungrouped, onChoose));
  return groups;
}

/**
 * The contents of the labeled group: the flat enumeration, or one of the two
 * builders that assemble a single move out of it.
 *
 * A builder's confirm carries the enumeration's own words — `selection.ts`
 * builds it through `choiceText`, which is what labeled the flat list — so the
 * move a player commits to is announced exactly as the flat list announced it
 * and `naming.ts`'s rule that two legal moves must not read the same is
 * untouched. What it submits is not always an index; `declare.ts` carries why.
 *
 * The two are mutually exclusive by construction rather than by a rule stated
 * here: they are built from different decision kinds, so at most one of them is
 * ever non-null. The declaration is tested first because combat reaches it first.
 */
function railBody(
  prompt: PlayPrompt,
  onChoose: (choice: Choice) => void,
  declaration: DeclarationControl | null,
  ordering: OrderControl | null,
): readonly ReactNode[] {
  if (declaration === null)
    return ordering === null ? choiceGroups(prompt, onChoose) : orderBody(ordering, onChoose);
  return [
    declarePanel({
      plan: declaration.plan,
      stage: declaration.stage,
      assignment: declaration.assignment,
      confirm: declaration.confirm,
      focus: declaration.focus,
      answerFocus: declaration.answerFocus,
      onPress: declaration.press,
      onPick: declaration.assign,
      onBack: declaration.back,
      onClear: declaration.clear,
      onSubmit: onChoose,
    }),
  ];
}

function orderBody(ordering: OrderControl, onChoose: (choice: Choice) => void): readonly ReactNode[] {
  return [
    orderPanel({
      plan: ordering.plan,
      ordering: ordering.ordering,
      confirm: ordering.confirm,
      onPress: ordering.press,
      onClear: ordering.clear,
      onSubmit: onChoose,
    }),
  ];
}

export function promptPanel(
  prompt: PlayPrompt,
  onChoose: (choice: Choice) => void,
  decisions: number,
  declaration: DeclarationControl | null = null,
  ordering: OrderControl | null = null,
): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, prompt.headline),
      createElement('span', { className: 'mtg-panel__note' }, `${String(prompt.choices.length)} legal`),
    ),
    createElement(
      'div',
      {
        // The body is a scroll container now, and a scroll container keeps its
        // offset across a re-render. Left alone, a player who scrolled to the
        // end of a long block prompt gets the *next* prompt already scrolled,
        // with its first legal move above the fold: driving a 260-step game at
        // 1280x800 reproduced exactly that at step 248, where the point at the
        // center of the first option hit-tested to the panel head instead. The
        // key changes with the decision, so React remounts the container and
        // the list starts at the top. It costs the focus ring after a click,
        // which was landing on whatever move now happens to sit at the same
        // index — a worse thing to keep than the scroll position.
        key: `decision-${String(decisions)}`,
        className: 'mtg-panel__body',
      },
      createElement('p', { className: 'mtg-prompt__explain' }, prompt.explain),
      prompt.truncated
        ? createElement(
            'p',
            { className: 'mtg-prompt__warning', role: 'note' },
            'The kernel capped this enumeration, so some legal moves are not listed.',
          )
        : null,
      // One labeled group around every move on offer. A screen reader announces
      // the set the player is choosing from, and it gives the surface a single
      // handle for "the legal moves right now" that is not a CSS class. The
      // contract at the top of this file is about exactly these two attributes.
      createElement(
        'div',
        { className: 'mtg-choices', role: 'group', 'aria-label': LEGAL_MOVES_LABEL },
        ...railBody(prompt, onChoose, declaration, ordering),
      ),
    ),
  );
}

/** What the rail holds once the kernel has stopped asking. */
export function resultPanel(
  session: SessionView,
  names: SeatNames,
  onNewGame?: (() => void) | undefined,
): ReactElement {
  const result = session.result;
  // `mtg-zwk`: this line used to print the kernel's own enum, so the last thing
  // a player read at the end of a game was `(lifeZero)`. The log already owns the
  // English for a result and every other surface goes through it, so this one
  // does too rather than keeping a second, worse vocabulary of one word.
  const outcome =
    result === null
      ? 'The game is over.'
      : describeResult(result, { player: (id: PlayerId): string => names[id] });
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Game over'),
      createElement('span', { className: 'mtg-panel__note' }, `${String(session.decisions)} decisions`),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement('p', { className: 'mtg-prompt__explain' }, outcome),
      onNewGame === undefined
        ? null
        : // Chrome, not a legal move: the kernel did not enumerate this one, so
          // it takes the button vocabulary rather than the move list's.
          createElement('button', { type: 'button', className: 'mtg-btn', onClick: onNewGame }, 'New game'),
    ),
  );
}

/**
 * How a permanent that left the battlefield is said to have left it, singular
 * and plural.
 *
 * Three sentences rather than one, because the zone is the whole of what the
 * player wants to know: an exile is gone, a bounce is coming back next turn, and
 * a tuck is somewhere in a library. `@mtg/kernel`'s `Departure` carries the zone
 * for exactly this, and the record is total over `DepartureZone` so a fourth
 * zone cannot be added to the kernel without a sentence being written for it
 * here.
 *
 * "its owner's" rather than "your", and it is the same rule the possessive on
 * the name follows: a card returns to the hand of whoever owns it, which on a
 * board where both seats are named is a different fact from whose creature it
 * was standing as.
 */
const DEPARTURE_CLAUSES: Readonly<Record<DepartureZone, readonly [one: string, many: string]>> = {
  exile: ['was exiled', 'were exiled'],
  hand: ["was returned to its owner's hand", "were returned to their owners' hands"],
  library: ["was put into its owner's library", "were put into their owners' libraries"],
};

/**
 * The five sentences a beat is, and the seat each one is said to.
 *
 * Written from the watching player's side rather than from the active player's,
 * because that is who is reading it: "your attack" and "their attack" are the
 * same event and the wrong one is worse than none. `names` supplies the words,
 * for the reason every other string on this surface stopped saying "you" —
 * two people can share this screen and a pronoun resolves against whoever is
 * holding it.
 *
 * The verb then has to agree with the word `names` supplied, which is the half
 * this got wrong: the hot-seat launcher calls the near seat `You`, that seat
 * attacks first in a sealed game, and the first sentence a player ever saw here
 * was `You is attacking with 4 creatures.` (`mtg-1ih`). `log/narrate.ts` had
 * already worked the rule out for the log — the label decides, so it stays
 * right on a hotseat table where neither seat is second person — and `seatVerb`
 * is that one rule rather than a second copy of it.
 *
 * **The death sentence names both sides and takes nobody's part**, which is the
 * same rule one step further. A destroyed permanent is public: it stood on a
 * board both players were looking at, and a frame that showed only the reader's
 * own losses would leave the other half of a trade to be inferred from a board
 * that no longer has it on. So every death in the halt is named as its
 * controller's — `your Emberflow Raider`, `Bot's Emberflow Raider` — through the
 * same `ownedName` the log points with, and a hotseat table reads correctly for
 * whichever of the two people is holding the screen. `ownedName` rather than
 * `targetName` because the twin qualifier is read off the board *now* and the
 * permanent this sentence is about has already left it.
 */
export function beatSentence(beat: Beat, state: GameState, names: SeatNames): string {
  const attacker = names[state.turn.active];
  const attacks = state.combat.attacks.length;
  const blocks = state.combat.blocks.length;
  const creatures = attacks === 1 ? '1 creature' : `${String(attacks)} creatures`;
  switch (beat.kind) {
    case 'attackers':
      return `${attacker} ${seatVerb(attacker, 'is', 'are')} attacking with ${creatures}.`;
    case 'blockers':
      // The count decides the words as well as the number, and both branches
      // got that wrong for the commonest combat in a game: one attacker read
      // `Nothing blocked. All 1 attackers are through.` and, once it was
      // blocked, `1 of the 1 attackers were blocked.` The line above already
      // switches `creatures` on the same count; this is that rule applied twice
      // more rather than a fourth place to spell a plural.
      if (blocks === 0) {
        return attacks === 1
          ? 'Nothing blocked. The attacker is through.'
          : `Nothing blocked. All ${String(attacks)} attackers are through.`;
      }
      return attacks === 1
        ? 'The attacker was blocked.'
        : `${String(blocks)} of the ${String(attacks)} attackers ${blocks === 1 ? 'was' : 'were'} blocked.`;
    case 'damage':
      return 'Combat damage is dealt.';
    case 'death': {
      // The first name opens the sentence and the rest do not, which is the only
      // difference between the two possessives and is `../../seat.ts`'s rule
      // rather than a capital applied here.
      const dead = beat.oids.map((oid, at) =>
        at === 0 ? ownedNameLeading(state, names, oid) : ownedName(state, names, oid),
      );
      return `${listPhrase(dead)} ${dead.length === 1 ? 'was' : 'were'} destroyed.`;
    }
    case 'departure': {
      // One sentence per zone, in the order the game sent them there. A batch
      // that exiles one creature and bounces another is two facts and reads as
      // two, where a single list would have to pick one verb and be wrong about
      // half of it. Grouping by first appearance rather than by a fixed zone
      // order keeps the sentences in the order the events happened, which is the
      // order the log beside them is in.
      const zones = [...new Set(beat.departures.map((each) => each.to))];
      return zones
        .map((zone) => {
          const gone = beat.departures
            .filter((each) => each.to === zone)
            .map((each, at) =>
              at === 0 ? ownedNameLeading(state, names, each.oid) : ownedName(state, names, each.oid),
            );
          const [one, many] = DEPARTURE_CLAUSES[zone];
          return `${listPhrase(gone)} ${gone.length === 1 ? one : many}.`;
        })
        .join(' ');
    }
    default: {
      // A sixth beat has to be given a sentence here rather than inheriting a
      // vague one, which is what the old `'Combat is happening.'` fallback was.
      const never: never = beat;
      throw new Error(`rail: unknown beat ${String(never)}`);
    }
  }
}

/**
 * The heading over that sentence.
 *
 * Three of the five are the step the game is standing in, because that is what a
 * combat beat is. A death and a departure are not steps (`@mtg/kernel`'s
 * `BEAT_STEPS`), so their headings name the thing that happened instead.
 *
 * The departure's heading says where the permanent went *from* rather than
 * where it went to, because one halt can hold two destinations and the sentence
 * under it is where they are named. `Exiled` as a heading would be a lie the
 * moment a spell bounced something in the same batch.
 */
const BEAT_TITLES: Readonly<Record<BeatKind, string>> = {
  attackers: 'Attackers declared',
  blockers: 'Blockers declared',
  damage: 'Combat damage',
  death: 'Destroyed',
  departure: 'Left the battlefield',
};

/**
 * What the rail holds while the game is paused so combat can be seen.
 *
 * A panel in the rail rather than a modal over the table, and that is the point
 * rather than a styling preference: `mtg-hmy` rejected a priority prompt as the
 * instrument for this bead precisely because "a modal whose only button is Pass
 * … covers the board the player is trying to watch". The board keeps drawing,
 * the attackers are rotated on it, and this says in words what just changed.
 *
 * The button is chrome and stays outside `LEGAL_MOVES_LABEL`, where `resultPanel`'s
 * New game button already sits. The kernel enumerated no options here — it asked
 * nothing — so a control inside the group naming the legal moves would be
 * claiming a move that does not exist.
 */
export function beatPanel(
  beat: Beat,
  state: GameState,
  names: SeatNames,
  onContinue: () => void,
): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, BEAT_TITLES[beat.kind]),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'p',
        { className: 'mtg-prompt__explain', role: 'status' },
        beatSentence(beat, state, names),
      ),
      createElement(
        'button',
        { type: 'button', className: 'mtg-btn', 'data-variant': 'primary', onClick: onContinue },
        CONTINUE_LABEL,
      ),
    ),
  );
}

/**
 * What the rail holds while the other seat is deciding.
 *
 * The networked counterpart of `resultPanel`, and it exists because the two
 * states are indistinguishable from this component's own inputs: nothing is
 * pending in both. On one screen only one of them is reachable — the session
 * stops in front of whoever is holding the device, so an empty prompt means the
 * game ended — and across a wire the common case is the other one. `PlayView`
 * decides which by whether it was told a name.
 *
 * It is a panel rather than a screen over the table on purpose. The board keeps
 * drawing and keeps updating, so a player watches their opponent play instead of
 * looking at a spinner, which is most of what makes a two-machine game feel like
 * a game rather than a turn queue.
 */
export function waitingPanel(name: string, decisions: number): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, WAITING_LABEL),
      createElement('span', { className: 'mtg-panel__note' }, `${String(decisions)} decisions`),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'p',
        { className: 'mtg-prompt__explain', role: 'status' },
        `${name} is deciding. The board keeps up as they play.`,
      ),
    ),
  );
}
