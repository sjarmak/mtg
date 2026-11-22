/**
 * The table: the board with the viewer's own cards wired for clicking.
 *
 * **The table is the other way in** (`mtg-jft`). The rail stays the authority;
 * it is what answers "what can I even do here" and it is the keyboard and
 * screen-reader path (`rail.ts` carries that contract). But a card you can play
 * is a card you can click. The mapping is `choicesByObject`, which inverts the
 * same enumeration the rail lists, so the two surfaces cannot disagree about
 * what is legal: a click dispatches an index out of that list, exactly as a rail
 * press does, and a game played either way records the same choice log.
 *
 * **Three gestures reach one card** (`mtg-bz2.2`): a single click plays its one
 * move or opens its menu, a double click plays its default move, and a right
 * click — or the context key — opens the menu whatever the card holds. All three
 * are wired here and decided in `selection.ts`, and all three are gated by the
 * same `playable` flag, so a card the enumeration says nothing about answers to
 * none of them rather than to two of the three.
 *
 * **A target is chosen on the table too** (`mtg-bz2.6`). While a staged cast is
 * waiting on a target slot the surface is in a targeting state: the answers to
 * that slot are lit on both battlefields, every other card on the table is drawn
 * inert and quiet, and a click on a lit card attaches it. That state *replaces*
 * every other reading of a click rather than joining it, which is what makes the
 * board's answer and the panel's answer one answer — `targeting.ts` derives both
 * from the stage `selection.ts` is already drawing. Players and spells on the
 * stack stay in the panel, which keeps listing every candidate; the board is an
 * added door to the enumeration, not a narrowing of it.
 *
 * The viewer's own hand and battlefield are wired, and **one opposing card is,
 * at one decision** — the sentence predates the paragraph above and still holds
 * for combat, which is a different mechanism. A block is not a target. CR 509.1a assigns a
 * blocker *to an attacker*, so the attacker is half of a move the viewer is the
 * one being asked for, and `mtg-bz2.5`'s own text asks for it by name: "select a
 * blocker then select the attacking creature it blocks". So an attacker becomes
 * a control while a question about one of your creatures is open, and at no
 * other moment — `litAttackers` below states the scope. `mtg-bz2.11`'s zone
 * panels land here too, which is why this composition has a file of its own
 * rather than sitting inside the view that also owns the toolbar and the pass.
 *
 * It owns no state. `selection.ts` holds what is selected and `use-session.ts`
 * holds the game; this decides only which props each side of the table gets.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { SeatId } from '@mtg/engine';
import { Board } from '../../board/Board';
import type { BoardProps, BoardSide } from '../../board/Board';
import type { BattlefieldProps, BoardPermanent } from '../../board/Battlefield';
import type { SeatRailEntry } from '../../board/SeatRail';
import type { HandCard } from '../../board/Hand';
import type { CommanderCard } from '../../board/CommandZone';
import { defenderKey } from './attack-targets';
import type { AttackStaging } from './combat';
import { blockGesture } from './declare';
import { useKeptRing } from './focus';
import { groupOf, orderGesture } from './order';
import type { PlayChoice } from './prompt';
import type { TableSelection } from './selection';
import { targetGesture } from './targeting';

export interface TableInput {
  /** The whole table from the viewer's seat; `position.ts` derives it. */
  readonly position: BoardProps;
  /**
   * Which seat is drawn nearest, by the id the kernel names it with.
   *
   * The projection has already spent it — `position.you` and `position.opponent`
   * are the two sides and neither carries a number — and an aim at a *player*
   * arrives as a `PlayerId` (`mtg-bz2.16`), so the one arithmetic fact that maps
   * a candidate to a pod has to come in rather than be recovered.
   */
  readonly viewer: SeatId;
  /** The enumeration read from the object end, which is what a click looks up. */
  readonly byObject: ReadonlyMap<string, readonly PlayChoice[]>;
  /** Exact enumerated choices attached to a player pod. */
  readonly byPlayer?: ReadonlyMap<SeatId, readonly PlayChoice[]>;
  readonly selection: TableSelection;
  /**
   * The objects the reader is pointing at from the game log (`./pointing.ts`).
   *
   * Applied to the two battlefields and the viewer's hand, and to nothing else:
   * the opponent's hand is face-down and has no keys to match, and the stack is
   * out of scope for the reason `./pointing.ts` gives. The combat band needs no
   * arm of its own -- `../../board/CombatZone.ts` draws its cards through
   * `groupNode`, which is `../../board/Battlefield.ts`'s own slot builder, so an
   * attacker lights while it is in the band.
   */
  readonly pointed?: ReadonlySet<string>;
  /**
   * What the pod column holds between the two seats: the move list while the
   * kernel is asking, the result once it has stopped. The move list is one of
   * the two things on this surface whose size the game state decides, so it is
   * on the width axis (`mtg-bc2.137`), and it is in the left column rather than
   * the right one because that is the column Magic Online asks its questions in
   * (`mtg-rgc.4`; `styles/board/rail.ts` records both geometries).
   */
  readonly prompt: ReactNode;
  readonly askHead?: ReactNode;
  readonly askCollapsed?: boolean;
  /**
   * What the shut ask column shows instead of the panel it can no longer draw
   * (`ask-flyout.ts`, `mtg-li0o`). A pass-through, like `prompt` and `steps`:
   * the table decides nothing about it and `../../board/Board.ts` places it.
   */
  readonly askFlyout?: ReactNode;
  /**
   * A paused game's one control, drawn over the combat seam while the motion it
   * is about plays (`beat-motion.ts`, `mtg-gt4q`). A pass-through, like
   * `askFlyout`: the table decides nothing about it and `../../board/Board.ts`
   * places it.
   */
  readonly beat?: ReactNode;
  /**
   * The step bar, drawn in the viewer's band between their battlefield and their
   * hand, where Magic Online draws it (`mtg-rgc.6`; `toolbar.ts`'s `stepBar`
   * builds it and `../../board/Board.ts` places it).
   *
   * It reaches the board through the table rather than through the strip because
   * this is the file that says what the viewer's own half of the mat holds. A
   * caller that owns no auto-pass settings passes null and gets no bar, which is
   * the rule the bar has always answered to.
   */
  readonly steps: ReactNode;
  /**
   * The divider between the viewer's battlefield and their hand, and the height
   * their last drag left the hand at (`hand-seam.ts`, `mtg-7rhk`).
   *
   * Optional in both halves and passed through untouched, like every other slot
   * on this input: the stored share belongs to whoever owns the view, and a
   * caller that owns none passes neither and gets the fixed seam this table drew
   * before the control existed.
   */
  readonly seam?: ReactNode;
  readonly seamStyle?: Readonly<Record<string, string>>;
  /** What the board's side rail holds: the history, which is the log. */
  readonly rail: ReactNode;
  /**
   * The attack being built by clicking, and the state that says whether one is
   * being asked for at all (`combat.ts`).
   *
   * It changes what a click on the viewer's own creature *means*, and only while
   * the kernel is asking this seat for attackers: it stages the creature instead
   * of opening its picker. That is not the surface inferring intent — during
   * declare attackers the enumeration is the power set, so today every eligible
   * creature already carries one option per subset containing it, and a click
   * opened a menu of up to 256 identical-looking declarations. Staging replaces a
   * menu nobody can read with the gesture the playtester asked for.
   *
   * The block half is not here and is not a second staging: it is the one
   * declaration `selection.ts` already holds, read through `blockGesture`. An
   * attack is a set over your own row and a block is a pairing across the seam,
   * so the two are genuinely different values and `combat.ts` says why they end
   * up in different modules.
   */
  readonly staging: AttackStaging;
  /** The confirm boundary, drawn at the end of the combat band by `Board`. */
  readonly combat: ReactNode;
  /**
   * The disclosure that opens and shuts the side rail, and whether it is shut.
   *
   * Passed through rather than built here, like every other slot on this input:
   * the state belongs to whoever owns the view (`rail-collapse.ts` says why it
   * is view state and not game state), and this file only says which of the
   * board's slots it lands in.
   */
  readonly railHead: ReactNode;
  readonly railCollapsed: boolean;
  /**
   * Takes the pass that lets the top of the stack resolve, or null.
   *
   * Here rather than in `position.ts` for the reason every other callback on this
   * input is: that file is a pure projection of kernel state into board props and
   * this file is where the viewer's own half of the table gets wired to act. It
   * is the same index the ask column's `Turn` entry and the fixed pass submit —
   * `../../board/StackZone.ts` states why a second door is not a second list.
   */
  readonly onResolve: (() => void) | null;
}

export function playTable(input: TableInput): ReactElement {
  const { position, byObject, selection, prompt, steps, rail, staging, combat } = input;
  const you = position.you;
  const hand = you.hand;
  // The block being assembled, read off the one declaration `selection.ts`
  // holds. Empty at every other decision, which is what keeps the two branches
  // below from having to ask what step the game is in.
  const declaration = selection.declaration;
  const block = blockGesture(declaration);
  const blocking = block.pressable.size > 0;
  // The damage assignment order being built, one decision later in combat and on
  // the other side of the seam: these are the *opponent's* creatures, because the
  // player being asked is the one attacking (CR 509.2). Empty at every other
  // decision, for `blockGesture`'s reason above.
  const order = orderGesture(selection.ordering);
  const ordering = order.pressable.size > 0;
  // The target slot a staged cast is waiting on (`mtg-bz2.6`). Unlike the two
  // above it is not a decision the kernel is on — a cast is staged while the
  // player holds priority — so it can be open on any decision and it is checked
  // *first* everywhere below. It cannot overlap the two anyway: a declaration
  // decision offers declarations and nothing castable, so `castPlans` is empty
  // there and no slot can be open.
  const aim = selection.targeting;
  const target = targetGesture(aim);
  const aiming = target.source !== null;
  // Every board press goes through this, because every board press can move the
  // card it was made on into or out of the combat band, and a card that moves
  // subtree takes the focus ring with it to the document (`./focus.ts`).
  const { keep } = useKeptRing();
  // The seat across a duel. A pod draws every opponent through its seat rail,
  // which does not ask this.
  const other: SeatId = input.viewer === 0 ? 1 : 0;
  /**
   * What pressing a player does, or null when nothing is asked of that player.
   *
   * The one rule behind the seat's pod and its row in a pod's rail
   * (`mtg-bz2.16`, `mtg-bc2.154.6.5.4`): what may be pressed while a slot is open
   * is exactly the slot's answers, so a seat that is not one of them is left the
   * generic block it always was rather than a lit control that does nothing.
   */
  function playerAim(player: SeatId): (() => void) | null {
    if (aim === null) {
      const choices = input.byPlayer?.get(player) ?? [];
      const choose = selection.choose;
      if (choices.length !== 1 || choose === undefined) return null;
      return (): void => {
        choose(choices[0]!.index);
      };
    }
    // A spell's target slot is the kernel arm's, and that arm seats two.
    const aimable = player === 0 || player === 1 ? player : null;
    if (aimable === null || !target.players.has(aimable)) return null;
    return (): void => {
      aim.aimPlayer(aimable);
    };
  }

  /** A seat's pod, wired to answer an open slot when that seat is one of its candidates. */
  function aimedPod(side: BoardSide, player: SeatId): BoardSide {
    const onAim = playerAim(player);
    return onAim === null ? side : { ...side, status: { ...side.status, aim: { onAim } } };
  }

  /**
   * A seat's row in the rail: pressable while the table asks about a player, and
   * marked while the attack picker is aimed at that seat.
   *
   * The rail is the pod for every seat at a table of more than two, so it answers
   * the same slot the pod does and reads the same map. The attacked mark is only
   * a mark: the picker lives in the combat band beside the creatures that go at
   * the seat (`./attack-targets.ts`), and a rail that picked as well would be a
   * second door onto one choice.
   */
  function railRow(entry: SeatRailEntry): SeatRailEntry {
    const onAim = playerAim(entry.seat);
    const attacked = staging.targets?.picked === defenderKey({ seat: entry.seat });
    return {
      ...entry,
      ...(onAim === null ? {} : { aim: { onAim } }),
      ...(attacked ? { attacked } : {}),
    };
  }

  /**
   * Pressing one of the blockers while a damage assignment order is being built.
   *
   * `withPress`'s one rule reached from the board rather than a second one: the
   * press places the creature next in its attacker's order, or takes it back out
   * if it is already placed. Which attacker's order is not a question the player
   * answers — a blocker blocks exactly one attacker (CR 509.1a), so the group is
   * a lookup.
   */
  function pressOrderBlocker(key: string): void {
    const control = selection.ordering;
    if (control === null) return;
    const group = groupOf(control.plan, key);
    const blocker = group?.blockers.find((one) => one.oid === key);
    if (group === null || blocker === undefined) return;
    control.press(group, blocker);
  }

  /**
   * Pressing one of your own creatures while a block is being assembled.
   *
   * One rule, and it is `rosterPress`'s rather than a second one written for the
   * table: a creature the kernel gives one attacker toggles between blocking it
   * and not, and a creature it gives several opens the question of which. The
   * only thing added here is the way out — pressing the creature whose question
   * is open closes it — because on the board that press is the gesture a player
   * reaches for and the panel's Back button is a column away.
   */
  function pressBlocker(key: string): void {
    if (declaration === null) return;
    if (block.asking === key) {
      declaration.back('board');
      return;
    }
    const subject = declaration.plan.subjects.find((one) => one.oid === key);
    if (subject === undefined) return;
    declaration.press(subject, 'board');
  }

  /** Whether this row holds creatures the pending block or order is asking about. */
  const subjectsOn = (row: BattlefieldProps): boolean =>
    blocking && row.permanents.some((permanent) => block.pressable.has(permanent.key));

  /**
   * One opponent's battlefield, wired for whatever the table is asking.
   *
   * A function of the row rather than of `position.opponent`, because a pod has
   * several opponents and every one of them is a row an attacker may stand on, a
   * blocker may be ordered on and a spell may be aimed at (`mtg-bc2.154.6.5.4`).
   * The stages below are the ones the duel's opponent has always gone through, in
   * the same order, and a duel calls this once.
   */
  function wireOpponent(row: BattlefieldProps): BattlefieldProps {
    /**
     * The opponent's row, with the attackers that answer an open question wired to
     * answer it.
     *
     * Wiring the *row* is what makes the band answerable, and that is the property
     * `../../board/CombatZone.ts` was built with: an attacker in the seam is the
     * identical node the row would have drawn, handlers and all. So the second
     * half of the gesture costs no change to the band.
     *
     * Untouched at every other moment — not merely inert but the same object the
     * projection produced — because an opposing permanent is not the viewer's to
     * click and this is the one decision where CR 509.1a makes one of them an
     * answer to a question the viewer is being asked.
     */
    const litAttackers =
      block.answers.size === 0 || declaration === null
        ? row
        : {
            ...row,
            permanents: row.permanents.map((permanent) => ({
              ...permanent,
              playable: block.answers.has(permanent.key),
            })),
            onSelect: (permanent: BoardPermanent): void => {
              const asking = block.asking;
              if (asking === null || !block.answers.has(permanent.key)) return;
              // The attacker second: answering the question is what stops it being
              // a control, and the creature that asked it is still one.
              keep(asking, permanent.key);
              declaration.assign(asking, permanent.key, 'board');
            },
          };
    /**
     * The same row one decision later, with the blockers wired to place themselves
     * in the damage assignment order and each placed one wearing its number.
     *
     * The second moment an opposing permanent is a control, and it is the same
     * argument as the first: CR 509.2 asks the *attacking* player to order the
     * creatures blocking their attacker, so those creatures are half of a move this
     * viewer is the one being asked for. The rail's panel is still the keyboard and
     * screen-reader path and still lists every blocker; this is the board saying the
     * same thing where the player is looking.
     *
     * Ordering and blocking are two different decisions, so at most one of these
     * rows is ever lit — `ordering` is empty through the whole of a block and
     * `block.answers` through the whole of an ordering.
     */
    const litBlockers = !ordering
      ? litAttackers
      : {
          ...litAttackers,
          permanents: litAttackers.permanents.map((permanent) => {
            const place = order.places.get(permanent.key);
            return {
              ...permanent,
              playable: order.pressable.has(permanent.key),
              ...(place === undefined ? {} : { damageOrder: place }),
            };
          }),
          onSelect: (permanent: BoardPermanent): void => {
            keep(permanent.key);
            pressOrderBlocker(permanent.key);
          },
        };
    /**
     * The third moment an opposing permanent is a control, and the only one that
     * is not about combat: a spell being aimed (`mtg-bz2.6`).
     *
     * It replaces whatever the two rows above said rather than joining it, which
     * is the same rule the viewer's own row follows below and for a stronger
     * reason: the answers to an open slot are the *whole* of what may be pressed
     * at that moment, and a card left pressable for some other reason would be a
     * card whose click does something other than answer the question on screen.
     *
     * `aim` is non-null exactly when `aiming` is, and the check is written on it
     * so the closure has the control rather than a flag derived from it.
     */
    const aimedOpponent =
      aim === null
        ? litBlockers
        : {
            ...litBlockers,
            permanents: litBlockers.permanents.map((permanent) => ({
              ...permanent,
              playable: target.answers.has(permanent.key),
            })),
            onSelect: (permanent: BoardPermanent): void => {
              keep(permanent.key);
              aim.aim(permanent.key);
            },
          };
    const enumeratedOpponent =
      aim !== null || blocking || ordering
        ? aimedOpponent
        : {
            ...aimedOpponent,
            permanents: aimedOpponent.permanents.map((permanent) => ({
              ...permanent,
              playable: byObject.has(permanent.key),
            })),
            onSelect: (permanent: BoardPermanent): void => {
              keep(permanent.key);
              selection.select(permanent.key);
            },
            onActivate: (permanent: BoardPermanent): void => selection.activate(permanent.key),
            onMenu: (permanent: BoardPermanent): void => selection.openMenu(permanent.key),
            pickerFor: selection.pickerFor,
          };
    // The one decision where the opposing side is the subject of the question
    // rather than an answer to it: the seat is being asked which of *its* creatures
    // to place, so those are pressable and the assignment they make is what is drawn.
    if (!subjectsOn(row)) return enumeratedOpponent;
    return {
      ...enumeratedOpponent,
      permanents: enumeratedOpponent.permanents.map((permanent) => {
        const assigned = block.assigned.get(permanent.key);
        return {
          ...permanent,
          playable: block.pressable.has(permanent.key),
          ...(assigned === undefined
            ? {}
            : { stagedBlock: assigned.label, stagedBlockKeys: assigned.attackers }),
        };
      }),
      ...(block.asking === null ? {} : { selectedKey: block.asking }),
      onSelect: (permanent: BoardPermanent): void => {
        pressBlocker(permanent.key);
      },
    };
  }
  // Playability comes from the enumeration, so the hand cannot advertise a card
  // the kernel would refuse to let you cast right now. Hand card keys are object
  // ids, which is what makes this a lookup rather than a guess.
  //
  // It is the *whole* enumeration rather than the castable part of it
  // (`mtg-bz2.9`). A discard and a London bottoming are choices the kernel keys
  // to cards in your hand — `oidsOf` says so outright, "so a keep is a click on
  // the card it pays with, exactly as a discard is" — and reading only the casts
  // left every one of them answerable in the rail and nowhere else, with the
  // named cards sitting inert two inches under the question asking for them.
  // The battlefield has read `byObject` all along; this is that one rule.
  //
  // While a target is being chosen the only card left lit is the spell doing the
  // aiming, and it is lit because clicking it is the way out: `select` on the
  // card whose panel is open closes the panel, which is the cast's cancel. Every
  // other card in hand is a card whose click would abandon the aim to start
  // something else, and that is the gesture this state exists to stop.
  const litHand =
    hand === undefined
      ? undefined
      : {
          ...hand,
          cards: hand.cards.map((card) => ({
            ...card,
            playable: aim === null ? byObject.has(card.key) : card.key === aim.oid,
          })),
          onSelect: (card: HandCard): void => {
            if (aiming && card.key !== aim?.oid) return;
            selection.select(card.key);
          },
          onActivate: (card: HandCard): void => {
            if (aiming) return;
            selection.activate(card.key);
          },
          onMenu: (card: HandCard): void => {
            if (aiming) return;
            selection.openMenu(card.key);
          },
          pickerFor: selection.pickerFor,
        };
  // The commander answers to the same three gestures as a held card, and for
  // the same reason: a cast from the command zone is a cast (`CR 903.8`), and
  // the backend declares it as one through `objectActions`, so `byObject` is
  // the whole of whether the card is a button.
  const command = you.commandZone;
  const litCommand =
    command === undefined
      ? undefined
      : {
          ...command,
          commanders: command.commanders.map((card) => ({
            ...card,
            playable: aim === null ? byObject.has(card.key) : card.key === aim.oid,
          })),
          onSelect: (card: CommanderCard): void => {
            if (aiming && card.key !== aim?.oid) return;
            selection.select(card.key);
          },
          onActivate: (card: CommanderCard): void => {
            if (aiming) return;
            selection.activate(card.key);
          },
          onMenu: (card: CommanderCard): void => {
            if (aiming) return;
            selection.openMenu(card.key);
          },
          pickerFor: selection.pickerFor,
        };
  const avatars = you.avatars;
  const litAvatars =
    avatars === undefined
      ? undefined
      : {
          ...avatars,
          cards: avatars.cards.map((card) => ({
            ...card,
            playable: aim === null ? byObject.has(card.key) : card.key === aim.oid,
          })),
          onSelect: (card: HandCard): void => {
            if (aiming && card.key !== aim?.oid) return;
            selection.select(card.key);
          },
          onActivate: (card: HandCard): void => {
            if (aiming) return;
            selection.activate(card.key);
          },
          onMenu: (card: HandCard): void => {
            if (aiming) return;
            selection.openMenu(card.key);
          },
          pickerFor: selection.pickerFor,
        };
  // And so does a public top card of the library (Oracle of Mul Daya): the
  // backend offers the land play or the cast through `objectActions` exactly as
  // it does for a held card, so the same map lights it.
  const revealedTop = you.libraryTop;
  const litTop =
    revealedTop === undefined
      ? undefined
      : {
          ...revealedTop,
          cards: revealedTop.cards.map((card) => ({
            ...card,
            playable: aim === null ? byObject.has(card.key) : card.key === aim.oid,
          })),
          onSelect: (card: HandCard): void => {
            if (aiming && card.key !== aim?.oid) return;
            selection.select(card.key);
          },
          onActivate: (card: HandCard): void => {
            if (aiming) return;
            selection.activate(card.key);
          },
          onMenu: (card: HandCard): void => {
            if (aiming) return;
            selection.openMenu(card.key);
          },
          pickerFor: selection.pickerFor,
        };
  // A key with no entry in the map is a permanent with nothing to do — except
  // while attackers are being declared, where a creature the kernel says may
  // attack is clickable whether or not it also has a picker's worth of moves.
  const litField = {
    ...you.battlefield,
    permanents: you.battlefield.permanents.map((permanent) => {
      const assigned = block.assigned.get(permanent.key);
      return {
        ...permanent,
        // While a block is being assembled the kernel's per-creature statement
        // is the whole of what may be pressed, and it *replaces* the enumeration
        // rather than joining it. Two reasons, and the second is the defect.
        // `Decision.candidates` is linear in the board and no cap can reach it,
        // where `byObject` is read off the 512-option prefix and a crowded
        // combat drops creatures out of it entirely (`declare.ts`). And a
        // creature reachable through `byObject` at this decision is a creature
        // whose click submits a whole enumerated declaration — measured at 108
        // legal blocks, one click on a card opened 72 of them in a picker.
        // A spell being aimed replaces both of the readings below, for
        // `aimedOpponent`'s reason: while a slot is open the answers to it are
        // the whole of what may be pressed on either side of the table.
        playable: aiming
          ? target.answers.has(permanent.key)
          : blocking
            ? block.pressable.has(permanent.key)
            : byObject.has(permanent.key) || staging.eligible.has(permanent.key),
        ...(staging.staged.has(permanent.key) ? { staged: true } : {}),
        ...(assigned === undefined
          ? {}
          : { stagedBlock: assigned.label, stagedBlockKeys: assigned.attackers }),
      };
    }),
    // The creature whose question is open, drawn as selected. A different
    // channel from the amber "you may act on this" every pressable creature
    // wears, because they are different sentences and both are true of it.
    ...(block.asking === null ? {} : { selectedKey: block.asking }),
    onSelect: (permanent: BoardPermanent): void => {
      keep(permanent.key);
      if (aim !== null) {
        aim.aim(permanent.key);
        return;
      }
      if (blocking) {
        pressBlocker(permanent.key);
        return;
      }
      if (staging.eligible.has(permanent.key)) {
        staging.toggle(permanent.key);
        return;
      }
      selection.select(permanent.key);
    },
    // And the other two gestures answer nothing at all on a creature that is
    // being staged, which is the confirm boundary defended at the input end.
    // `selection.activate` submits a card's default move and `openMenu` lists
    // its options with a button apiece; on this decision every one of those
    // options is a whole attack declaration, so either gesture would commit the
    // player to an attack they were still building. The complete enumeration is
    // still in the ask column, by index and by keyboard, which is where a player
    // who wants to declare in one press goes (`rail.ts` holds that contract).
    //
    // A tap arrives here too. `../../card/press.ts` sends the first press to
    // `onSelect` and a repeat press to `onActivate`, so on a tablet the first
    // tap stages the creature and the second does nothing rather than declaring
    // behind the confirm.
    //
    // A spell being aimed is the same refusal on the same grounds: a double
    // click or a right click during a target choice would play some other move
    // while a question is still on screen, and the question is one click from
    // being answered.
    onActivate: (permanent: BoardPermanent): void => {
      if (aiming || blocking || staging.eligible.has(permanent.key)) return;
      selection.activate(permanent.key);
    },
    onMenu: (permanent: BoardPermanent): void => {
      if (aiming || blocking || staging.eligible.has(permanent.key)) return;
      selection.openMenu(permanent.key);
    },
    pickerFor: selection.pickerFor,
  };
  const opponentRows: readonly BattlefieldProps[] = [
    position.opponent.battlefield,
    ...(position.pod?.others.map((other) => other.side.battlefield) ?? []),
  ];
  const blockSubjectsOnOpponent = opponentRows.some(subjectsOn);
  const authorityField = !blockSubjectsOnOpponent
    ? litField
    : {
        ...litField,
        permanents: litField.permanents.map((permanent) => ({
          ...permanent,
          playable: block.answers.has(permanent.key),
        })),
        onSelect: (permanent: BoardPermanent): void => {
          const asking = block.asking;
          if (asking === null || declaration === null || !block.answers.has(permanent.key)) return;
          declaration.assign(asking, permanent.key, 'board');
        },
      };
  // One spread, applied to each zone that draws a keyed face, so a zone cannot
  // be given the highlight in one arrangement and left out of it in another.
  const pointing = input.pointed === undefined ? {} : { pointed: input.pointed };
  const enumeratedStack = new Set(
    position.stack.entries.flatMap((entry) => (byObject.has(entry.key) ? [entry.key] : [])),
  );
  const choosingOutsideOwnBoard =
    enumeratedStack.size > 0 ||
    opponentRows.some((row) => row.permanents.some((permanent) => byObject.has(permanent.key))) ||
    (input.byPlayer?.size ?? 0) > 0;
  const opponent = {
    ...position.opponent,
    battlefield: { ...wireOpponent(position.opponent.battlefield), ...pointing },
  };
  const pod = position.pod;
  return createElement(Board, {
    ...position,
    // A pod's opponents answer through the rail, which carries their aim; a duel's
    // one opponent answers through its own pod.
    opponent: pod === undefined ? aimedPod(opponent, other) : opponent,
    ...(pod === undefined
      ? {}
      : {
          pod: {
            ...pod,
            rail: { ...pod.rail, seats: pod.rail.seats.map(railRow) },
            others: pod.others.map((one) => ({
              ...one,
              side: { ...one.side, battlefield: { ...wireOpponent(one.side.battlefield), ...pointing } },
            })),
          },
        }),
    you: aimedPod(
      {
        ...you,
        battlefield: { ...authorityField, ...pointing },
        ...(litHand === undefined ? {} : { hand: { ...litHand, ...pointing } }),
        ...(litCommand === undefined ? {} : { commandZone: { ...litCommand, ...pointing } }),
        ...(litAvatars === undefined ? {} : { avatars: { ...litAvatars, ...pointing } }),
        ...(litTop === undefined ? {} : { libraryTop: { ...litTop, ...pointing } }),
      },
      input.viewer,
    ),
    aiming: aiming || choosingOutsideOwnBoard,
    prompt,
    ...(input.askHead === undefined ? {} : { askHead: input.askHead }),
    ...(input.askCollapsed === undefined ? {} : { askCollapsed: input.askCollapsed }),
    ...(input.askFlyout === undefined ? {} : { askFlyout: input.askFlyout }),
    ...(input.beat === undefined ? {} : { beat: input.beat }),
    steps,
    ...(input.seam === undefined ? {} : { seam: input.seam }),
    ...(input.seamStyle === undefined ? {} : { seamStyle: input.seamStyle }),
    rail,
    combat,
    railHead: input.railHead,
    railCollapsed: input.railCollapsed,
    stack: {
      ...position.stack,
      ...(input.onResolve === null ? {} : { onResolve: input.onResolve }),
      // The third door the bead asked for: an object on the stack is aimed at by
      // pressing the object, not by finding its line in the panel's column
      // (`mtg-bz2.16`). Absent unless a slot is open and names one, so the strip
      // is untouched at every other moment.
      ...(aim === null
        ? enumeratedStack.size === 0
          ? {}
          : {
              aim: {
                answers: enumeratedStack,
                onAim: (key: string): void => selection.select(key),
              },
            }
        : target.spells.size === 0
          ? {}
          : {
              aim: {
                answers: target.spells,
                onAim: (key: string): void => {
                  aim.aimSpell(key);
                },
              },
            }),
    },
  });
}
