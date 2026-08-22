#!/usr/bin/env -S npx tsx
/**
 * `tsx packages/setgen/tools/removal-census.ts <set.json> [...]` — how many
 * ways each named pool answers a permanent, bucketed by *how*, and how much of
 * that answer costs the caster nothing but mana.
 *
 * The third census beside `pool-census.ts` (what a pool's cards do) and
 * `shape-census.ts` (what a pool's cards are). This one asks the question a
 * player asks after a game rather than the one a gate asks before one: when
 * this set answers a creature, what happens to the creature, and what did the
 * answer cost. It exists because that question was answered by impression —
 * "removal is hyper-powerful" is a true sentence or a false one and nothing in
 * the repository could tell which.
 *
 * ## The four readings, in the order they matter
 *
 *  1. **Destroy and exile are kept apart.** They read alike on a card and play
 *     nothing alike: a destroyed creature dies, so it triggers its own death
 *     ability, fills a graveyard somebody is building on, and can be regenerated
 *     or recurred. An exiled one does none of that. A census that folded them
 *     together would report the same number for a set that answers creatures and
 *     a set that deletes them.
 *  2. **Every condition on the slot is recorded**, and a condition is anything
 *     that narrows what the spell may be aimed at or charges something beyond
 *     the mana: a `restriction`, a `filter`, a slot that can only reach your own
 *     creature or the defending player's, a toll clause, a modal choice. Both
 *     narrowing fields are read, because a card carrying only one of them is
 *     still a card you cannot always cast at the creature you want to kill.
 *  3. **The unconditional single-target premium count is the headline**, per
 *     rarity: destroy or exile, one creature, no sweep, no condition. That is
 *     the number a limited environment is decided by, and it is reported as a
 *     share of the rarity's own pool so two pools of different sizes compare.
 *  4. **The other direction is counted too** — toll clauses, counterspells,
 *     damage prevention, the instant share, and the triggered abilities by
 *     condition. A set can be short on interaction while being long on removal;
 *     those are different complaints and this prints both.
 *
 * ## What it is not
 *
 * It is not a judgment. It reports counts and names, and whether a count is too
 * high is a question for a person looking at two columns. Which is why several
 * pools are allowed and why the reduced reference sets are the intended second
 * column: `npm run reference:reduced` writes a real core set as a DSL set file,
 * so the same instrument reads the yardstick and the subject with no second
 * derivation of the word "removal".
 *
 * **It reads and never writes**, and every pool is an argument. A census with a
 * path baked into it keeps answering about whichever set was interesting the day
 * it was written.
 *
 *   tsx packages/setgen/tools/removal-census.ts out/reference/m11/set.json
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReducedReferenceSetDocumentSchema } from '@mtg/data';
import { RARITIES, cardManaValue, isAuraCard } from '@mtg/dsl';
import type { Ability, Card, Effect, Rarity, TargetSpec } from '@mtg/dsl';
import { parseSetFile } from '../src/index';

/** How a card takes a permanent off the battlefield, or takes it out of the game. */
export const REMOVAL_BUCKETS = [
  'destroy',
  'exile',
  'bounce',
  'tapDown',
  'shrink',
  'damage',
  'auraPacify',
  'auraShrink',
  'auraSteal',
  'auraLockdown',
] as const;
export type RemovalBucket = (typeof REMOVAL_BUCKETS)[number];

/** What the removal is pointed at, which is not the same question as how. */
export type RemovalTargetClass = 'creature' | 'artifactOrEnchantment' | 'permanent';

/**
 * How much a `damage` row deals, or `'dynamic'` when the card names a
 * computed `Amount` (an X spell, a count off the board) rather than a
 * literal number. A row count alone answers "how many cards" and not "how
 * much creature these cards actually reach" — two 1-damage pingers and two
 * 5-damage burn spells are the same row count and different formats.
 */
export type DamageAmount = number | 'dynamic';

export interface RemovalRow {
  readonly card: string;
  readonly rarity: Rarity;
  readonly manaValue: number;
  readonly colors: string;
  readonly bucket: RemovalBucket;
  readonly targetClass: RemovalTargetClass;
  /** True when it reaches a region of the board rather than one named object. */
  readonly sweep: boolean;
  /** Every narrowing or toll the slot carries; empty is the whole finding. */
  readonly conditions: readonly string[];
  /** Only set for `bucket === 'damage'`; every other bucket leaves it unset. */
  readonly amount?: DamageAmount;
  /**
   * True when the damage is printed on an activated or triggered ability
   * rather than a one-shot spell: the same source can fire every turn a
   * combat or a trigger condition recurs, so it answers more than one row
   * over a game even though it is one row in this census.
   */
  readonly repeatable?: boolean;
}

export interface InteractionCensus {
  /** Cards printing a CR 118.8 toll clause. */
  readonly tolls: readonly string[];
  readonly counterspells: readonly string[];
  readonly damagePrevention: readonly string[];
  readonly instants: number;
  /** Triggered abilities by condition, most printed first. */
  readonly triggers: readonly (readonly [string, number])[];
}

export interface RemovalCensus {
  /** What the pool was named on the command line. */
  readonly subject: string;
  readonly cards: number;
  readonly pool: ReadonlyMap<Rarity, number>;
  readonly rows: readonly RemovalRow[];
  readonly interaction: InteractionCensus;
  /** How many of this pool's own cards are creatures. */
  readonly creatures: number;
  /** This pool's own creatures, counted by printed toughness. */
  readonly toughness: ReadonlyMap<number, number>;
}

const BUCKET_OF_EFFECT: Partial<Record<Effect['kind'], RemovalBucket>> = {
  destroyPermanent: 'destroy',
  exileTarget: 'exile',
  returnToHand: 'bounce',
  tapPermanent: 'tapDown',
  pumpUntilEndOfTurn: 'shrink',
  dealDamage: 'damage',
};

/**
 * Slots that can name a creature on the battlefield. `anyTarget` is in because
 * a burn spell aimed at a face is aimed at a creature just as often, and a
 * census that only counted the slots named "creature" would report zero removal
 * for a red deck.
 */
const CREATURE_SLOTS: ReadonlySet<TargetSpec['kind']> = new Set([
  'targetCreature',
  'anyTarget',
  'targetCreatureYouControl',
  'targetCreatureYouDontControl',
  'targetCreatureDefendingPlayerControls',
  'triggeringCreature',
]);

function targetClassOf(target: TargetSpec): RemovalTargetClass | undefined {
  if (target.kind === 'targetArtifactOrEnchantment') return 'artifactOrEnchantment';
  if (target.kind === 'targetPermanent') return 'permanent';
  if (CREATURE_SLOTS.has(target.kind)) return 'creature';
  return undefined;
}

function conditionsOf(target: TargetSpec, card: Card, home: string): readonly string[] {
  const conditions: string[] = [];
  const restriction = target.restriction;
  if (restriction !== undefined) conditions.push(`restrict:${restriction.kind}`);
  const filter = target.filter;
  if (filter !== undefined) {
    for (const field of Object.keys(filter).sort()) conditions.push(`filter:${field}`);
  }
  if (target.kind === 'targetCreatureDefendingPlayerControls') conditions.push('slot:defendingPlayerOnly');
  if (target.kind === 'targetCreatureYouControl') conditions.push('slot:yourOwnCreature');
  if (card.unless !== undefined) conditions.push('toll:unless');
  if (card.modes !== undefined) conditions.push('modal');
  if (home !== 'spell') conditions.push(`home:${home}`);
  return conditions;
}

/**
 * Every effect a card prints and where it prints it. A destroy inside an
 * activated ability is removal, but it is removal that costs a permanent and a
 * turn, so the home rides along as a condition rather than being dropped.
 */
function* walkEffects(card: Card): Generator<readonly [Effect, string]> {
  for (const effect of card.effects ?? []) yield [effect, 'spell'];
  for (const mode of card.modes ?? []) for (const effect of mode.effects) yield [effect, 'spell'];
  for (const ability of card.abilities ?? []) {
    for (const effect of effectsOfAbility(ability)) yield [effect, homeOfAbility(ability)];
  }
}

function effectsOfAbility(ability: Ability): readonly Effect[] {
  return 'effects' in ability && Array.isArray(ability.effects) ? ability.effects : [];
}

function homeOfAbility(ability: Ability): string {
  if (ability.kind === 'triggered') return `trigger:${ability.condition}`;
  return ability.kind;
}

/**
 * An Aura that neutralizes, shrinks or steals a creature is removal printed as
 * a permanent, and the player it is used against feels no difference. It is
 * separated into its own buckets rather than folded into `destroy` because it
 * is answerable: the enchanted creature comes back the moment the Aura leaves.
 */
function auraRows(card: Card): readonly (readonly [RemovalBucket, readonly string[]])[] {
  if (!isAuraCard(card)) return [];
  const rows: (readonly [RemovalBucket, readonly string[]])[] = [];
  for (const modification of card.aura.modifications) {
    if (modification.kind === 'gainControl') rows.push(['auraSteal', []]);
    else if (modification.kind === 'cantAttack' || modification.kind === 'cantBlock')
      rows.push(['auraPacify', ['aura:removable']]);
    else if (modification.kind === 'doesNotUntap') rows.push(['auraLockdown', ['aura:removable']]);
    else if (modification.kind === 'statBonus' && modification.toughness < 0)
      rows.push(['auraShrink', ['aura:removable']]);
    else if (modification.kind === 'statBonusPer') rows.push(['auraShrink', ['aura:removable', 'scaling']]);
  }
  return [...new Map(rows.map((row) => [`${row[0]}:${row[1].join(',')}`, row])).values()];
}

function removalRows(card: Card): readonly RemovalRow[] {
  const base = {
    card: card.name,
    rarity: card.rarity,
    manaValue: cardManaValue(card),
    colors: card.colors.join('') || 'C',
  };
  const rows: RemovalRow[] = [];
  const seen = new Set<string>();
  for (const [effect, home] of walkEffects(card)) {
    const bucket = BUCKET_OF_EFFECT[effect.kind];
    if (bucket === undefined) continue;
    // A pump is removal only downward; +2/+2 is in the same effect kind.
    if (effect.kind === 'pumpUntilEndOfTurn') {
      const toughness = effect.toughness;
      if (typeof toughness !== 'number' || toughness >= 0) continue;
    }
    const scope = 'scope' in effect ? effect.scope : undefined;
    const sweep = scope !== undefined;
    // Every bucketed kind carries a slot; the guard is what narrows the union.
    const target = 'target' in effect ? effect.target : undefined;
    if (target === undefined) continue;
    const targetClass = sweep ? sweepClassOf(scope) : targetClassOf(target);
    if (targetClass === undefined) continue;
    const conditions = sweep ? [] : conditionsOf(target, card, home);
    const key = `${bucket}/${targetClass}/${String(sweep)}/${conditions.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const repeatable = home !== 'spell';
    if (effect.kind === 'dealDamage') {
      const amount: DamageAmount = typeof effect.amount === 'number' ? effect.amount : 'dynamic';
      rows.push({ ...base, bucket, targetClass, sweep, conditions, amount, repeatable });
    } else {
      rows.push({ ...base, bucket, targetClass, sweep, conditions, repeatable });
    }
  }
  for (const [bucket, conditions] of auraRows(card)) {
    rows.push({ ...base, bucket, targetClass: 'creature', sweep: false, conditions });
  }
  return rows;
}

function sweepClassOf(scope: string): RemovalTargetClass {
  return scope.includes('reature') ? 'creature' : 'permanent';
}

/**
 * The number this instrument exists to produce: destroy or exile, one named
 * creature, nothing narrowing the slot and nothing to pay but the mana cost.
 */
export function isUnconditionalPremium(row: RemovalRow): boolean {
  return (
    (row.bucket === 'destroy' || row.bucket === 'exile') &&
    row.targetClass === 'creature' &&
    !row.sweep &&
    row.conditions.length === 0
  );
}

function interactionCensus(cards: readonly Card[]): InteractionCensus {
  const named = (predicate: (card: Card) => boolean): readonly string[] =>
    cards.filter(predicate).map((card) => card.name);
  const printsEffect = (card: Card, kinds: readonly Effect['kind'][]): boolean =>
    [...walkEffects(card)].some(([effect]) => kinds.includes(effect.kind));
  const triggers = new Map<string, number>();
  for (const card of cards) {
    for (const ability of card.abilities ?? []) {
      if (ability.kind !== 'triggered') continue;
      triggers.set(ability.condition, (triggers.get(ability.condition) ?? 0) + 1);
    }
  }
  return {
    tolls: named((card) => card.unless !== undefined),
    counterspells: named((card) => printsEffect(card, ['counterSpell'])),
    damagePrevention: named((card) =>
      printsEffect(card, ['preventCombatDamage', 'preventAllDamageToTarget']),
    ),
    instants: cards.filter((card) => card.kind === 'instant').length,
    triggers: [...triggers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/**
 * The cards in a pool, whichever of the two documents the pool arrived as.
 *
 * A generated set and a reduced reference set both hold a list of `Card`, and
 * both are validated here rather than read as an object with a `cards` key,
 * because a census that read an arbitrary document would report zeros for a file
 * that is not a set at all — the reading that looks like a finding. They are two
 * documents rather than one because a reduced set carries the refusals that
 * produced it, and dropping that block to reuse one schema would throw away the
 * only record of what a real core set prints that this kernel cannot run.
 */
export function poolCards(document: unknown): readonly Card[] {
  const kind =
    typeof document === 'object' && document !== null && 'kind' in document
      ? (document as { readonly kind: unknown }).kind
      : undefined;
  if (kind === 'position-reduced-reference-set-document') {
    return ReducedReferenceSetDocumentSchema.parse(document).cards;
  }
  return parseSetFile(document).cards;
}

/**
 * This pool's own creatures, counted by printed toughness. It is read off the
 * same pool the damage rows come from, never off another pool or a fixed
 * reference curve — a 2-damage spell's reach depends on the toughness this
 * set's own creatures actually print, and that differs pool to pool.
 */
export function toughnessDistribution(cards: readonly Card[]): ReadonlyMap<number, number> {
  const distribution = new Map<number, number>();
  for (const card of cards) {
    if (card.kind !== 'creature') continue;
    distribution.set(card.toughness, (distribution.get(card.toughness) ?? 0) + 1);
  }
  return distribution;
}

/**
 * The share (0..1) of `totalCreatures` with toughness at or below `amount` —
 * the fraction of this pool's own creature curve one hit of that much damage
 * can put in the graveyard unassisted. `undefined` for a dynamic amount,
 * because a computed `Amount` has no single number to compare against a
 * toughness, and for an empty pool, because a share of zero creatures is not
 * a reading, it is a division by zero wearing a percentage sign.
 */
export function shareOfCreaturesAtOrBelow(
  distribution: ReadonlyMap<number, number>,
  totalCreatures: number,
  amount: DamageAmount,
): number | undefined {
  if (totalCreatures === 0 || amount === 'dynamic') return undefined;
  let killed = 0;
  for (const [toughness, count] of distribution) if (toughness <= amount) killed += count;
  return killed / totalCreatures;
}

/** The band a literal damage amount reports under; 5 and up share one row. */
export function damageBandOf(amount: DamageAmount): '1' | '2' | '3' | '4' | '5+' | 'dynamic' {
  if (amount === 'dynamic') return 'dynamic';
  if (amount >= 5) return '5+';
  return String(Math.max(1, amount)) as '1' | '2' | '3' | '4';
}

export function removalCensus(subject: string, document: unknown): RemovalCensus {
  const cards = poolCards(document);
  const pool = new Map<Rarity, number>(RARITIES.map((rarity) => [rarity, 0]));
  for (const card of cards) pool.set(card.rarity, (pool.get(card.rarity) ?? 0) + 1);
  return {
    subject,
    cards: cards.length,
    pool,
    rows: cards.flatMap(removalRows),
    interaction: interactionCensus(cards),
    creatures: cards.filter((card) => card.kind === 'creature').length,
    toughness: toughnessDistribution(cards),
  };
}

function share(part: number, whole: number): string {
  return whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`;
}

/**
 * The premium count per rarity, one column per pool, then the cards behind each
 * column's number. The share is printed beside the count because a set twice the
 * size prints twice the removal and is not twice as hostile.
 */
export function formatRemovalCensus(censuses: readonly RemovalCensus[]): string {
  const width = Math.max(16, ...censuses.map((census) => census.subject.length + 2));
  const lines: string[] = [];
  const column = (cell: (census: RemovalCensus) => string): string =>
    censuses.map((census) => cell(census).padStart(width)).join('');

  lines.push(`${'pool'.padEnd(28)}${column((census) => census.subject)}`);
  lines.push(`${'cards'.padEnd(28)}${column((census) => String(census.cards))}`);
  lines.push('');
  lines.push('-- creature removal, by how (single-target and sweep together) --');
  for (const bucket of REMOVAL_BUCKETS) {
    lines.push(
      `${bucket.padEnd(28)}${column((census) =>
        String(census.rows.filter((row) => row.bucket === bucket && row.targetClass === 'creature').length),
      )}`,
    );
  }
  lines.push('');
  lines.push('-- unconditional premium removal (one creature, destroy or exile, no condition) --');
  for (const rarity of RARITIES) {
    lines.push(
      `${rarity.padEnd(28)}${column((census) => {
        const found = census.rows.filter((row) => row.rarity === rarity && isUnconditionalPremium(row));
        return `${String(found.length)} (${share(found.length, census.pool.get(rarity) ?? 0)})`;
      })}`,
    );
  }
  lines.push('');
  lines.push('-- damage against creatures, banded by amount (reach, not just rows) --');
  const damageRows = (census: RemovalCensus): readonly RemovalRow[] =>
    census.rows.filter((row) => row.bucket === 'damage' && row.targetClass === 'creature');
  const DAMAGE_BANDS = ['1', '2', '3', '4', '5+', 'dynamic'] as const;
  const BAND_AMOUNT: Record<Exclude<(typeof DAMAGE_BANDS)[number], 'dynamic'>, number> = {
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5+': 5,
  };
  for (const band of DAMAGE_BANDS) {
    lines.push(
      `${`  amount ${band}`.padEnd(28)}${column((census) => {
        const rows = damageRows(census).filter(
          (row) => row.amount !== undefined && damageBandOf(row.amount) === band,
        );
        if (band === 'dynamic') return String(rows.length);
        const reach = shareOfCreaturesAtOrBelow(
          census.toughness,
          census.creatures,
          BAND_AMOUNT[band as Exclude<(typeof DAMAGE_BANDS)[number], 'dynamic'>],
        );
        const reachLabel = reach === undefined ? '-' : `${(100 * reach).toFixed(1)}%`;
        return `${String(rows.length)} (kills<=${reachLabel})`;
      })}`,
    );
  }
  lines.push(
    `${'  repeatable (activated/trigger)'.padEnd(28)}${column((census) =>
      String(damageRows(census).filter((row) => row.repeatable === true).length),
    )}`,
  );
  lines.push(
    `${'  one-shot (spell)'.padEnd(28)}${column((census) =>
      String(damageRows(census).filter((row) => row.repeatable !== true).length),
    )}`,
  );
  lines.push('');
  lines.push('-- interaction --');
  lines.push(`${'toll clauses (unless)'.padEnd(28)}${column((c) => String(c.interaction.tolls.length))}`);
  lines.push(`${'counterspells'.padEnd(28)}${column((c) => String(c.interaction.counterspells.length))}`);
  lines.push(
    `${'damage prevention'.padEnd(28)}${column((c) => String(c.interaction.damagePrevention.length))}`,
  );
  lines.push(
    `${'instants'.padEnd(28)}${column((c) => `${String(c.interaction.instants)} (${share(c.interaction.instants, c.cards)})`)}`,
  );
  lines.push(
    `${'triggered abilities'.padEnd(28)}${column((c) =>
      String(c.interaction.triggers.reduce((total, [, count]) => total + count, 0)),
    )}`,
  );
  for (const census of censuses) {
    lines.push('');
    lines.push(`[${census.subject}] the unconditional premium removal it prints`);
    const found = census.rows
      .filter(isUnconditionalPremium)
      .sort((a, b) => a.manaValue - b.manaValue || a.card.localeCompare(b.card));
    if (found.length === 0) lines.push('  none at any rarity');
    for (const row of found) {
      lines.push(
        `  ${row.rarity.padEnd(9)} mv${String(row.manaValue).padEnd(3)}${row.colors.padEnd(4)}${row.bucket.padEnd(9)}${row.card}`,
      );
    }
  }
  for (const census of censuses) {
    lines.push('');
    lines.push(`[${census.subject}] the creature-targeting damage it prints, by amount then mana value`);
    const found = [...damageRows(census)].sort(
      (a, b) =>
        (typeof a.amount === 'number' ? a.amount : Number.POSITIVE_INFINITY) -
          (typeof b.amount === 'number' ? b.amount : Number.POSITIVE_INFINITY) || a.manaValue - b.manaValue,
    );
    if (found.length === 0) lines.push('  none at any rarity');
    for (const row of found) {
      lines.push(
        `  amount${String(row.amount ?? '?').padEnd(8)} mv${String(row.manaValue).padEnd(3)}${row.rarity.padEnd(9)}${row.colors.padEnd(4)}${row.repeatable === true ? 'repeatable' : 'one-shot'.padEnd(10)} ${row.card}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * A column heading a reader can tell apart. A fixture is named for its set and
 * a reduced reference is written as `<code>/set.json`, so the file name alone
 * would head two columns "set.json" and the comparison the census exists for
 * would be unreadable.
 */
export function subjectOf(path: string): string {
  const stem = basename(path).replace(/\.set\.json$|\.json$/u, '');
  return stem === 'set' ? basename(dirname(path)) : stem;
}

export function main(argv: readonly string[]): number {
  if (argv.length === 0) throw new Error('usage: removal-census.ts <set.json> [<set.json> ...]');
  const censuses = argv.map((argument) => {
    const path = resolve(process.cwd(), argument);
    return removalCensus(subjectOf(path), JSON.parse(readFileSync(path, 'utf8')) as unknown);
  });
  console.log(formatRemovalCensus(censuses));
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
