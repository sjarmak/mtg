/**
 * Who each attacker attacks, at a table with more than one player to attack.
 *
 * `mtg-bc2.154.6.5.4`. Against one opponent a declaration is a set of creatures
 * and there is nothing to ask about the other half: every attacker goes at the
 * only defender, so a click on a creature is a toggle. At a pod the same click
 * has to say *whom*, because CR 508.1b has each attacker declared against one
 * player or one planeswalker they control, and a table that stages the creature
 * without asking has chosen the defender for the player.
 *
 * The backend states the choice as data. Each unstaged creature carries one
 * `add` move per defender, each move naming its `defender` (`@mtg/engine`'s
 * `ObjectMove`), so nothing here reads a move id or a label: it groups the
 * moves the backend offered and hands back the one a click means. A creature
 * already in the declaration has one move, the one that takes it back out.
 *
 * The chosen defender is a *picker*, not a per-creature dialog. Pick who is
 * being attacked, then click the creatures that go at them; pick another and
 * click the rest. That is the two-step Forge and Magic Online both use for a
 * pod, it keeps the click count at one per creature, and it puts the question
 * where the answer is given (the combat band) instead of in a menu on each card.
 * Nothing is picked until the player picks, and until then no creature may be
 * staged: a default target would be exactly the silent choice this file exists
 * to remove.
 */
import type { ObjectMove, PlayDefender, TableView } from '@mtg/engine';

/** One player or planeswalker an attacker may be sent at, keyed stably across renders. */
export interface AttackDefender {
  readonly key: string;
  readonly label: string;
  readonly kind: 'player' | 'planeswalker';
}

/** The picker the combat band draws, and what it is showing. */
export interface AttackTargeting {
  readonly options: readonly AttackDefender[];
  /** The defender the next creature staged goes at, or null while nobody is picked. */
  readonly picked: string | null;
  readonly pick: (key: string) => void;
  /** How many staged creatures are going at each defender, by key. */
  readonly counts: ReadonlyMap<string, number>;
}

export interface AttackPlan {
  /** Every creature the backend offers this declaration for, staged or not. */
  readonly creatures: ReadonlySet<string>;
  /** Who they may be sent at, in the order the backend first offered them. */
  readonly defenders: readonly AttackDefender[];
  /**
   * The move a click on `oid` submits when `picked` is the chosen defender, or
   * null when the click means nothing yet: the creature is not in the
   * declaration and nobody it could attack has been picked.
   */
  readonly move: (oid: string, picked: string | null) => string | null;
}

/** The key a defender is filed under. Total over both arms, so it never collides. */
export function defenderKey(defender: PlayDefender): string {
  return 'seat' in defender ? `seat:${String(defender.seat)}` : `card:${defender.oid}`;
}

/**
 * A defender in the words the table uses for it: a player by name, a
 * planeswalker or battle by its own.
 *
 * Read off the position rather than off the move, because the move names an
 * object by id and only the view says what it is. An object the view no longer
 * shows falls back to a generic word instead of an id, since an id is the one
 * thing a player must never be asked to read.
 */
export function describeDefender(view: Pick<TableView, 'seats'>): (defender: PlayDefender) => AttackDefender {
  return (defender): AttackDefender => {
    if ('seat' in defender) {
      return {
        key: defenderKey(defender),
        label: view.seats[defender.seat]?.name ?? `Seat ${String(defender.seat + 1)}`,
        kind: 'player',
      };
    }
    const found = view.seats
      .flatMap((seat) => seat.battlefield)
      .find((object) => object.oid === defender.oid);
    return { key: defenderKey(defender), label: found?.name ?? 'A planeswalker', kind: 'planeswalker' };
  };
}

/**
 * Sorts the backend's combat moves into a plan, or `null` when they are not an
 * exact declaration a surface can stage.
 *
 * Exact means the same thing it always meant here: every move is one the
 * decision offers, no creature is offered the same defender twice, and every
 * creature already staged has its own way back out. A backend that is not
 * exact gets no click-to-stage at all rather than a guess (`BackendGame.ts`).
 * A creature with a single `add` that names no defender is the one-opponent
 * declaration the earlier bridge wrote and is still a plain toggle.
 */
export function attackPlan(
  actions: readonly ObjectMove[],
  offered: ReadonlySet<string>,
  staged: ReadonlySet<string>,
  describe: (defender: PlayDefender) => AttackDefender,
): AttackPlan | null {
  const byCreature = new Map<string, ObjectMove[]>();
  for (const action of actions) {
    if (!offered.has(action.move)) return null;
    byCreature.set(action.oid, [...(byCreature.get(action.oid) ?? []), action]);
  }
  const adds = new Map<string, ReadonlyMap<string, string>>();
  const removals = new Map<string, string>();
  const defenders = new Map<string, AttackDefender>();
  for (const [oid, moves] of byCreature) {
    if (staged.has(oid)) {
      const only = moves[0];
      if (moves.length !== 1 || only === undefined) return null;
      removals.set(oid, only.move);
      continue;
    }
    const filed = new Map<string, string>();
    for (const move of moves) {
      const key = move.defender === undefined ? '' : defenderKey(move.defender);
      if (filed.has(key)) return null;
      filed.set(key, move.move);
      if (move.defender !== undefined && !defenders.has(key)) defenders.set(key, describe(move.defender));
    }
    // A defender-less move beside named ones cannot be told apart from them.
    if (filed.size > 1 && filed.has('')) return null;
    adds.set(oid, filed);
  }
  if ([...staged].some((oid) => !removals.has(oid))) return null;
  return {
    creatures: new Set(byCreature.keys()),
    defenders: [...defenders.values()],
    move: (oid, picked): string | null => {
      const removal = removals.get(oid);
      if (removal !== undefined) return removal;
      const filed = adds.get(oid);
      if (filed === undefined) return null;
      if (filed.size === 1) return [...filed.values()][0] ?? null;
      return picked === null ? null : (filed.get(picked) ?? null);
    },
  };
}

/**
 * The picker for this declaration, or `null` when there is nothing to ask.
 *
 * Fewer than two defenders is the one-opponent table, and it draws no picker at
 * all, unless somebody is already picked: a pick can only have been made from a
 * picker that was drawn, so it means the question is live, and a picker that
 * vanished the moment the last creature was staged would take the only statement
 * of whom they are going at with it. A defender stays in the list while a
 * creature staged against it does, even after the backend stops offering it
 * (every creature that could attack it is already in), so the count on it never
 * vanishes under a declaration that still holds it. `assigned` is what this
 * surface submitted, because the projection says a creature is attacking and not
 * at whom.
 */
export function attackTargeting(
  plan: AttackPlan,
  staged: ReadonlySet<string>,
  assigned: ReadonlyMap<string, AttackDefender>,
  picked: string | null,
  pick: (key: string) => void,
): AttackTargeting | null {
  const options = new Map(plan.defenders.map((defender) => [defender.key, defender] as const));
  const counts = new Map<string, number>();
  for (const oid of staged) {
    const defender = assigned.get(oid);
    if (defender === undefined) continue;
    if (!options.has(defender.key)) options.set(defender.key, defender);
    counts.set(defender.key, (counts.get(defender.key) ?? 0) + 1);
  }
  if (options.size < 2 && (picked === null || !options.has(picked))) return null;
  return {
    options: [...options.values()],
    picked: picked !== null && options.has(picked) ? picked : null,
    pick,
    counts,
  };
}
