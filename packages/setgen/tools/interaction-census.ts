#!/usr/bin/env -S npx tsx
/**
 * `tsx packages/setgen/tools/interaction-census.ts <set.json>` — what a finished
 * pool prints in the four places interaction is printed: triggers, activated
 * abilities, continuous clauses, and the narrowing on a target.
 *
 * the original interaction-lever study took this reading once, by hand, off a
 * scratch script that was never committed, and every share in it has been at a
 * denominator of 368 ever since the three cards it recommended were printed.
 * That document is frozen on purpose — its counts are the evidence behind a
 * decision, not a description of the set — so the repair is not to re-date it.
 * It is this: the same questions, asked by committed code, over whichever pool
 * the caller names. `tools/pool-census.ts` is the same move one drawer over and
 * this file follows its shape deliberately.
 *
 * **It reads and never writes.** No set file, no fixture, no report; the pool
 * arrives as an argument and stdout is the whole output.
 *
 * # What the walk covers
 *
 * A card's whole printed account, tokens included, at every depth. That is
 * `printedAbilityKinds`' walk and the workspace's existing answer to what a card
 * prints, and modal cards are read in full for the reason `cardOwnEffects`
 * states: a census has no game and no chosen mode, so every mode a card can
 * print is part of the card.
 *
 * One reading is taken twice rather than behind a flag. Every ability printed on
 * a token in this set's flagship pool is an activated ability, so the descent
 * moves that one count and nothing else: 45 abilities on 39 cards printed, 96 on
 * 72 once the tokens those cards mint are counted. Both sentences are true and
 * two documents already quote the first, so `ActivatedCensus` carries both and
 * says which is which. The by-kind and by-rarity rows are over the printed
 * reading alone, because a kind and a rarity belong to the card: three of the
 * cards the descended count adds are sorceries, and a sorcery does not have an
 * activated ability — a token it makes does.
 *
 * # What it cannot read, and does not guess
 *
 * Provenance. The report split its activated abilities 23 hand-authored against
 * 22 generated, and a set file records no such thing: `printAuthoredCards` needs
 * the brief, and this tool takes a pool. A census that inferred it from an id
 * prefix would be reporting a naming convention.
 *
 * # A target spec is found by parsing, not by field name
 *
 * The narrowing count walks the card's own JSON and asks `TargetSpecSchema`
 * whether each object is a target spec. Forty-one effect builders in
 * `packages/dsl/src/effects.ts` take the spec as a parameter and a reader that
 * matched the field name `target` would be counting the ones that happen to
 * spell it that way today. The schema is a `strictObject` over `TARGET_KINDS`,
 * so nothing else in the DSL parses as one, and a spec that moves to a new field
 * or a new depth is still found.
 *
 *   tsx packages/setgen/tools/interaction-census.ts packages/setgen/fixtures/sets/tideglass-reach.set.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isManaEffect,
  printedCardSurface,
  STATIC_SCOPES,
  TargetSpecSchema,
  TRIGGER_CONDITIONS,
} from '@mtg/dsl';
import type { Card, PrintedAbility, TargetSpec, TriggerCondition } from '@mtg/dsl';
import { parseSetFile } from '../src/index';

/** One label and the count standing against it. */
export interface LabeledCount {
  readonly label: string;
  readonly count: number;
}

export interface TriggerCensus {
  /** Triggered abilities printed, counting each ability once. */
  readonly abilities: number;
  /** Cards carrying at least one. */
  readonly cards: number;
  /** Abilities per condition, most first. */
  readonly conditions: readonly LabeledCount[];
  /** Members of `TRIGGER_CONDITIONS` this pool prints on nothing. */
  readonly unprinted: readonly TriggerCondition[];
}

export interface ActivatedCensus {
  /** Activated abilities printed on the cards themselves. */
  readonly abilities: number;
  /** Cards printing one. */
  readonly cards: number;
  /** The same two counts once the tokens those cards create are walked. */
  readonly boardAbilities: number;
  readonly boardCards: number;
  /** Cards printing one, by the card's kind. Printed reading; the docblock says why. */
  readonly byCardKind: readonly LabeledCount[];
  /** Cards printing one, by the card's rarity. */
  readonly byRarity: readonly LabeledCount[];
  /** Printed abilities that add mana, which do nothing to a board. */
  readonly manaAbilities: number;
  /** Cards whose every printed activated ability adds mana. */
  readonly manaOnlyCards: number;
}

export interface StaticCensus {
  /** Abilities of kind `static`, which is the scope the modification tally is over. */
  readonly abilities: number;
  readonly cards: number;
  /** Abilities per modification kind, most first. */
  readonly modifications: readonly LabeledCount[];
  /** Abilities per scope, in `STATIC_SCOPES` order, so an unused scope still prints. */
  readonly scopes: readonly LabeledCount[];
}

export interface TargetCensus {
  /** Target specs printed, at every depth. */
  readonly specs: number;
  /** Specs carrying a `restriction`, a `filter`, or both. */
  readonly narrowed: number;
  /** Cards carrying at least one narrowed spec. */
  readonly narrowedCards: number;
  /** Narrowed specs per restriction kind, most first. */
  readonly restrictions: readonly LabeledCount[];
  /** Narrowed specs per filter field named, most first. */
  readonly filterFields: readonly LabeledCount[];
  /** Specs narrowed by combat role, the lever the report was written about. */
  readonly combat: number;
}

export interface InteractionCensus {
  /** Every card in the pool, and the denominator of every share below. */
  readonly cards: number;
  /** Cards per kind, most first. */
  readonly kinds: readonly LabeledCount[];
  readonly triggers: TriggerCensus;
  readonly activated: ActivatedCensus;
  readonly statics: StaticCensus;
  readonly targets: TargetCensus;
  /** Cards printing a cost reduction at all. */
  readonly costReductionCards: number;
}

/** Every ability printed on this card's account, its tokens' lines included. */
function abilitiesOf(card: Card): readonly PrintedAbility[] {
  return printedCardSurface(card).abilities;
}

function isActivated(ability: PrintedAbility): boolean {
  return ability.kind === 'activated';
}

function addsMana(ability: PrintedAbility): boolean {
  return ability.kind === 'activated' && ability.effects.some((effect) => isManaEffect(effect.kind));
}

/** Counts by label, most first and ties by label, so two runs print one order. */
function rank(counts: ReadonlyMap<string, number>): readonly LabeledCount[] {
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function tallyBy<T>(items: readonly T[], label: (item: T) => string): readonly LabeledCount[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(label(item), (counts.get(label(item)) ?? 0) + 1);
  return rank(counts);
}

/**
 * Every target spec printed anywhere on this card, found by parsing rather than
 * by field name; the docblock argues why.
 *
 * A spec that parses is still descended into, which costs one failed parse per
 * `restriction` and `filter` and keeps the walk from having to know the shape.
 */
export function printedTargetSpecs(value: unknown): readonly TargetSpec[] {
  const found: TargetSpec[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const parsed = TargetSpecSchema.safeParse(node);
    if (parsed.success) found.push(parsed.data);
    for (const nested of Object.values(node)) walk(nested);
  };
  walk(value);
  return found;
}

function isNarrowed(spec: TargetSpec): boolean {
  return spec.restriction !== undefined || spec.filter !== undefined;
}

/** Which fields a filter actually names, since every one of them is optional. */
function filterFieldsNamed(spec: TargetSpec): readonly string[] {
  const filter = spec.filter;
  if (filter === undefined) return [];
  return Object.entries(filter)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
}

function triggerCensus(cards: readonly Card[]): TriggerCensus {
  const triggered = cards.flatMap((card) =>
    abilitiesOf(card).filter((ability) => ability.kind === 'triggered'),
  );
  const conditions = tallyBy(triggered, (ability) => ability.condition);
  const printed = new Set(conditions.map((entry) => entry.label));
  return {
    abilities: triggered.length,
    cards: cards.filter((card) => abilitiesOf(card).some((ability) => ability.kind === 'triggered')).length,
    conditions,
    unprinted: TRIGGER_CONDITIONS.filter((condition) => !printed.has(condition)),
  };
}

function activatedCensus(cards: readonly Card[]): ActivatedCensus {
  const printed = cards.filter((card) => card.abilities.some(isActivated));
  const abilities = cards.flatMap((card) => card.abilities.filter(isActivated));
  return {
    abilities: abilities.length,
    cards: printed.length,
    boardAbilities: cards.flatMap((card) => abilitiesOf(card).filter(isActivated)).length,
    boardCards: cards.filter((card) => abilitiesOf(card).some(isActivated)).length,
    byCardKind: tallyBy(printed, (card) => card.kind),
    byRarity: tallyBy(printed, (card) => card.rarity),
    manaAbilities: abilities.filter(addsMana).length,
    manaOnlyCards: printed.filter((card) => card.abilities.filter(isActivated).every(addsMana)).length,
  };
}

function staticCensus(cards: readonly Card[]): StaticCensus {
  const statics = cards.flatMap((card) => abilitiesOf(card).filter((ability) => ability.kind === 'static'));
  const scopes = new Map<string, number>(STATIC_SCOPES.map((scope) => [scope, 0]));
  for (const ability of statics) scopes.set(ability.scope, (scopes.get(ability.scope) ?? 0) + 1);
  return {
    abilities: statics.length,
    cards: cards.filter((card) => abilitiesOf(card).some((ability) => ability.kind === 'static')).length,
    modifications: tallyBy(statics, (ability) => ability.modification.kind),
    scopes: STATIC_SCOPES.map((scope) => ({ label: scope, count: scopes.get(scope) ?? 0 })),
  };
}

function targetCensus(cards: readonly Card[]): TargetCensus {
  const specs = cards.flatMap((card) => printedTargetSpecs(card));
  const narrowed = specs.filter(isNarrowed);
  return {
    specs: specs.length,
    narrowed: narrowed.length,
    narrowedCards: cards.filter((card) => printedTargetSpecs(card).some(isNarrowed)).length,
    restrictions: tallyBy(
      narrowed.flatMap((spec) => (spec.restriction === undefined ? [] : [spec.restriction])),
      (restriction) => restriction.kind,
    ),
    filterFields: tallyBy(narrowed.flatMap(filterFieldsNamed), (field) => field),
    combat: narrowed.filter((spec) => spec.filter?.combat !== undefined).length,
  };
}

export function interactionCensus(cards: readonly Card[]): InteractionCensus {
  return {
    cards: cards.length,
    kinds: tallyBy(cards, (card) => card.kind),
    triggers: triggerCensus(cards),
    activated: activatedCensus(cards),
    statics: staticCensus(cards),
    targets: targetCensus(cards),
    costReductionCards: cards.filter((card) => card.costReduction !== null).length,
  };
}

function share(count: number, of: number): string {
  return of === 0 ? '  n/a' : `${((count / of) * 100).toFixed(1)}%`.padStart(6);
}

function row(entry: LabeledCount, of: number): string {
  return `  ${entry.label.padEnd(40)}${String(entry.count).padStart(4)}${share(entry.count, of)}`;
}

/** A row counting abilities rather than cards, where a share of cards would mislead. */
function plainRow(entry: LabeledCount): string {
  return `  ${entry.label.padEnd(40)}${String(entry.count).padStart(4)}`;
}

export function formatInteractionCensus(census: InteractionCensus, subject: string): string {
  const { triggers, activated, statics, targets } = census;
  const of = census.cards;
  return [
    `subject: ${subject}`,
    `denominator: ${String(of)} cards`,
    'walk: the whole printed account of each card, the abilities of the tokens it creates included',
    'modal cards: every mode is read, not the one a game would choose',
    'provenance: not read; a set file does not record which cards were generated',
    '',
    'cards by kind',
    ...census.kinds.map((entry) => row(entry, of)),
    '',
    `triggered abilities: ${String(triggers.abilities)} across ${String(triggers.cards)} cards` +
      ` (${share(triggers.cards, of).trim()} of the pool)`,
    ...triggers.conditions.map(plainRow),
    `  ${String(triggers.unprinted.length)} of ${String(TRIGGER_CONDITIONS.length)} trigger conditions printed on nothing: ${triggers.unprinted.join(', ')}`,
    '',
    `activated abilities: ${String(activated.abilities)} printed across ${String(activated.cards)} cards` +
      ` (${share(activated.cards, of).trim()} of the pool)`,
    ...activated.byCardKind.map(plainRow),
    ...activated.byRarity.map(plainRow),
    `  ${'abilities that add mana'.padEnd(40)}${String(activated.manaAbilities).padStart(4)}`,
    `  ${'cards whose every one adds mana'.padEnd(40)}${String(activated.manaOnlyCards).padStart(4)}`,
    `  with the tokens those cards create: ${String(activated.boardAbilities)} abilities across` +
      ` ${String(activated.boardCards)} cards. The rows above are the printed reading, because a` +
      ` kind and a rarity belong to the card rather than to a token it mints.`,
    '',
    `static abilities: ${String(statics.abilities)} across ${String(statics.cards)} cards` +
      ` (${share(statics.cards, of).trim()} of the pool)`,
    ...statics.modifications.map(plainRow),
    '  by scope, every member of STATIC_SCOPES, so an unused one still prints',
    ...statics.scopes.map(plainRow),
    '',
    `target specs: ${String(targets.specs)} printed, ${String(targets.narrowed)} narrowed by a` +
      ` restriction or a filter, across ${String(targets.narrowedCards)} cards`,
    ...targets.restrictions.map((entry) => plainRow({ ...entry, label: `restriction ${entry.label}` })),
    ...targets.filterFields.map((entry) => plainRow({ ...entry, label: `filter ${entry.label}` })),
    `  ${'narrowed by combat role'.padEnd(40)}${String(targets.combat).padStart(4)}`,
    '',
    `  ${'cards printing a cost reduction'.padEnd(40)}${String(census.costReductionCards).padStart(4)}${share(census.costReductionCards, of)}`,
  ].join('\n');
}

export function parseInteractionCensusArgs(argv: readonly string[]): string {
  const paths = argv.filter((arg) => !arg.startsWith('--'));
  const path = paths[0];
  if (path === undefined || paths.length > 1 || argv.length !== paths.length) {
    throw new Error('usage: interaction-census.ts <set.json>');
  }
  return resolve(process.cwd(), path);
}

export function main(argv: readonly string[]): number {
  const path = parseInteractionCensusArgs(argv);
  const set = parseSetFile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  console.log(formatInteractionCensus(interactionCensus(set.cards), path));
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
