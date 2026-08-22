/**
 * A creature Aura -> Forge's `K:Enchant:` line and the `S:` lines behind it.
 *
 * Forge derives the Aura spell itself from the `Enchant` keyword: no shipped
 * Aura in 2.0.14's `res/cardsfolder` writes an `A:SP$ Attach` line, so the
 * whole of the attachment half is `K:Enchant:Creature`. What remains is the
 * clause the Aura applies to what it enchants, and that lands in the same `S:`
 * grammar an Equipment's clause lands in, with `Creature.EnchantedBy` where
 * `Creature.EquippedBy` would be.
 *
 * Two things are not the equip path. Forge splits one printed sentence across
 * modes: a P/T or keyword change is `Mode$ Continuous` and names `Affected$`,
 * a combat restriction is `Mode$ CantAttack` and names `ValidCard$`, and an
 * unblockable clause is `Mode$ CantBlockBy` and names `ValidAttacker$`. So a
 * clause that mixes the two kinds writes more than one line. And when it does,
 * every line carries the whole printed sentence and all but the first carry
 * `Secondary$ True`, which is what keeps the text box from printing the
 * sentence twice — `Cast into Darkness` ships exactly that shape for
 * "Enchanted creature gets -2/-0 and can't block."
 *
 * Read off Forge 2.0.14's `res/cardsfolder`, not off a game it ran: the same
 * standing gap the `S:` and `T:` mappings already carry (`mtg-17a`).
 */
import type { Aura, AuraModification, EnchantmentCard } from '@mtg/dsl';
import { ENCHANTED_DOES_NOT_UNTAP, isStaticAuraModification, renderAuraModificationClause } from '@mtg/dsl';
import type { AbilityScriptResult } from './ability-script';
import type { ForgeParam } from './script-text';
import { isScriptSafe, params, renderModeAbility } from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import { FORGE_KEYWORDS } from './vocabulary-map';

/** What every clause an Aura applies is scoped to. */
const ENCHANTED = 'Creature.EnchantedBy';

/**
 * `doesNotUntap`, which is the one clause in this subset that is not an `S:`
 * line at all.
 *
 * Forge models "doesn't untap" as a replacement effect on the untap event
 * rather than as a continuous mode, and the corpus is unanimous about the
 * shape: 35 shipped Auras write this line verbatim under `Creature.EnchantedBy`
 * (13 more write the same thing under `.AttachedBy`, which is the Equipment
 * spelling of the same relation and not what an Aura's own scope constant
 * already says). `Layer$ CantHappen` is what makes it a prohibition rather than
 * a substitution, and `ValidStepTurnToController$ You` is what confines it to
 * the untap step of the enchanted creature's controller, which is the half of
 * the printed sentence after the comma.
 *
 * It carries its own `Description$` and never `Secondary$ True`, which is the
 * one place this line diverges from the `S:` lines beside it. Immobilizing Ink
 * and Sinking Feeling both ship an `R:` line naming only this rule beside an
 * `S:` line naming only its own, so the "every line repeats the whole
 * paragraph" convention `mergeByMode` serves is an `S:` convention and stops
 * here. `ENCHANTED_DOES_NOT_UNTAP` is the sentence, from `@mtg/dsl`, so the
 * printed card and this line cannot word it differently; it is a substring of
 * the paragraph `auraScript` already runs through `isScriptSafe`.
 */
const UNTAP_REPLACEMENT_LINE = `R:${[
  'Event$ Untap',
  'ActiveZones$ Battlefield',
  `ValidCard$ ${ENCHANTED}`,
  'ValidStepTurnToController$ You',
  'Layer$ CantHappen',
  `Description$ ${ENCHANTED_DOES_NOT_UNTAP}`,
].join(' | ')}`;

/** Every Aura clause that compiles to an `S:` line, which is all but the one above. */
type StaticLineModification = Exclude<AuraModification, { kind: 'doesNotUntap' }>;

/**
 * One `S:` line's mode and the parameter naming who it reaches.
 *
 * The pairing is not free: `Mode$ Continuous` reads `Affected$` and the combat
 * modes read `ValidCard$`, except `CantBlockBy`, which is written from the
 * attacker's side and reads `ValidAttacker$` (`Aqueous Form`). Keeping the two
 * together in one record is what stops a line naming a mode under the wrong
 * scope parameter, which Forge would parse and then silently ignore.
 */
interface ModeLine {
  readonly mode: string;
  readonly scopeParam: string;
  readonly body: readonly ForgeParam[];
  /**
   * A line the corpus never writes beside another, so `mergeByMode` leaves it
   * alone.
   *
   * `GainControl$` is the only one. All 42 shipped `S:` lines carrying it carry
   * nothing else in their body, and `Corrupted Conscience` — the one shipped
   * Aura that both takes control and grants a keyword — writes two separate
   * `Mode$ Continuous` lines rather than merging them. Merging here would be a
   * guess about a parameter combination Forge has never been handed, on the
   * exporter whose whole standing limit is that it is read off the corpus and
   * not off a game it ran (`mtg-17a`).
   */
  readonly solo?: true;
}

/**
 * `creature` -> `Creature`, so the `Enchant` keyword names what the DSL says it
 * enchants rather than a constant written twice. `AuraSchema.enchant` has one
 * member today and this is what makes a second one show up in the line.
 */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `+2` / `-1`, matching `ability-script.ts`'s form for the same fields. */
function signed(delta: number): string {
  return delta < 0 ? String(delta) : `+${delta}`;
}

type BodyResult =
  | { readonly ok: true; readonly value: ModeLine }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

function modificationLine(modification: StaticLineModification, cardId: string, path: string): BodyResult {
  if (isStaticAuraModification(modification)) {
    if (modification.kind === 'statBonus') {
      return {
        ok: true,
        value: {
          mode: 'Continuous',
          scopeParam: 'Affected',
          body: params(
            ['AddPower', signed(modification.power)],
            ['AddToughness', signed(modification.toughness)],
          ),
        },
      };
    }
    if (modification.kind === 'statBonusPer') {
      // The Aura arm of the refusal `ability-script.ts`'s `modificationParams`
      // already takes for an equip clause, for the same reason and with the
      // same wording: Forge writes a scaled continuous bonus as a counting
      // `SVar` plus `AddPower$ X` reading it, and this function emits only
      // fixed `AddPower$`/`AddToughness$` numbers. `mtg-nhyv.34` holds the
      // transpiler change; guessing a line here would export an Aura that
      // boots in Forge granting nothing.
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.kind`,
            '"statBonusPer" is a layer-7c bonus scaled by a live board count: Forge spells it with a counting SVar plus AddPower$/AddToughness$ referring to it, and this transpiler emits only fixed AddPower$/AddToughness$ values',
          ),
        ],
      };
    }
    const forgeKeyword = FORGE_KEYWORDS[modification.keyword];
    if (forgeKeyword === undefined) {
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_KEYWORD',
            cardId,
            `${path}.keyword`,
            `keyword "${modification.keyword}" has no Forge K: mapping, so an Aura cannot grant it`,
          ),
        ],
      };
    }
    return {
      ok: true,
      value: {
        mode: 'Continuous',
        scopeParam: 'Affected',
        body: params(['AddKeyword', forgeKeyword]),
      },
    };
  }
  switch (modification.kind) {
    case 'grantLandwalk':
      // `Dryad's Favor` is `AddKeyword$ Landwalk:Forest`, not `Forestwalk`:
      // the granted form names the land type after a colon where the printed
      // keyword on a creature's own line is one word (`forgeKeywordAbility`).
      return {
        ok: true,
        value: {
          mode: 'Continuous',
          scopeParam: 'Affected',
          body: params(['AddKeyword', `Landwalk:${modification.landType}`]),
        },
      };
    case 'cantAttack':
      return { ok: true, value: { mode: 'CantAttack', scopeParam: 'ValidCard', body: [] } };
    case 'cantBlock':
      return { ok: true, value: { mode: 'CantBlock', scopeParam: 'ValidCard', body: [] } };
    case 'cantBeBlocked':
      return { ok: true, value: { mode: 'CantBlockBy', scopeParam: 'ValidAttacker', body: [] } };
    case 'gainControl':
      // `Mind Control` is `Affected$ Card.EnchantedBy | GainControl$ You`, and
      // 34 of the 42 shipped control Auras write that exact scope. One writes
      // `Creature.EnchantedBy`, which is what `ENCHANTED` already is and what
      // the DSL's `enchant: 'creature'` already promises, so the narrower of
      // the two attested forms is the one written here rather than a second
      // constant that means the same thing on every card this DSL can build.
      return {
        ok: true,
        value: {
          mode: 'Continuous',
          scopeParam: 'Affected',
          body: params(['GainControl', 'You']),
          solo: true,
        },
      };
  }
}

/**
 * The lines that share a mode, merged.
 *
 * Two reasons this is not one line per modification. Forge reads one
 * `Description$` per static ability, so "Enchanted creature gets +1/+2 and has
 * flying." on two `Mode$ Continuous` lines would print the sentence twice
 * where the corpus prints it once (`Holy Strength` carries `AddPower$` and
 * `AddToughness$` on a single line). And Magic's own Pacifism is one line,
 * `Mode$ CantAttack,CantBlock`, rather than two modes stating half a sentence
 * each.
 *
 * Merging is by insertion order and never reorders, so the lines come out in
 * the order the printed clause names them.
 */
function mergeByMode(lines: readonly ModeLine[]): readonly ModeLine[] {
  const merged: ModeLine[] = [];
  for (const line of lines) {
    const open = merged[merged.length - 1];
    if (open === undefined) {
      merged.push(line);
      continue;
    }
    if (open.solo === true || line.solo === true) {
      merged.push(line);
      continue;
    }
    if (open.mode === 'Continuous' && line.mode === 'Continuous') {
      merged[merged.length - 1] = { ...open, body: [...open.body, ...line.body] };
      continue;
    }
    // Two combat restrictions reaching the same side of combat: Pacifism's
    // `CantAttack,CantBlock`. A mode list is legal only where the modes carry
    // no body of their own, so the empty-body test is the condition rather
    // than the mode names.
    if (open.scopeParam === line.scopeParam && open.body.length === 0 && line.body.length === 0) {
      merged[merged.length - 1] = { ...open, mode: `${open.mode},${line.mode}` };
      continue;
    }
    merged.push(line);
  }
  return merged;
}

/**
 * Forge's AI hint for what an Aura is for.
 *
 * `AttachAILogic` is how Forge's AI decides whose creature to enchant, and
 * getting it wrong is not cosmetic: without `Curse` the AI reads Pacifism as a
 * gift and plays it on its own board, which would move every parity number the
 * Forge oracle produces. `Pump`, `Curse` and `GainControl` are 754, 329 and 39
 * of the shipped hints and the only three this Aura subset can be.
 *
 * `GainControl` is checked first because it is the one hint that is about the
 * card rather than about the sign of its clause: every shipped Aura that takes
 * control carries it, including the ones that also hand the creature a bonus,
 * and the AI needs to know it is buying a creature rather than cursing or
 * pumping one. A restriction on attacking or blocking is a curse and so is a
 * clause whose stat change is a net shrink; everything else this subset
 * expresses — a stat gain, a granted keyword, landwalk, unblockable — helps the
 * creature it is attached to.
 */
function attachAiLogic(aura: Aura): string {
  if (aura.modifications.some((modification) => modification.kind === 'gainControl')) {
    return 'GainControl';
  }
  const cursing = aura.modifications.some((modification) => {
    if (modification.kind === 'statBonus') return modification.power + modification.toughness < 0;
    return (
      modification.kind === 'cantAttack' ||
      modification.kind === 'cantBlock' ||
      // Holding a creature down is the strongest curse in the subset — it stops
      // the attack, the block and every tap cost at once — so an AI that read it
      // as a gift would enchant its own board with Claustrophobia.
      modification.kind === 'doesNotUntap'
    );
  });
  return cursing ? 'Curse' : 'Pump';
}

/**
 * Every line an Aura card contributes beyond its `Name`/`ManaCost`/`Types`.
 *
 * `K:Enchant:Creature` comes first, the AI hint second and the `S:` lines
 * last, which is the order every shipped Aura writes them in. The `R:` line
 * comes after them, which is the order Tractor Beam writes (Immobilizing Ink
 * writes it first, so the corpus attests both and neither is the convention).
 *
 * The paragraph the `S:` lines carry is rendered from the clause *without* its
 * untap modification, because that line carries its own sentence and Forge
 * would otherwise print the untap rule twice — once inside every `S:` line's
 * `Description$` and once in the `R:` line's. An Aura whose whole clause is the
 * untap rule therefore writes no `S:` line at all, which is exactly what
 * Claustrophobia and Bitter Chill ship.
 */
export function auraScript(
  card: EnchantmentCard & { readonly aura: Aura },
  cardId: string,
  path: string,
): AbilityScriptResult {
  const staticClause: readonly StaticLineModification[] = card.aura.modifications.flatMap((modification) =>
    modification.kind === 'doesNotUntap' ? [] : [modification],
  );
  const holdsUntapped = staticClause.length !== card.aura.modifications.length;
  const description = renderAuraModificationClause(staticClause);
  // Only the `S:` paragraph is checked: it is the only text here interpolated
  // from the card, and `UNTAP_REPLACEMENT_LINE` is a constant with no card data
  // in it.
  if (!isScriptSafe(description)) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          path,
          'the rendered Aura clause contains a newline or "|", which would break the static line',
        ),
      ],
    };
  }

  const built: ModeLine[] = [];
  const rejections: TranspileRejection[] = [];
  for (const [index, modification] of staticClause.entries()) {
    const result = modificationLine(modification, cardId, `${path}.modifications[${index}]`);
    if (result.ok) built.push(result.value);
    else rejections.push(...result.rejections);
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const lines = [
    `K:Enchant:${capitalize(card.aura.enchant)}`,
    `SVar:AttachAILogic:${attachAiLogic(card.aura)}`,
  ];
  for (const [index, line] of mergeByMode(built).entries()) {
    const body: readonly ForgeParam[] = [
      ...params([line.scopeParam, ENCHANTED]),
      ...line.body,
      ...(index === 0 ? [] : params(['Secondary', 'True'])),
      ...params(['Description', description]),
    ];
    lines.push(`S:${renderModeAbility(line.mode, body)}`);
  }
  if (holdsUntapped) lines.push(UNTAP_REPLACEMENT_LINE);
  return { ok: true, value: { lines, tokens: [] } };
}
