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
import type { Aura, AuraModification, EnchantmentCard, TokenSpec } from '@mtg/dsl';
import {
  isEnchantedLandBecomesTappedMillAbility,
  isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  isStaticAuraModification,
  renderAbility,
  renderAuraModificationClause,
} from '@mtg/dsl';
import type { AbilityScriptResult } from './ability-script';
import { grantedActivatedAbilityScript, grantedTriggerScript } from './ability-script';
import type { ForgeParam } from './script-text';
import { isScriptSafe, params, renderModeAbility } from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import { FORGE_KEYWORDS } from './vocabulary-map';
import { statBonusPerValues } from './board-count';

/** Forge's live attached-host selector for the Aura's printed restriction. */
function enchantedSelector(aura: Aura): string {
  return aura.enchant === 'creature' ? 'Creature.EnchantedBy' : 'Card.EnchantedBy';
}

/** Forge's checked-in `K:Enchant:` spelling for the Aura's printed restriction. */
function enchantKeyword(aura: Aura): string {
  switch (aura.enchant) {
    case 'creature':
      return 'K:Enchant:Creature';
    case 'artifactOrCreature':
      return 'K:Enchant:Creature,Artifact:artifact or creature';
    case 'land':
      return 'K:Enchant:Land';
    case 'nonlandPermanent':
      return 'K:Enchant:Permanent.nonLand:nonland permanent';
  }
}

type AuraHostNoun = 'creature' | 'permanent' | 'land' | 'nonland permanent';

function auraHostNoun(aura: Aura): AuraHostNoun {
  return aura.enchant === 'artifactOrCreature'
    ? 'permanent'
    : aura.enchant === 'nonlandPermanent'
      ? 'nonland permanent'
      : aura.enchant;
}

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
function untapReplacementLine(aura: Aura, description: string): string {
  return `R:${[
    'Event$ Untap',
    'ActiveZones$ Battlefield',
    `ValidCard$ ${enchantedSelector(aura)}`,
    'ValidStepTurnToController$ You',
    'Layer$ CantHappen',
    `Description$ ${description}`,
  ].join(' | ')}`;
}

/** Every Aura clause that compiles to an `S:` line, which is all but the one above. */
type StaticLineModification = Exclude<
  AuraModification,
  { kind: 'doesNotUntap' | 'grantTriggeredAbility' | 'grantActivatedAbility' }
>;

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
  readonly supportingLines?: readonly string[];
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
 * The bare delta, matching `ability-script.ts`'s `statDelta` for the same two
 * fields. Holy Strength is the shipped Aura of exactly this shape and it writes
 * `AddPower$ 1 | AddToughness$ 2`.
 */
function statDelta(delta: number): string {
  return String(delta);
}

type BodyResult =
  | { readonly ok: true; readonly value: ModeLine }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

function modificationLine(
  modification: StaticLineModification,
  cardId: string,
  path: string,
  svarPrefix: string,
): BodyResult {
  if (isStaticAuraModification(modification)) {
    if (modification.kind === 'statBonus') {
      return {
        ok: true,
        value: {
          mode: 'Continuous',
          scopeParam: 'Affected',
          body: params(
            ['AddPower', statDelta(modification.power)],
            ['AddToughness', statDelta(modification.toughness)],
          ),
        },
      };
    }
    if (modification.kind === 'statBonusPer') {
      const values = statBonusPerValues(modification, svarPrefix);
      if (values === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              `${path}.each`,
              '"statBonusPer" names a live board tally with no exact Forge Count$Valid spelling',
            ),
          ],
        };
      }
      return {
        ok: true,
        value: {
          mode: 'Continuous',
          scopeParam: 'Affected',
          body: params(['AddPower', values.power], ['AddToughness', values.toughness]),
          supportingLines: values.supportingLines,
        },
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
    case 'cantActivateAbilities':
      return { ok: true, value: { mode: 'CantBeActivated', scopeParam: 'ValidCard', body: [] } };
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
      merged[merged.length - 1] = {
        ...open,
        body: [...open.body, ...line.body],
        supportingLines: [...(open.supportingLines ?? []), ...(line.supportingLines ?? [])],
      };
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
    if (modification.kind === 'statBonus' || modification.kind === 'statBonusPer') {
      return modification.power + modification.toughness < 0;
    }
    return (
      modification.kind === 'cantAttack' ||
      modification.kind === 'cantBlock' ||
      modification.kind === 'cantActivateAbilities' ||
      // Holding a creature down is the strongest curse in the subset — it stops
      // the attack, the block and every tap cost at once — so an AI that read it
      // as a gift would enchant its own board with Claustrophobia.
      modification.kind === 'doesNotUntap' ||
      (modification.kind === 'grantTriggeredAbility' &&
        modification.ability.effects.some((effect) => effect.kind === 'sacrificeSelf'))
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
  const continuousEntries = card.aura.modifications.flatMap((modification, index) =>
    modification.kind === 'doesNotUntap' || modification.kind === 'grantTriggeredAbility'
      ? []
      : [{ modification, index }],
  );
  const continuousClause = continuousEntries.map((entry) => entry.modification);
  const holdsUntapped = card.aura.modifications.some((modification) => modification.kind === 'doesNotUntap');
  const untapsDuringOtherPlayersUntapSteps = card.aura.untapsDuringEachOtherPlayersUntapStep === true;
  let grantNumber = 0;
  const grantPrefixes = new Map<number, string>();
  for (const [index, modification] of card.aura.modifications.entries()) {
    if (modification.kind !== 'grantTriggeredAbility' && modification.kind !== 'grantActivatedAbility') {
      continue;
    }
    grantNumber += 1;
    grantPrefixes.set(index, `AuraGrant${String(grantNumber)}`);
  }
  // Forge's checked-in Ice Cage script predates the current Oracle comma. Keep
  // its `S:` description byte-exact while the separate Oracle line stays current.
  const host = auraHostNoun(card.aura);
  const fullDescription = renderAuraModificationClause(card.aura.modifications, host);
  const activationLocked = card.aura.modifications.some(
    (modification) => modification.kind === 'cantActivateAbilities',
  );
  const description =
    card.aura.enchantedControllerHandSizeBonus === true
      ? "Enchanted creature gets +1/+1 for each card in its controller's hand."
      : (holdsUntapped && activationLocked
          ? fullDescription
          : renderAuraModificationClause(continuousClause, host)
        ).replace(
          ", and its activated abilities can't be activated",
          " and its activated abilities can't be activated",
        );
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
  const tokens: TokenSpec[] = [];
  if (card.aura.enchantedControllerHandSizeBonus === true) {
    built.push({
      mode: 'Continuous',
      scopeParam: 'Affected',
      body: params(['AddPower', 'X'], ['AddToughness', 'X']),
      supportingLines: ['SVar:X:Count$ValidHand Card.OwnedBy EnchantedController'],
    });
  }
  for (const { modification, index } of continuousEntries) {
    if (modification.kind === 'grantActivatedAbility') {
      const prefix = grantPrefixes.get(index);
      if (prefix === undefined) throw new Error('activated Aura grant lost its generated Forge name');
      const sourceKind = host === 'permanent' || host === 'nonland permanent' ? undefined : host;
      const grantedDescription = renderAbility(modification.ability, `this ${host}`, sourceKind);
      const compiled = grantedActivatedAbilityScript(
        modification.ability,
        prefix,
        grantedDescription,
        cardId,
        `${path}.modifications[${String(index)}].ability`,
      );
      if (!compiled.ok) return compiled;
      built.push({
        mode: 'Continuous',
        scopeParam: 'Affected',
        body: params(['AddAbility', prefix]),
        supportingLines: compiled.value.lines,
      });
      tokens.push(...compiled.value.tokens);
      continue;
    }
    const result = modificationLine(
      modification,
      cardId,
      `${path}.modifications[${String(index)}]`,
      `AuraStat${String(index + 1)}`,
    );
    if (result.ok) built.push(result.value);
    else rejections.push(...result.rejections);
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const enchanted = enchantedSelector(card.aura);
  const soulTithe = card.abilities.some(isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility);
  const chronicFlooding = card.abilities.some(isEnchantedLandBecomesTappedMillAbility);
  const lines = [
    enchantKeyword(card.aura),
    ...(soulTithe ? ['SVar:AttachAITgts:Card.cmcGE2'] : []),
    `SVar:AttachAILogic:${soulTithe || chronicFlooding ? 'Curse' : attachAiLogic(card.aura)}`,
  ];
  if (holdsUntapped) {
    const sentence = activationLocked
      ? fullDescription
      : `Enchanted ${host} doesn't untap during its controller's untap step.`;
    lines.push(untapReplacementLine(card.aura, sentence));
  }
  if (untapsDuringOtherPlayersUntapSteps) {
    const untapDescription = `Enchanted ${host} has "Untap this ${host} during each other player's untap step."`;
    lines.push(
      `S:${renderModeAbility('Continuous', [
        ...params(['Affected', enchanted]),
        ...params(['AddStaticAbility', 'BurgeoningUntap']),
        ...params(['Description', untapDescription]),
      ])}`,
      "SVar:BurgeoningUntap:Mode$ UntapOtherPlayer | ValidCard$ Card.Self | Description$ Untap this land during each other player's untap step.",
    );
  }
  for (const [index, line] of mergeByMode(built).entries()) {
    const body: readonly ForgeParam[] = [
      ...params([line.scopeParam, enchanted]),
      ...line.body,
      ...(index === 0 && !holdsUntapped ? [] : params(['Secondary', 'True'])),
      ...params(['Description', description]),
    ];
    lines.push(`S:${renderModeAbility(line.mode, body)}`);
    lines.push(...(line.supportingLines ?? []));
  }
  for (const [index, grant] of card.aura.modifications.entries()) {
    if (grant.kind !== 'grantTriggeredAbility') continue;
    const prefix = grantPrefixes.get(index);
    if (prefix === undefined) throw new Error('triggered Aura grant lost its generated Forge name');
    const grantedDescription = renderAbility(grant.ability, 'CARDNAME').replaceAll(
      'this creature',
      'CARDNAME',
    );
    const compiled = grantedTriggerScript(
      grant.ability,
      prefix,
      grantedDescription,
      cardId,
      `${path}.modifications[${String(index)}].ability`,
    );
    if (!compiled.ok) return compiled;
    const addedSvars = compiled.value.lines.flatMap((line) => {
      const name = /^SVar:([^:]+):/.exec(line)?.[1];
      return name === undefined || name === prefix ? [] : [name];
    });
    lines.push(
      `S:${renderModeAbility('Continuous', [
        ...params(['Affected', enchanted]),
        ...params(['AddTrigger', prefix]),
        ...params(['AddSVar', addedSvars.join(' & ')]),
        ...params(['Description', renderAuraModificationClause([grant], host)]),
      ])}`,
      ...compiled.value.lines,
    );
    tokens.push(...compiled.value.tokens);
  }
  return { ok: true, value: { lines, tokens } };
}
