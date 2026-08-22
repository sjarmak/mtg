/**
 * Card record -> Forge card script.
 *
 * Line order follows the shipped corpus: `Name`, `ManaCost`, `Types`, `PT`,
 * `K:` keywords, the ability block (`A:` plus its `SVar:` sub-abilities),
 * `DeckHas`, `Oracle`.
 *
 * Multi-effect spells chain through Forge's sub-ability mechanism, the same
 * shape `Aang's Defense` and `Absorb` use: the primary `A:` line carries
 * `SubAbility$ DBEffect1` and the whole printed text in `SpellDescription$`,
 * and each `SVar:DBEffect<n>` carries the next link. Each DSL effect keeps its
 * own target clause, which matches the DSL's own oracle rendering — two
 * targeted effects on one card print as two independent targets.
 */
import type { Card, CreatureCard, KeywordAbility, ManaCost, TokenSpec, UnlessPayer } from '@mtg/dsl';
import {
  COLORS,
  hasAbilityEffects,
  isAuraCard,
  isCastable,
  isCreatureTokenSpec,
  printedEntryReplacement,
  renderEffect,
  renderOracleText,
  renderTokenOracleText,
  sortColors,
  sortKeywords,
  tokenAbilities,
  typeLineParts,
  withUnlessClause,
} from '@mtg/dsl';
import { transpileAbility } from './ability-script';
import {
  RESOLUTION_COUNT_CLEANUP,
  RESOLUTION_COUNT_SVAR_LINE,
  readsResolutionCount,
  resolutionCountSpellings,
} from './remember';
import { boardCountSvarLines, withBoardCounts } from './board-count';
import { auraScript } from './aura-script';
import type { ForgeAbility } from './script-text';
import { escapeNewlines, isScriptSafe, renderSpellAbility, renderSubAbility } from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection, TranspileError } from './rejection';
import { FORGE_EFFECTS, transpileEffect } from './effect-script';
import { FORGE_COLOR_WORDS, FORGE_KEYWORDS } from './vocabulary-map';
import { forgeTokenDisplayName, forgeTokenScriptName } from './naming';

/** Forge's cost form: generic first, then one word per colored pip (`3 W W`). */
export function forgeManaCost(cost: ManaCost): string {
  const pips = COLORS.flatMap((color) => Array.from({ length: Math.max(0, cost[color]) }, () => color));
  const generic = cost.generic > 0 ? [String(cost.generic)] : [];
  const parts = [...generic, ...pips];
  return parts.length > 0 ? parts.join(' ') : '0';
}

/** `Basic Land Mountain`, `Legendary Artifact Creature Golem`. */
export function forgeTypeLine(card: Card): string {
  const parts = typeLineParts(card);
  return [...parts.supertypes, ...parts.types, ...parts.subtypes].join(' ');
}

export interface CardScriptBody {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
}

export type CardScriptResult =
  | { readonly ok: true; readonly value: CardScriptBody }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

function keywordLines(card: Card, rejections: TranspileRejection[]): string[] {
  const lines: string[] = [];
  for (const [index, keyword] of sortKeywords(card.keywords).entries()) {
    const forgeKeyword = FORGE_KEYWORDS[keyword];
    if (forgeKeyword === undefined) {
      rejections.push(
        rejection(
          'UNMAPPED_KEYWORD',
          card.id,
          `keywords[${index}]`,
          `keyword "${keyword}" has no Forge K: mapping`,
        ),
      );
      continue;
    }
    lines.push(`K:${forgeKeyword}`);
  }
  for (const ability of card.keywordAbilities ?? []) lines.push(`K:${forgeKeywordAbility(ability)}`);
  return lines;
}

function forgeKeywordAbility(ability: KeywordAbility): string {
  switch (ability.kind) {
    case 'defender':
      return 'Defender';
    case 'landwalk':
      return `${ability.landType}walk`;
    case 'hexproof':
      return 'Hexproof';
    case 'indestructible':
      return 'Indestructible';
    case 'protection':
      return `Protection from ${ability.quality.kind === 'color' ? FORGE_COLOR_WORDS[ability.quality.color] : ability.quality.subtype}`;
    case 'doubleStrike':
      return 'Double Strike';
  }
}

/**
 * The printed abilities' lines — `S:` for a static, `T:` plus its `SVar:` chain
 * for a trigger — sitting between the `K:` keywords and the spell-ability
 * block, the order the shipped corpus uses for a permanent that has both. A
 * token-making trigger declares its token here, the same way a token-making
 * spell does.
 *
 * It collects `DeckHas` hints for the same reason `effectChain` does, and it
 * was not doing so until `mtg-nhyv.30`: the hint table is keyed by effect kind
 * and says nothing about where the effect sits, but only the spell chain read
 * it, so a life gain or a token hanging off a trigger exported without the
 * hint Forge's deck AI reads. `sacrificeSelf` is the kind that made the gap
 * unmissable rather than merely wrong -- its only legal targets are the two
 * retained referents, so it can never appear in `card.effects` at all, and a
 * hint reachable from nowhere is a hint that is not there.
 */
function abilityLines(
  card: Card,
  tokens: TokenSpec[],
  deckHas: string[],
  rejections: TranspileRejection[],
): readonly string[] {
  const lines: string[] = [];
  for (const [index, ability] of card.abilities.entries()) {
    const result = transpileAbility(ability, index, card.id, `abilities[${index}]`);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    lines.push(...result.value.lines);
    tokens.push(...result.value.tokens);
    if (!hasAbilityEffects(ability)) continue;
    for (const effect of ability.effects) {
      const hint = FORGE_EFFECTS[effect.kind]?.deckHas;
      if (hint !== undefined && hint !== null && !deckHas.includes(hint)) deckHas.push(hint);
    }
  }
  return lines;
}

/**
 * Forge's word for the player an `UnlessCost$` is charged to.
 *
 * Forge names the payer the same way the DSL does, off the spell's target
 * rather than by seat: `TargetedController` is the controller of the permanent
 * the spell targets and `Targeted` is the targeted player themselves. Both
 * spellings are in `res/cardsfolder` (27 and 20 lines in Forge 2.0.14), which
 * is what makes this a mapping rather than an approximation.
 */
const FORGE_UNLESS_PAYERS: Readonly<Record<UnlessPayer, string>> = {
  targetController: 'TargetedController',
  targetPlayer: 'Targeted',
};

/**
 * `UnlessCost$ 2 | UnlessPayer$ TargetedController` — the toll, as two params on
 * the spell ability itself.
 *
 * Forge applies these ahead of the API rather than inside it, so the same pair
 * works whatever the gated effect is, and `checkUnless` has already refused
 * every card shape that would make the payer ambiguous (modes, more than one
 * effect, a target the payer cannot be read off). `forgeManaCost` renders `{0}`
 * as the string `0`, which Forge would read as a free toll; `UNLESS_COST_IS_FREE`
 * is why no card reaches here carrying one.
 */
function unlessParams(card: Card): readonly (readonly [string, string])[] {
  const clause = card.unless;
  if (clause === undefined) return [];
  return [
    ['UnlessCost', forgeManaCost(clause.cost)],
    ['UnlessPayer', FORGE_UNLESS_PAYERS[clause.payer]],
  ];
}

interface AbilityBlock {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
  readonly deckHas: readonly string[];
}

/**
 * Transpiles the spell's effects into one chain of Forge abilities.
 *
 * Split out because the chain is built twice for a card whose later clause
 * counts what an earlier one exiled: the first pass answers whether anything
 * reads the count at all, and only then does the second make the exiles
 * remember (`remember.ts` argues why that question cannot be asked before the
 * chain exists). Both passes see identical effects, so the second's rejections
 * are the first's and are collected once.
 */
function effectChain(
  card: Card,
  remembering: boolean,
  rejections: TranspileRejection[],
): {
  readonly abilities: readonly ForgeAbility[];
  readonly tokens: readonly TokenSpec[];
  readonly deckHas: readonly string[];
} {
  const abilities: ForgeAbility[] = [];
  const tokens: TokenSpec[] = [];
  const deckHas: string[] = [];
  const spellings = withBoardCounts(resolutionCountSpellings(card.effects, remembering), card.effects);
  for (const [index, effect] of card.effects.entries()) {
    const result = transpileEffect(effect, card.id, `effects[${index}]`, spellings[index]);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    abilities.push(result.value.ability);
    if (result.value.follow !== undefined) abilities.push(result.value.follow);
    if (result.value.token !== undefined) tokens.push(result.value.token);
    const hint = FORGE_EFFECTS[effect.kind]?.deckHas;
    if (hint !== undefined && hint !== null && !deckHas.includes(hint)) deckHas.push(hint);
  }
  return { abilities, tokens, deckHas };
}

function abilityBlock(card: Card, rejections: TranspileRejection[]): AbilityBlock {
  const first = effectChain(card, false, rejections);
  const counted = readsResolutionCount(first.abilities);
  const { abilities: built, tokens, deckHas } = counted ? effectChain(card, true, []) : first;
  // The link that empties the remembered list rides at the end of the chain as
  // an ordinary `SVar:DBEffect<n>`. Forge resolves a sub-ability by its SVar
  // name and the corpus's own `DBCleanup` is only a convention, so one naming
  // scheme for every link of a chain this transpiler writes beats two.
  const abilities: readonly ForgeAbility[] = counted ? [...built, RESOLUTION_COUNT_CLEANUP] : built;
  if (abilities.length === 0) return { lines: [], tokens, deckHas };

  const sentences = card.effects.map((effect) => renderEffect(effect, 'CARDNAME')).join(' ');
  const description = card.unless === undefined ? sentences : withUnlessClause(sentences, card.unless);
  if (!isScriptSafe(description)) {
    rejections.push(
      rejection(
        'UNSAFE_SCRIPT_TEXT',
        card.id,
        'effects',
        'rendered spell description contains a newline or "|", which would break the ability line',
      ),
    );
    return { lines: [], tokens, deckHas };
  }

  const lines: string[] = [];
  const [primary, ...subs] = abilities;
  if (primary === undefined) return { lines: [], tokens, deckHas };
  const primaryParams = [
    ...primary.params,
    ...unlessParams(card),
    ...(subs.length > 0 ? ([['SubAbility', 'DBEffect1']] as const) : []),
    ['SpellDescription', description] as const,
  ];
  lines.push(`A:${renderSpellAbility({ api: primary.api, params: primaryParams })}`);
  for (const [index, sub] of subs.entries()) {
    const isLast = index === subs.length - 1;
    const subParams = [...sub.params, ...(isLast ? [] : ([['SubAbility', `DBEffect${index + 2}`]] as const))];
    lines.push(`SVar:DBEffect${index + 1}:${renderSubAbility({ api: sub.api, params: subParams })}`);
  }
  if (counted) lines.push(RESOLUTION_COUNT_SVAR_LINE);
  lines.push(...boardCountSvarLines(card.effects));
  return { lines, tokens, deckHas };
}

function nameRejections(card: Card): TranspileRejection[] {
  if (isScriptSafe(card.name)) return [];
  return [
    rejection(
      'UNSAFE_SCRIPT_TEXT',
      card.id,
      'name',
      `card name ${JSON.stringify(card.name)} contains a newline or "|", which would break Forge's script grammar`,
    ),
  ];
}

/** Builds the script body for one card, or the reasons it cannot be built. */
export function transpileCardScript(card: Card): CardScriptResult {
  const rejections: TranspileRejection[] = [...nameRejections(card)];
  if (card.modes !== undefined) {
    rejections.push(
      rejection(
        'UNMAPPED_MODAL_SPELL',
        card.id,
        'modes',
        'a modal spell\'s "Choose one —" has no Forge sub-ability mapping in this transpiler',
      ),
    );
  }
  if (card.may !== undefined) {
    rejections.push(
      rejection(
        'UNMAPPED_MAY_SPELL',
        card.id,
        'may',
        'a spell\'s "You may" is written per effect API in Forge, and this transpiler has no row for it',
      ),
    );
  }
  if (card.kind === 'land' && card.basicLandType === undefined) {
    rejections.push(
      rejection(
        'UNMAPPED_NONBASIC_LAND',
        card.id,
        'entryReplacement',
        'nonbasic land entry and mana abilities need an exact Forge mapping before this card can be exported',
      ),
    );
  } else if (printedEntryReplacement(card) !== undefined) {
    rejections.push(
      rejection(
        'UNMAPPED_ENTRY_REPLACEMENT',
        card.id,
        'entryReplacement',
        'a nonland permanent that enters tapped needs an exact Forge mapping; exporting it without the clause would ship a card that costs less here than the kernel charges',
      ),
    );
  }
  const lines: string[] = [`Name:${card.name}`];
  const abilityTokens: TokenSpec[] = [];
  const abilityDeckHas: string[] = [];

  if (isCastable(card) && card.manaCost.hasX) {
    rejections.push(
      rejection(
        'UNMAPPED_VARIABLE_MANA',
        card.id,
        'manaCost.hasX',
        'this cost contains X, and the Forge exporter has no source-proven X payment mapping',
      ),
    );
  }
  lines.push(`ManaCost:${isCastable(card) ? forgeManaCost(card.manaCost) : 'no cost'}`);
  lines.push(`Types:${forgeTypeLine(card)}`);
  // Starting loyalty is a line of its own and never a `PT:`, which is the same
  // separation `PlaneswalkerCardSchema` makes: loyalty is source state, not a
  // characteristic. Forge reads it from `Loyalty:` and puts the counters on the
  // permanent as it enters.
  if (card.kind === 'planeswalker') lines.push(`Loyalty:${card.startingLoyalty}`);
  if (card.kind === 'creature') {
    if (card.characteristicPowerToughness !== undefined) {
      rejections.push(
        rejection(
          'UNMAPPED_CHARACTERISTIC_VALUE',
          card.id,
          'characteristicPowerToughness',
          'this creature has a characteristic-defining P/T value, and exporting its 0/0 storage sentinel would change the card',
        ),
      );
    }
    lines.push(`PT:${creaturePT(card)}`);
  }
  lines.push(...keywordLines(card, rejections));
  if (isAuraCard(card)) {
    const aura = auraScript(card, card.id, 'aura');
    if (aura.ok) lines.push(...aura.value.lines);
    else rejections.push(...aura.rejections);
  }
  lines.push(...abilityLines(card, abilityTokens, abilityDeckHas, rejections));

  const block = abilityBlock(card, rejections);
  lines.push(...block.lines);
  const deckHas = [...abilityDeckHas, ...block.deckHas.filter((hint) => !abilityDeckHas.includes(hint))];
  if (deckHas.length > 0) lines.push(`DeckHas:Ability$${deckHas.join('|')}`);
  lines.push(`Oracle:${escapeNewlines(renderOracleText(card))}`);

  if (rejections.length > 0) return { ok: false, rejections };
  return { ok: true, value: { lines, tokens: [...abilityTokens, ...block.tokens] } };
}

function creaturePT(card: CreatureCard): string {
  return `${card.power}/${card.toughness}`;
}

/**
 * Token spec -> Forge token script, matching `res/tokenscripts` exactly.
 *
 * The type line and the `PT:` line follow the token's body: stats mean a
 * creature token, no stats mean an artifact token, and `tokenCard` is where
 * that rule lives so this function reads it rather than restating it. A part
 * token in the flagship set is the second kind, and it writes no `PT:` at all
 * rather than `PT:0/0`.
 *
 * Printed abilities take the same `S:`, `T:` and `A:` lines a card's do, from
 * the same `transpileAbility`. A token cannot carry an ability that creates
 * another token (`TokenEffectSchema` excludes `createToken`), which is why the
 * token list that call returns is not collected here: there is nowhere in
 * `collectTokenFiles` for a token declared by a token to be written, and the
 * DSL is what makes sure none exists.
 *
 * Unmapped keywords and untranspilable abilities are both impossible here —
 * `transpileEffect` rejects the token before it reaches this function — so
 * reaching either state is a broken invariant and throws rather than emitting a
 * token missing half its text.
 */
export function transpileTokenScript(token: TokenSpec): string {
  const lines = [`Name:${forgeTokenDisplayName(token)}`, 'ManaCost:no cost'];
  const colors = sortColors(token.colors);
  if (colors.length > 0) {
    lines.push(`Colors:${colors.map((color) => FORGE_COLOR_WORDS[color]).join(',')}`);
  }
  const subtypes = token.subtypes.length > 0 ? ` ${token.subtypes.join(' ')}` : '';
  const creature = isCreatureTokenSpec(token);
  lines.push(`Types:${creature ? 'Creature' : 'Artifact'}${subtypes}`);
  if (creature) lines.push(`PT:${token.power}/${token.toughness}`);
  for (const keyword of sortKeywords(token.keywords)) {
    const forgeKeyword = FORGE_KEYWORDS[keyword];
    if (forgeKeyword === undefined) {
      throw new TranspileError(
        [
          rejection(
            'UNMAPPED_KEYWORD',
            forgeTokenScriptName(token),
            'keywords',
            `token keyword "${keyword}" has no Forge K: mapping`,
          ),
        ],
        'token script',
      );
    }
    lines.push(`K:${forgeKeyword}`);
  }
  for (const [index, ability] of tokenAbilities(token).entries()) {
    const result = transpileAbility(ability, index, forgeTokenScriptName(token), `abilities[${index}]`);
    if (!result.ok) throw new TranspileError(result.rejections, 'token script');
    lines.push(...result.value.lines);
  }
  lines.push(`Oracle:${escapeNewlines(renderTokenOracleText(token))}`);
  return `${lines.join('\n')}\n`;
}

/** File name of a token script, without the `.txt` extension. */
export { forgeTokenScriptName };
