/**
 * Two legal moves must not read the same, said over the contract rather than
 * over an engine.
 *
 * `mtg-cee` is the bug. A board with one Emberflow Raider a side offered two
 * casts of Lightning Lash whose visible text and accessible name were both
 * `Cast Lightning Lash → Emberflow Raider`. The two buttons submit different
 * ids; one burns the opponent's creature and one burns your own. A player who
 * picks the wrong one was told nothing, and a screen-reader user heard the same
 * string twice. `@mtg/ui`'s `routes/play/naming.ts` is the fix, and it is
 * written over `GameState`: it reads controllers, same-named twins, what is
 * attached to what, and what on the stack is aimed where, straight out of the
 * kernel. A surface over this contract holds none of that. It holds
 * `MoveOption.text`, one plain sentence the backend wrote, and it can regress
 * `mtg-cee` on its first day.
 *
 * `mtg-bc2.151.3` states the fork: move the naming rule behind the contract, or
 * write down that a rail over a neutral backend is allowed to be worse. Neither
 * whole, because the rule is two rules and they land in different places:
 *
 *  1. **Is this list ambiguous?** Pure enumeration data. Two options carrying
 *     equal `text` is the entire condition, and answering it needs nothing but
 *     the decision the backend already handed over.
 *  2. **What separates these two?** A fact about the objects the two moves point
 *     at — and `TableView` carries objects, with the controller, the body, the
 *     tap state, the damage and the counters on each.
 *
 * Both halves are functions of `PendingDecision` and `TableView`. So both are
 * here, this file imports nothing outside `@mtg/engine`, and a backend that has
 * never heard of `naming.ts` gets the repair by being a backend. What is *not*
 * here is the third rung, and its absence is structural rather than unfinished.
 *
 * # It repairs a sentence; it does not write one
 *
 * `naming.ts` builds the phrase from the object up, which is why it can say
 * `your Emberflow Raider` **always** rather than only on a collision: a phrase
 * should be a fact about the object rather than about what else is in the list
 * beside it, and a move that renames itself when another move appears is worse
 * than a long move. That option is not available here. The backend wrote the
 * sentence and this file has never seen the vocabulary it was written in, so the
 * only safe operation on it is to append. Appending is a repair, and a repair
 * fires on a collision by construction.
 *
 * The cost is exactly the property `naming.ts` bought: a label here is stable
 * within one decision and not across two. A button reading `Tap Mountain for R`
 * gains a qualifier the turn a second Mountain arrives. That is the neutral
 * rail being worse, in the one place it is worse on purpose, and it is worse
 * than a wrapped line rather than worse than a wrong burn.
 *
 * # What the projection can separate, and what it cannot
 *
 * `ASPECTS` is the complete list, and it is complete because `ObjectView` is:
 * whose it is, how big it is, whether it is tapped, what is marked on it, what
 * counters it holds. Two options are separated when the objects they point at
 * disagree about one of those.
 *
 * The two clauses of `naming.ts`'s `distinguishingLine` that are missing are the
 * two that are **relations rather than properties**: what is attached to a
 * permanent (`mtg-cee` rung 4, the equipment whose whole clause is
 * `grantKeyword` and moves no number) and what on the stack is aimed at it
 * (`mtg-njrp`, where killing the aimed-at twin fizzles the equip and killing the
 * other one does not). `ObjectView` carries no edge to another object, and
 * `projection.ts` argues that the omission is the point rather than a gap to
 * fill later: a surface that could re-derive relationships from the projection
 * would be a second rules engine, and the contract's whole claim is that the
 * backend is the only one. So a neutral rail cannot draw `mtg-njrp`'s reticle
 * and cannot say in words what the reticle says, and two twins that differ only
 * in what is aimed at them come back shared. They come back *marked* shared,
 * which is the difference between a limit and a silence.
 *
 * # Why the qualifier is a seat's name and not `your`
 *
 * `naming.ts` says `your Emberflow Raider` and `Bot's Emberflow Raider`, and the
 * word is chosen by `@mtg/ui`'s `seat.ts`, whose rule is that the *label*
 * decides: `You` takes the pronoun and every other label takes the genitive. A
 * hot-seat table names both seats outright, so no flag can be trusted to say
 * which seat the reader is in.
 *
 * That rule needs one string, `You`, and a copy of it here would be a second
 * copy of a rule whose one copy exists because the same bug was found six times
 * in five files (`mtg-1ih`). `@mtg/engine` cannot import `@mtg/ui` and never
 * will, so the two copies could not be checked against each other. Worse, the
 * rule is not this layer's to hold: which label means the reader is a fact about
 * a surface's own vocabulary, not about the table. So the qualifier here names
 * the seat as the spec named it, `(North)` against `(South)`. It is plainer than
 * `your` and it separates the same two buttons, which is the regression.
 *
 * A surface with its own seat vocabulary should still say `your`: it holds
 * `ObjectView.controller` and its own labels, and building the possessive from
 * those two is the job `naming.ts` already does.
 *
 * # Why this is not a discriminant, and not a capability flag either
 *
 * `determinism.ts` models reproducibility as a literal discriminant, so a
 * function that requires it says `RecordedBackend` in its signature and an
 * observed backend fails to typecheck rather than failing a run-time check. The
 * obvious next move is `textQuality: 'plain' | 'disambiguated'` in the same
 * shape. It does not work here, for three reasons, and the third is the one that
 * settles it:
 *
 *  1. **The discriminant would narrow nothing.** Determinism works because the
 *     arms carry *different members* — `reopen` and `fingerprint` against a
 *     transcript — so the bad call is not there to make. `text` is on
 *     `MoveOption` and every backend has one. A surface would keep reading
 *     `option.text` on both arms and the narrowing would buy nothing it could
 *     not skip.
 *  2. **The cross product is not free**, which is `seats.ts`'s reason for being
 *     a nullable member instead of a second discriminant. Two arms times two
 *     arms is four session types for two independent facts.
 *  3. **It is not a property of a backend.** Determinism is true of an engine
 *     for every game it will ever play. Ambiguity is true of *one decision at
 *     one position*: the same backend hands out a clean list this turn and a
 *     colliding one the turn a second copy resolves. A static declaration would
 *     be a claim about every position, and no backend can keep it.
 *
 * So the declaration is on the value and is computed per decision.
 * `MoveLabel.sharedWith` is a required field on every label, empty when nothing
 * else reads like this one and holding the other ids when something does — the
 * same trick as `seats: SeatProjection | null`, where reading the declaration
 * and reaching the value are one act. It is one rung weaker than a missing
 * member, and the rung is unavailable: no type can delete a string a surface can
 * already see.
 *
 * # The backend still has to point at the target
 *
 * This repairs what it can reach, and it reaches through `MoveOption.targets`.
 * `@mtg/kernel`'s `backend-projection.ts` fills that list from `objectsIn`,
 * which for `castSpell` yields the *spell* and not the objects the spell was
 * aimed at, so the two casts that named this bug arrive here carrying identical
 * targets and leave marked shared. The projector owes the contract the chosen
 * targets of a `castSpell`, an `activateAbility` and a `triggerTargets` — they
 * are on the action already, and `MoveTarget` is defined as an object a move
 * points at, which a spell's target is. Until then the kernel's own casts are in
 * the residue rather than in the repair, and `sharedWith` is what says so.
 */
import type { MoveId, MoveOption, PendingDecision } from './decision';
import type { ObjectView, TableView } from './projection';

/**
 * One option, as a surface should print it.
 *
 * `text` is the backend's sentence with a qualifier appended where one was
 * needed and could be derived, and is otherwise the backend's sentence
 * untouched.
 */
export interface MoveLabel {
  readonly id: MoveId;
  readonly text: string;
  /**
   * The other options this label still cannot be told from, empty when it can.
   *
   * Non-empty means the projection held nothing that separates these moves, and
   * it is not the same claim `naming.ts` makes when it lets two twins read
   * alike. There the choice is genuinely free because everything about both is
   * on the table; here everything *this layer can see* is equal, and a relation
   * the projection does not carry may still be deciding the move. A surface that
   * draws these buttons identically and says nothing has reproduced `mtg-cee`
   * with a warning attached.
   */
  readonly sharedWith: readonly MoveId[];
}

/**
 * One fact about an object that the projection carries and that two objects can
 * disagree about.
 *
 * Ordered as `naming.ts` orders its line: whose it is first, because that is the
 * clause most likely to be the decision itself, then the body and what has
 * happened to it.
 */
interface Aspect {
  say(object: ObjectView, view: TableView): string;
}

const ASPECTS: readonly Aspect[] = [
  { say: (object, view): string => view.seats[object.controller].name },
  {
    say: (object): string =>
      object.power === null || object.toughness === null
        ? ''
        : `${String(object.power)}/${String(object.toughness)}`,
  },
  { say: (object): string => (object.tapped ? 'tapped' : 'untapped') },
  { say: (object): string => (object.damage === 0 ? '' : `${String(object.damage)} damage marked`) },
  { say: (object): string => countersOf(object) },
];

function countersOf(object: ObjectView): string {
  return Object.entries(object.counters)
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([kind, count]) => `${kind} x${String(count)}`)
    .join(', ');
}

/**
 * Every option of one decision, printed so that no two read the same where the
 * projection can tell them apart.
 *
 * Pure, and a function of the two values a surface already holds: the decision
 * the backend is asking and the board it is asking about. Call it with the view
 * the same delivery carried, table or per-seat — a per-seat view has had
 * concealed objects removed, so a move pointing into another seat's hand is
 * simply not separable there, which is the correct answer for that reader.
 */
export function labelDecision(decision: PendingDecision, view: TableView): readonly MoveLabel[] {
  const index = objectIndex(view);
  const qualified = new Map<MoveId, string>();
  for (const group of sharedText(decision.options).values()) {
    for (const [id, text] of qualifyGroup(group, view, index)) qualified.set(id, text);
  }
  const drafted = decision.options.map((option) => ({
    id: option.id,
    text: qualified.get(option.id) ?? option.text,
  }));
  const remaining = sharedText(drafted);
  return drafted.map((one) => ({
    ...one,
    sharedWith: (remaining.get(one.text) ?? [])
      .filter((other) => other.id !== one.id)
      .map((other) => other.id),
  }));
}

/** What one printable thing is: an id and the sentence under it. */
interface Printed {
  readonly id: MoveId;
  readonly text: string;
}

/**
 * The entries that share their text with another entry, keyed by that text.
 *
 * A text only one entry carries is absent rather than mapped to a single-element
 * group, so the caller's `undefined` is exactly "nothing reads like this".
 */
function sharedText<T extends Printed>(entries: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const byText = new Map<string, T[]>();
  for (const entry of entries) {
    const seen = byText.get(entry.text);
    if (seen === undefined) byText.set(entry.text, [entry]);
    else seen.push(entry);
  }
  const shared = new Map<string, readonly T[]>();
  for (const [text, group] of byText) if (group.length > 1) shared.set(text, group);
  return shared;
}

/**
 * One colliding group's sentences, each with what tells it from the others
 * appended.
 *
 * Only the aspects that *vary within the group* are said, so the qualifier is
 * doing work in every clause it has. Targets are compared position by position,
 * because an option pointing at three attackers differs from its twin at one of
 * the three and saying all nine facts would bury the one.
 *
 * The whole group is answered in one pass rather than one option at a time, and
 * that is not premature: a truncated blocker decision offers up to 512 options
 * (`decision.ts`), and a backend that names a move by its kind gives all 512 the
 * same sentence. Deciding per option would compare the group against itself once
 * per member.
 */
function qualifyGroup(
  group: readonly MoveOption[],
  view: TableView,
  index: ReadonlyMap<string, ObjectView>,
): ReadonlyMap<MoveId, string> {
  const width = Math.max(...group.map((one) => one.targets.length));
  const varying: (readonly Aspect[])[] = [];
  for (let at = 0; at < width; at += 1) {
    const objects = group.map((one) => objectAt(one, at, index));
    const said = (aspect: Aspect): Set<string> =>
      new Set(objects.map((object) => (object === null ? '' : aspect.say(object, view))));
    varying.push(ASPECTS.filter((aspect) => said(aspect).size > 1));
  }

  const qualified = new Map<MoveId, string>();
  for (const option of group) {
    const clauses: string[] = [];
    varying.forEach((aspects, at) => {
      const target = option.targets[at];
      const object = objectAt(option, at, index);
      if (target === undefined || object === null) return;
      const said = aspects.map((aspect) => aspect.say(object, view)).filter((word) => word.length > 0);
      if (said.length === 0) return;
      clauses.push(option.targets.length > 1 ? `${target.name} ${said.join(' · ')}` : said.join(' · '));
    });
    qualified.set(option.id, clauses.length === 0 ? option.text : `${option.text} (${clauses.join(', ')})`);
  }
  return qualified;
}

/**
 * The projected object behind one of a move's targets, or null when the view
 * does not carry it.
 *
 * Null is a normal answer and not a backend fault: the projection carries the
 * stack, both battlefields, both graveyards and whichever hands the viewer may
 * see, and nothing else. A move that points into exile or into a library points
 * at something this layer cannot describe, and an option that cannot be
 * described is left to `sharedWith`.
 */
function objectAt(option: MoveOption, at: number, index: ReadonlyMap<string, ObjectView>): ObjectView | null {
  const target = option.targets[at];
  return target === undefined ? null : (index.get(target.oid) ?? null);
}

/** Every object the view carries, by the opaque id a move points at it with. */
function objectIndex(view: TableView): ReadonlyMap<string, ObjectView> {
  const index = new Map<string, ObjectView>();
  for (const zone of zonesOf(view)) {
    for (const object of zone) index.set(object.oid, object);
  }
  return index;
}

function zonesOf(view: TableView): readonly (readonly ObjectView[])[] {
  const zones: (readonly ObjectView[])[] = [view.stack];
  for (const seat of view.seats) {
    zones.push(seat.battlefield, seat.graveyard);
    if (seat.hand !== null) zones.push(seat.hand);
  }
  return zones;
}
