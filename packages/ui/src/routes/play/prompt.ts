/**
 * The kernel's pending decision, in words a person can act on.
 *
 * This module labels; it never decides. Every choice it returns is an index
 * into `decision.options`, so the set of things the UI can offer is exactly the
 * set the kernel already ruled legal from this state. There is deliberately no
 * path here that builds an `Action`: if a move is not in the enumeration, no
 * amount of clicking can reach it, which is the difference between an illegal
 * action being unrepresentable and it being rejected after the fact.
 *
 * `truncated` matters and is not decoration. `pendingDecision` caps enumeration,
 * and a capped list means legal moves exist that are not on screen. Saying so is
 * the honest option; quietly showing 200 of 4,000 blocker assignments as though
 * they were all of them is not.
 */
import {
  effectsFor,
  formatManaCost,
  isAttachingAbility,
  renderAbility,
  renderEffect,
  renderOracleText,
} from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId, Step } from '@mtg/kernel';
import { abilityAt, triggerOnStack, tryObject } from '@mtg/kernel';
import { seatMention, seatVerb } from '../../seat';
import { describeTarget, distinguishingLine, nameOf, permanentName, targetName } from './naming';
import type { SeatNames } from './position';

export interface PlayChoice {
  /** Index into `decision.options`. The only thing the UI ever submits. */
  readonly index: number;
  readonly label: string;
  readonly detail: string | null;
  readonly kind: Action['type'];
  /**
   * Objects this choice acts on. It is what makes a card on the table
   * clickable: `playableFromHand` and `choicesByObject` both read it, and a
   * card's picker holds the choices that name it. Nothing draws anything from
   * it on hover; the shipped sheet has no such rule, and the claim that it did
   * outlived the design it came from.
   */
  readonly oids: readonly ObjectId[];
}

export interface PlayPrompt {
  /** What the game is waiting for, as a heading. */
  readonly headline: string;
  /** One sentence of context under it. */
  readonly explain: string;
  readonly choices: readonly PlayChoice[];
  /** True when the kernel capped enumeration and legal moves are off-screen. */
  readonly truncated: boolean;
}

const STEP_LABELS: Readonly<Record<Step, string>> = {
  untap: 'untap',
  upkeep: 'upkeep',
  draw: 'draw step',
  precombatMain: 'main phase',
  beginCombat: 'beginning of combat',
  declareAttackers: 'declare attackers',
  declareBlockers: 'declare blockers',
  firstStrikeDamage: 'first-strike damage',
  combatDamage: 'combat damage',
  endCombat: 'end of combat',
  postcombatMain: 'second main phase',
  end: 'end step',
  cleanup: 'cleanup',
};

/**
 * One step, in the words the board header already uses for it.
 *
 * Exported so the stop-set controls label their rows from the same table the
 * header reads. Two surfaces naming the same step differently is how a player
 * ends up unable to find the setting for the thing the game just said.
 */
export function stepLabel(step: Step): string {
  return STEP_LABELS[step];
}

/**
 * The same thirteen steps in the words a phase bar has room for.
 *
 * The playtester's own list (`mtg-bz2.1`), which is what a Magic player calls these
 * steps when they are naming them rather than reading a sentence about one:
 * `UNTAP UPKEEP DRAW MAIN 1 BEGIN COMBAT ATTACK BLOCK DAMAGE END COMBAT MAIN 2
 * END CLEANUP`. First-strike damage is the thirteenth and is not on her list,
 * because it is entered only when a creature with first or double strike is in
 * combat; `PhaseBar.ts` says what the bar does about that.
 *
 * A second wording of a step is a real risk and this is the second half of the
 * answer to it. The bar's own accessible name carries this word *and*
 * `stepLabel`'s wherever the two differ, so nothing on screen names a step in
 * words the board header would not use — the abbreviation is a visual
 * shortening, not a second vocabulary, and it lives in this table beside the one
 * it shortens rather than in the component that draws it.
 */
const STEP_ABBREVIATIONS: Readonly<Record<Step, string>> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  precombatMain: 'Main 1',
  beginCombat: 'Begin combat',
  declareAttackers: 'Attack',
  declareBlockers: 'Block',
  firstStrikeDamage: 'First strike',
  combatDamage: 'Damage',
  endCombat: 'End combat',
  postcombatMain: 'Main 2',
  end: 'End',
  cleanup: 'Cleanup',
};

/** One step, short enough to sit on a bar of all thirteen of them. */
export function stepAbbreviation(step: Step): string {
  return STEP_ABBREVIATIONS[step];
}

/**
 * `Turn 7 · main phase · Player one` for the board header, the last field being
 * the seat whose turn it is.
 *
 * Named rather than relative. "Your turn" is a sentence with two answers once
 * two people share a screen, and the seat it would resolve against now changes
 * hands mid-turn, because the board follows whoever is being asked: the header
 * would have reworded itself every time priority crossed the table while the
 * turn it describes stayed exactly where it was.
 */
export function describeStep(state: GameState, names: SeatNames): string {
  const step = STEP_LABELS[state.turn.step];
  return `Turn ${String(state.turn.number)} · ${step} · ${names[state.turn.active]}`;
}

/**
 * `Turn 7: You` — the same sentence with the step taken out of it.
 *
 * For the strip badge, which sits beside a bar that names all thirteen steps and
 * boxes the one the game is in (`mtg-rgc.2`). Repeating the step there is the
 * same fact twice in the widest element on the row, and the row is short of
 * width. Magic Online writes exactly this and nothing more: `Turn 18: BswizzM…`.
 *
 * The seat is named rather than relative, for the reason `describeStep` gives.
 */
export function describeTurn(state: GameState, names: SeatNames): string {
  return `Turn ${String(state.turn.number)}: ${names[state.turn.active]}`;
}

/**
 * A run of permanents in one label, each named so no two of them read alike.
 *
 * `permanentName` rather than `nameOf`: an attack declaration lists the seat's
 * own creatures, and two copies of one creature under one controller are the
 * case `mtg-cee`'s possessive cannot separate. `Attack with Emberflow Raider,
 * Emberflow Raider` is two enumerated moves' worth of ambiguity inside a single
 * label.
 */
function listNames(state: GameState, oids: readonly ObjectId[]): string {
  return oids.map((oid) => permanentName(state, oid)).join(', ');
}

/** A scry group names its ordered cards, or says explicitly that it is empty. */
function scryGroupNames(state: GameState, oids: readonly ObjectId[]): string {
  return oids.length === 0 ? 'nothing' : listNames(state, oids);
}

/**
 * What a label puts between the act and the objects the act is aimed at.
 *
 * Exported because `rail.ts` reads it: twelve activations of one ability are
 * twelve labels that differ only after this separator, and the rail prints the
 * part before it once. A separator two files spell for themselves is a
 * separator they can disagree about, and the disagreement would be silent —
 * the rail would simply stop folding and nobody would know why.
 */
export const TARGET_ARROW = ' → ';

function targetSuffix(state: GameState, names: SeatNames, action: Action): string {
  if (
    action.type !== 'castSpell' &&
    action.type !== 'activateAbility' &&
    action.type !== 'chooseTriggerTargets'
  ) {
    return '';
  }
  const chosen = action.targets.filter((target) => target !== null);
  if (chosen.length === 0) return '';
  return `${TARGET_ARROW}${chosen.map((target) => describeTarget(state, names, target)).join(', ')}`;
}

/**
 * The printed line of a triggered ability sitting on the stack, or `null` when
 * the entry has gone.
 *
 * Read off the source's card by the same `renderAbility` both card faces print
 * from, for the reason `abilityWords` reads an activation's line the same way: a
 * button that says "choose targets" is a button that has told the player
 * nothing, and the sentence they are aiming is printed on the permanent that
 * triggered.
 */
function triggerLine(state: GameState, oid: ObjectId): string | null {
  const pending = triggerOnStack(state, oid);
  if (pending === null) return null;
  const source = tryObject(state, pending.source);
  return source === undefined ? null : renderAbility(pending.ability, source.card.name);
}

/**
 * `triggerLine`'s reason applied to a spell rather than an ability: the button
 * label already says which spell, but not what it does, and a "you may" spell
 * offers no other line on screen that says so.
 */
function spellLine(state: GameState, oid: ObjectId): string | null {
  const object = tryObject(state, oid);
  return object === undefined ? null : renderOracleText(object.card);
}

/**
 * CR 601.2b's announced mode, in the words the staged cast panel already offers
 * it (`cast.ts`'s `CastOption.effects`), or `''` on a cast that announced none.
 *
 * A mode carries only its own `effects` list — `@mtg/dsl`'s `Mode` has no
 * separate printed line to read — so this is the one derivation of what a mode
 * says rather than a second phrasing invented for this file. It has to be a
 * second *call* of that derivation regardless, because `cast.ts` builds
 * `CastOption` from `Decision.options` before a card is chosen and this label is
 * built from a bare `Action`; the two are read off the same `effectsFor` and
 * `renderEffect` so the words agree even though the code does not share a line.
 *
 * `mtg-rvi8`: without this, two casts of one modal card that differ only in the
 * mode announced print one label for both — `Cast Split Decision` twice over,
 * on a board where one option burns a creature and the other gains life. The
 * mode is not an object, so `oidsOf` never lists it and nothing else in this
 * file's vocabulary said which mode a row was.
 */
function modeWords(state: GameState, action: Extract<Action, { type: 'castSpell' }>): string {
  if (action.mode === undefined) return '';
  const object = tryObject(state, action.oid);
  if (object === undefined) return '';
  const sentences = effectsFor(object.card, action.mode).map((effect) =>
    renderEffect(effect, object.card.name),
  );
  return ` — ${sentences.join(' ')}`;
}

/** An activation as a button reads it: what it does, and why you would press it. */
interface AbilityWords {
  /** The label. Always the move itself, never the state it leaves behind. */
  readonly act: string;
  /** What the label does not already say, or null when it says everything. */
  readonly note: string | null;
}

/**
 * The printed line of the ability an activation pays for.
 *
 * Read off the source's own card rather than carried in the action, because the
 * action holds an index and a button holding an index is the blank button this
 * function exists to prevent. `renderAbility` is the same function both card
 * faces print from, so the text on the button is the text on the card.
 *
 * An equip ability is the one that does not fit on one line, and printing it as
 * though it did is what this split fixes. CR 702.6b's clause carries its meaning
 * in `attach` and prints as Magic's two lines — `Equipped creature gets +2/+0.`
 * then `Equip {2}` — so before the split the rail offered
 * `Activate Equipped creature gets +2/+0. Equip {2} → Merfolk Sentry`, a button
 * that opens by announcing a static ability nobody is activating. The keyword
 * line is the move; the grant clause is the reason, and it rides in the detail
 * beside the weapon's name.
 *
 * The rendered text is split rather than rebuilt from `ability.attach`, because
 * `renderAbility` is the one printer on this surface and a second one here could
 * disagree with the card face about the same clause. The last line is the equip
 * line — it is the half carrying the cost — and everything before it is the
 * grant, which holds whatever `modificationClause` produced without this
 * function needing to know what that was.
 */
function abilityWords(state: GameState, action: Extract<Action, { type: 'activateAbility' }>): AbilityWords {
  const object = tryObject(state, action.oid);
  const ability = abilityAt(state, action.oid, action.abilityIndex);
  if (object === undefined || ability === undefined) {
    return { act: `Activate ability ${String(action.abilityIndex + 1)}`, note: null };
  }
  const printed = renderAbility(ability, object.card.name);
  if (!isAttachingAbility(ability)) return { act: `Activate ${printed}`, note: null };
  const lines = printed.split('\n');
  const act = lines[lines.length - 1] ?? printed;
  const grant = lines.slice(0, -1).join(' ');
  return { act, note: grant.length === 0 ? null : grant };
}

/**
 * The objects a choice acts on, which is what makes a card on the table
 * clickable.
 *
 * It takes the state for one branch only: an `answerOptionalTrigger` names an
 * ability object, and an ability on the stack has no card and is drawn nowhere,
 * so the clickable thing is the permanent that printed it.
 */
function oidsOf(state: GameState, action: Action): readonly ObjectId[] {
  switch (action.type) {
    case 'playLand':
    case 'castSpell':
    case 'activateManaAbility':
    case 'activateAbility':
      return [action.oid];
    case 'chooseTriggerTargets':
      // The targets rather than the ability, which is what makes aiming a
      // trigger a click on the creature being aimed at. The ability object has
      // no card and is drawn nowhere, so naming it here would produce a picker
      // hanging off nothing.
      return action.targets.flatMap((target) =>
        target !== null && target.kind !== 'player' ? [target.oid] : [],
      );
    case 'answerOptionalTrigger': {
      // The permanent that triggered, so both answers hang off the card whose
      // printed line is being answered.
      const pending = triggerOnStack(state, action.oid);
      return pending === null ? [] : [pending.source];
    }
    case 'answerMay':
    case 'answerUnless':
      // Unlike a triggered ability, a spell answering "you may" is a card
      // object in its own right (`getObject` finds it directly), so the click
      // target is `oid` itself rather than a source it points back to. A toll
      // is answered on the same card for the same reason, even though the
      // player clicking is the one it is aimed at rather than its caster.
      return [action.oid];
    case 'declareAttackers':
      return action.attackers.map((attack) => attack.oid);
    case 'declareBlockers':
      return action.blocks.flatMap((block) => [block.blocker, block.attacker]);
    case 'orderBlockers':
      return action.orders.flatMap((order) => [order.attacker, ...order.blockers]);
    case 'discard':
    case 'chooseDiscards':
      return action.oids;
    case 'keepHand':
      // The cards going to the bottom, so a keep is a click on the card it pays
      // with, exactly as a discard is.
      return action.bottom;
    case 'keepLegend':
      // The survivor, so choosing which legend to keep is a click on it.
      return [action.oid];
    case 'sacrificePermanent':
      // The creature named, so choosing which one to sacrifice is a click on
      // it — `keepLegend`'s reason above, aimed at the opposite outcome.
      return [action.oid];
    case 'scry':
      return [...action.top, ...action.bottom];
    case 'searchLibrary':
      // Failing to find names no object, so that option hangs off nothing and
      // is clicked in the list rather than on the table.
      return action.found === null ? [] : [action.found];
    case 'chooseFromGraveyard':
      // Same shape, and here the click has somewhere real to land: a graveyard
      // is drawn, so the card being taken back is on the table already.
      return action.chosen === null ? [] : [action.chosen];
    case 'mulligan':
    case 'passPriority':
    case 'concede':
      return [];
  }
}

function labelOf(state: GameState, names: SeatNames, action: Action): string {
  switch (action.type) {
    case 'passPriority':
      return state.stack.length > 0 ? 'Let it resolve' : 'Pass';
    case 'playLand':
      return `Play ${nameOf(state, action.oid)}`;
    case 'castSpell':
      return `Cast ${nameOf(state, action.oid)}${modeWords(state, action)}${action.x === undefined ? '' : ` (X=${String(action.x)})`}${targetSuffix(state, names, action)}`;
    case 'activateManaAbility':
      // Two untapped basic Plains print one line twice, and that is right: they
      // are the same card in the same state, so the kernel's two options are
      // interchangeable and a player cannot pick the wrong one. `permanentName`
      // is what makes that a measured statement rather than a hopeful one — the
      // moment one of them is holding something or carrying damage, the two
      // lines come apart.
      return `Tap ${permanentName(state, action.oid)} for ${action.color}`;
    case 'activateAbility':
      // The cost and the effect, in the card's own words. The source is named
      // in the detail line rather than here, because an effect that says
      // nothing about its source ("You gain 1 life.") still has to say which
      // permanent is being paid for, and one that does say it twice reads as a
      // stutter.
      //
      // The announced X is appended for the reason the cast arm appends it: the
      // card's own words are the same words for every value of it, so an
      // `{X}{G}{G}` ability offered at seven values would otherwise print seven
      // identical buttons and the player could not aim at six.
      return `${abilityWords(state, action).act}${action.x === undefined ? '' : ` (X=${String(action.x)})`}${targetSuffix(state, names, action)}`;
    case 'declareAttackers': {
      if (action.attackers.length === 0) return 'Attack with nothing';
      const attackers = `Attack with ${listNames(
        state,
        action.attackers.map((attack) => attack.oid),
      )}`;
      return action.attackers.some((attack) => typeof attack.defender !== 'number')
        ? `${attackers} — ${action.attackers
            .map(
              (attack) =>
                `${nameOf(state, attack.oid)} attacks ${
                  typeof attack.defender === 'number'
                    ? names[attack.defender]
                    : targetName(state, names, attack.defender.oid)
                }`,
            )
            .join('; ')}`
        : attackers;
    }
    case 'declareBlockers':
      return action.blocks.length === 0
        ? 'No blocks'
        : action.blocks
            .map((block) => `${nameOf(state, block.blocker)} blocks ${nameOf(state, block.attacker)}`)
            .join('; ');
    case 'orderBlockers':
      return action.orders
        .map((order) => `${nameOf(state, order.attacker)}: ${listNames(state, order.blockers)}`)
        .join('; ');
    case 'discard':
      return `Discard ${listNames(state, action.oids)}`;
    case 'mulligan':
      return 'Mulligan';
    case 'keepHand':
      return action.bottom.length === 0
        ? 'Keep this hand'
        : `Keep, bottoming ${listNames(state, action.bottom)}`;
    case 'chooseTriggerTargets': {
      // The targets are the whole of this choice — every option on screen is
      // the same ability — so they are the label, and the printed line is the
      // detail underneath.
      //
      // The arrow is kept rather than sliced off, and that is the difference
      // between this decision folding and never folding. It is definitionally
      // one ability aimed N ways, which is the exact shape `rail.ts` prints
      // once above a run; written as `Aim at X` it carried no `TARGET_ARROW`,
      // so `sharedKey` returned null on every option and every run was a run of
      // one. An untargeted slot names nobody and has no arrow to keep, which
      // happens when one of two effects targets and the other does not.
      const aimed = targetSuffix(state, names, action);
      return aimed.length === 0 ? 'Choose no targets' : `Aim${aimed}`;
    }
    case 'answerOptionalTrigger':
      return action.accept ? 'Take the trigger' : 'Decline the trigger';
    case 'answerMay':
      return action.accept ? `Resolve ${nameOf(state, action.oid)}` : `Decline ${nameOf(state, action.oid)}`;
    case 'answerUnless':
      // The price is not in the label. It is the same on both buttons, so it
      // belongs in the sentence above them where it is said once, and a label
      // reading "Pay {2}" beside one reading "Let it resolve" invites the
      // reading that declining is the free one.
      return action.pay ? 'Pay the cost' : `Let ${nameOf(state, action.oid)} resolve`;
    case 'keepLegend':
      // Every option here is the same card name, so the name alone would print
      // the same line once per copy. `optionLabels`-style disambiguation lives
      // in the replay viewer; here the detail line carries what separates them,
      // which is why this one keeps the bare name while every other label takes
      // `permanentName` — the qualifier would be printed twice on one button.
      return `Keep this ${nameOf(state, action.oid)}`;
    case 'sacrificePermanent':
      // `keepLegend`'s reasoning above at the opposite word: every option here
      // is a creature on this player's own board, so the bare name is what
      // distinguishes the buttons and `distinguishingLine` (`detailOf` below)
      // carries the rest.
      return `Sacrifice ${nameOf(state, action.oid)}`;
    case 'scry':
      return `Keep ${scryGroupNames(state, action.top)} on top; put ${scryGroupNames(state, action.bottom)} on the bottom`;
    case 'searchLibrary':
      return action.found === null ? 'Find nothing' : `Take ${nameOf(state, action.found)}`;
    case 'chooseFromGraveyard':
      return action.chosen === null ? 'Take nothing' : `Take ${nameOf(state, action.chosen)}`;
    case 'chooseDiscards':
      return `Discard ${listNames(state, action.oids)}`;
    case 'concede':
      return 'Concede';
  }
}

function detailOf(state: GameState, action: Action): string | null {
  switch (action.type) {
    case 'passPriority':
      return state.stack.length > 0 ? `${String(state.stack.length)} on the stack` : null;
    case 'activateAbility': {
      // `permanentName`, so two copies of one permanent offering one ability do
      // not produce two runs of buttons under two identical shared lines. The
      // rail folds a run on its label *and its detail* together, so this string
      // is half of what tells one fold from the next (`rail.ts`).
      const source = permanentName(state, action.oid);
      const note = abilityWords(state, action).note;
      // `sacrificeOther` (CR 601.2g) is paid by naming permanents, and
      // `legal.ts`'s `oneAbilityOptions` enumerates one activation per way of
      // paying it — so two activations of one ability can differ only in which
      // permanents this cost eats. `oidsOf` never lists a payment, only the
      // source, so without this line two such activations printed one detail
      // for both, whatever told the sacrificed permanents apart.
      const sacrifice =
        action.sacrifices.length === 0 ? null : `Sacrifice ${listNames(state, action.sacrifices)}`;
      return [source, note, sacrifice].filter((part): part is string => part !== null).join(' · ');
    }
    case 'chooseTriggerTargets':
    case 'answerOptionalTrigger':
      return triggerLine(state, action.oid);
    case 'answerMay':
    case 'answerUnless':
      return spellLine(state, action.oid);
    case 'keepLegend':
      // The label is the same word on every option, so this line carries the
      // whole difference: which of two identically named permanents this is.
      return distinguishingLine(state, action.oid);
    case 'sacrificePermanent':
      // Two candidates can share a name the same way two legends never do —
      // nothing in CR 701.17a requires the target's creatures to be distinct —
      // so this line carries the same disambiguation `keepLegend` needs.
      return distinguishingLine(state, action.oid);
    case 'declareAttackers':
      return action.attackers.length === 0 ? null : `${String(action.attackers.length)} attacking`;
    case 'declareBlockers':
      return action.blocks.length === 0 ? null : `${String(action.blocks.length)} blocking`;
    default:
      return null;
  }
}

function headlineFor(decision: Decision): string {
  switch (decision.kind) {
    case 'mulligan':
      return 'Opening hand';
    case 'priority':
      // The other four headlines name the act, not the actor. This one said
      // "Your priority", which was the only second person left on the surface
      // once the seats stopped being called "you" and "the opponent"; the seat
      // holding priority is named in the sentence under it instead.
      return 'Priority';
    case 'declareAttackers':
      return 'Declare attackers';
    case 'declareBlockers':
      return 'Declare blockers';
    case 'orderBlockers':
      return 'Order blockers';
    case 'discard':
      return 'Discard down to hand size';
    case 'triggerTargets':
      return 'Choose targets';
    case 'optionalTrigger':
      return 'Triggered ability';
    case 'may':
      // `optionalTrigger`'s headline just above names the mechanism rather
      // than quoting the card ("Triggered ability", not "You may"), and this
      // one has to for the same hotseat reason: the seat this headline is
      // for is not fixed the way it would be at a table with one player.
      return 'Optional spell';
    case 'unless':
      // `may`'s headline names the mechanism rather than quoting the card, and
      // this one names the act instead, because the mechanism has no name a
      // player would recognize: "unless clause" is a rules term and "Pay to
      // stop it" is the question.
      return 'Pay to stop it';
    case 'legendRule':
      return 'Legend rule';
    case 'scry':
      return 'Scry';
    case 'searchLibrary':
      // "Search your library" is what the card prints and what the neutral
      // contract's prompt says, and neither is this surface: a hotseat table
      // has two seats reading one screen, so the possessive names whichever of
      // them happens to be looking. The seat is named in the sentence below.
      return 'Search library';
    case 'graveyardChoice':
      // No possessive here either, and for a second reason on top of the
      // hotseat one: `whose: 'each'` reads both graveyards, so "your
      // graveyard" would be wrong about half the cards on offer rather than
      // merely wrong about which seat is reading.
      return 'Choose from a graveyard';
    case 'handDiscard':
      // Not "Discard down to hand size", which is `discard`'s headline above
      // and describes a different rule. Two headlines here rather than one,
      // because the two effects that reach this decision cost opposite seats
      // their cards and a hotseat table has both of them reading the screen.
      return decision.owner === decision.player ? 'Discard' : 'Choose their discard';
    case 'permanentSacrifice':
      return 'Sacrifice a creature';
  }
}

/**
 * Every seat by name, never by pronoun.
 *
 * A prompt is written for one seat, so second person was accurate per viewer
 * and still wrong here: two people share this screen and the seat the sentence
 * addresses changes with every decision. `decision.player` is the seat the
 * kernel is waiting on, which is exactly who the sentence is about.
 *
 * Naming the seat is not the same as choosing the verb, and this file used to
 * do only the first. The label is `You` on every ordinary table, so the very
 * first sentence of every sealed game read `You keeps this hand, or shuffles it
 * back for a new one.` and the second read `You has mulliganed 1 time`. That is
 * `mtg-1ih` again, one route over: the rule that a seat called `You` takes a
 * second-person verb lives in `../../log/narrate.ts` as `seatVerb`, exported at
 * the label for exactly the surfaces that hold a `SeatNames` rather than a
 * `SeatBook`. Both forms are spelled out at each site, because that file argues
 * why a de-conjugator would be worse than the two words.
 */
function explainFor(state: GameState, decision: Decision, names: SeatNames): string {
  const asked = names[decision.player];
  const verb = (third: string, second: string): string => seatVerb(asked, third, second);
  switch (decision.kind) {
    case 'mulligan':
      // The cost of a mulligan is stated in the sentence rather than left to be
      // inferred from the option list, because it is the whole of the decision:
      // a new seven, and one more card off the top of it every time.
      return decision.count === 0
        ? `${asked} ${verb('keeps', 'keep')} this hand, or ${verb(
            'shuffles',
            'shuffle',
          )} it back for a new one.`
        : `${asked} ${verb('has', 'have')} mulliganed ${String(decision.mulligans)} time${
            decision.mulligans === 1 ? '' : 's'
          }, so keeping puts ${String(decision.count)} card${
            decision.count === 1 ? '' : 's'
          } on the bottom of the library.`;
    case 'priority':
      return state.stack.length > 0
        ? `${asked} may respond, or let the top of the stack resolve.`
        : `${asked} may act, or pass and move the game on.`;
    case 'declareAttackers':
      // Only the attacking player is ever asked this, so the second-person
      // branch that used to be here was unreachable.
      return `Choose which creatures attack ${decision.defenders
        .map((defender) =>
          typeof defender === 'number'
            ? seatMention(names[defender])
            : targetName(state, names, defender.oid),
        )
        .join(' or ')}. Attacking taps them unless they have vigilance.`;
    case 'declareBlockers':
      return `Assign blockers to the ${String(decision.attackers.length)} attacking creature${
        decision.attackers.length === 1 ? '' : 's'
      }. Unblocked attackers deal their damage to ${seatMention(asked)}.`;
    case 'orderBlockers':
      return 'Set the order damage is assigned to the blockers, first in the list first.';
    case 'discard':
      return `Choose ${String(decision.count)} card${decision.count === 1 ? '' : 's'} to discard.`;
    case 'triggerTargets':
      // Named rather than "your trigger", for the reason every other sentence
      // here names the seat: two people share this screen, and a trigger's
      // controller is not always the player whose turn it is.
      return `${nameOf(state, decision.source)} triggered. ${asked} ${verb(
        'chooses',
        'choose',
      )} its targets now, before either player can respond.`;
    case 'optionalTrigger':
      return `${nameOf(state, decision.source)}'s triggered ability is resolving, and ${seatMention(
        asked,
      )} may decline it.`;
    case 'may':
      // `optionalTrigger`'s sibling sentence just above states the same shape
      // in the third person, and this one has to as well: `spellLine` already
      // puts the card's own printed "You may..." text on screen (exempt,
      // because it is what the card prints), so quoting the words here would
      // be the surface's own sentence borrowing that phrasing rather than
      // reporting it, and a hotseat table names a seat instead of saying
      // "you" no matter which sentence is speaking.
      return `${nameOf(state, decision.oid)} is optional, and ${seatMention(asked)} decides whether to resolve it.`;
    case 'unless':
      // The price is stated here rather than on the buttons, for `mulligan`'s
      // reason: it is the whole of the decision, and a sentence that leaves it
      // out asks whether the player would like the spell to happen.
      return `${nameOf(state, decision.oid)} is aimed at ${seatMention(asked)}, who ${verb(
        'stops',
        'stop',
      )} it by paying ${formatManaCost(decision.cost)}.`;
    case 'legendRule':
      return `${asked} ${verb('controls', 'control')} ${String(
        decision.candidates.length,
      )} legendary permanents named ${decision.name}, and ${verb(
        'keeps',
        'keep',
      )} one. The rest go to their owners' graveyards.`;
    case 'scry':
      return `${asked} ${verb('orders', 'order')} ${String(decision.cards.length)} card${
        decision.cards.length === 1 ? '' : 's'
      } between the top and bottom of the library.`;
    case 'searchLibrary':
      // The count is the whole of what the sentence can say: the cards
      // themselves are on the buttons under it, and only this seat is handed
      // them (`seatState` strips the pending search from the other one).
      // Failing to find is stated because it is always offered (CR 701.19c)
      // and reads as a missing option otherwise.
      return `${asked} ${verb('searches', 'search')} the library. ${String(decision.cards.length)} card${
        decision.cards.length === 1 ? '' : 's'
      } match, and finding nothing is allowed. The library is shuffled either way.`;
    case 'graveyardChoice':
      // The search sentence above with both of its parenthetical facts
      // dropped, because neither is true here: a graveyard is public (CR
      // 400.2), so both seats are handed the same cards and nothing is
      // shuffled after. What survives is the count and the permission to take
      // none, which is the same missing-option problem the search has.
      return `${asked} ${verb('takes', 'take')} a card out of a graveyard. ${String(
        decision.cards.length,
      )} card${decision.cards.length === 1 ? '' : 's'} match, and taking none is allowed.`;
    case 'handDiscard': {
      const cards = `${String(decision.count)} card${decision.count === 1 ? '' : 's'}`;
      // The reveal is stated in the second branch and not the first, because it
      // is what makes the second question askable: without CR 701.16a this seat
      // would be choosing out of a zone it cannot see. `seatState` hands the
      // cards to this seat alone, exactly as it does for a search.
      return decision.owner === decision.player
        ? `${asked} ${verb('discards', 'discard')} ${cards}.`
        : `${seatMention(names[decision.owner])} revealed their hand, and ${asked} ${verb(
            'chooses',
            'choose',
          )} ${cards} for them to discard.`;
    }
    case 'permanentSacrifice':
      // `graveyardChoice`'s sentence at the opposite rule: no "and taking none
      // is allowed", because CR 701.17a offers no such arm — a legal candidate
      // always exists when this decision is asked at all. The kernel never
      // pauses on a single candidate (`scry.ts` resolves that case without
      // asking), so the count named below is always a real choice.
      return `${asked} ${verb('sacrifices', 'sacrifice')} a creature to a resolving effect. ${asked} ${verb(
        'controls',
        'control',
      )} ${String(decision.permanents.length)} to choose from.`;
  }
}

/** The two lines a button prints for one move, without the index that submits it. */
export interface ChoiceText {
  readonly label: string;
  readonly detail: string | null;
}

/**
 * What a move is called, for a move that has no place in the enumeration.
 *
 * Exported for the one caller that has an action and no index: a combat
 * declaration built out of clicks past the 512-option cap (`declare.ts`) is a
 * legal move the kernel never listed, and its confirm has to announce itself in
 * the same words the flat list would have given it. A second vocabulary for the
 * same move would be a second name for it on the same screen.
 */
export function choiceText(state: GameState, names: SeatNames, action: Action): ChoiceText {
  return { label: labelOf(state, names, action), detail: detailOf(state, action) };
}

/** The pending decision as a headline plus one clickable choice per legal option. */
export function buildPrompt(state: GameState, decision: Decision, names: SeatNames): PlayPrompt {
  const choices = decision.options.map((action, index): PlayChoice => ({
    index,
    ...choiceText(state, names, action),
    kind: action.type,
    oids: oidsOf(state, action),
  }));
  return {
    headline: headlineFor(decision),
    explain: explainFor(state, decision, names),
    choices,
    truncated: !decision.complete,
  };
}

/**
 * The hand cards at least one offered choice would play.
 *
 * What makes a hand card a button: `Hand` drops `onSelect` on every card
 * outside this set, so such a card stays as legible as any other and stops
 * being both a click target and a tab stop. Nothing is faded and nothing is
 * labeled, because not being pressable already says it. It is derived from the
 * enumeration rather than from a re-implementation of castability, so the hand
 * can never offer a card the kernel would refuse.
 */
export function playableFromHand(prompt: PlayPrompt): ReadonlySet<ObjectId> {
  const playable = new Set<ObjectId>();
  for (const choice of prompt.choices) {
    if (choice.kind !== 'playLand' && choice.kind !== 'castSpell') continue;
    for (const oid of choice.oids) playable.add(oid);
  }
  return playable;
}

/**
 * Every offered choice that acts on a given object, keyed by that object.
 *
 * What makes a card on the table clickable, and it is the rail's own list read
 * from the other end: `PlayChoice.oids` already names the objects a choice acts
 * on, so a click is a lookup. One entry plays on the spot; several open a picker
 * holding exactly those entries. Nothing here judges whether a move is legal or
 * worth offering, so a card can never be clickable for a move the kernel did not
 * enumerate, and no enumerated move loses the card it belongs to.
 *
 * An object appears once per choice however many of that choice's slots name it.
 * `orderBlockers` lists an attacker beside each of its blockers, and a picker
 * that offered one option twice would be a picker that had counted rather than
 * looked.
 *
 * `passPriority` and an empty `declareAttackers` name no object at all, so they
 * reach the player through the rail only. That is where they belong: neither one
 * is a move you make by pointing at something.
 */
export function choicesByObject(prompt: PlayPrompt): ReadonlyMap<ObjectId, readonly PlayChoice[]> {
  const byObject = new Map<ObjectId, PlayChoice[]>();
  for (const choice of prompt.choices) {
    for (const oid of new Set(choice.oids)) {
      const held = byObject.get(oid);
      if (held === undefined) byObject.set(oid, [choice]);
      else held.push(choice);
    }
  }
  return byObject;
}
