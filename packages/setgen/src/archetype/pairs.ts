/**
 * The ten two-color archetypes, and what each one's plan is made of.
 *
 * Modern Limited seeds ten two-color pair archetypes and asks the designer to
 * answer, per pair, what its mechanical identity is
 * (`prior-art-set-design.md` §5, N&B #15). The slice prints no gold cards, so a
 * pair's plan has to be carried by mono-colored cards that both of its colors
 * can legally print — which means the plan is derivable rather than declared:
 * take the brief's mechanics that live in either color, keep the vocabulary the
 * mechanical color pie allows there, and that *is* the pair's payoff.
 *
 * The pair list itself is re-exported from `@mtg/deckbuild` rather than
 * restated: a second hand-written list of what a color pair is would be a
 * second thing that can disagree with the builder whose decks the balance sim
 * actually measures.
 */
import type { AbilityKind, Color, EffectKind, Keyword } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { ColorPair } from '@mtg/deckbuild';
import { COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { PieLevel } from '@mtg/design-data';
import { classify } from '@mtg/design-data';
import type { SetBrief } from '../brief';

export type { ColorPair };
export { COLOR_PAIRS as ARCHETYPE_PAIRS, colorPairKey as archetypeKey };

/** Signposts per color: ten pairs shared equally over the five color pools. */
export const SIGNPOSTS_PER_COLOR = COLOR_PAIRS.length / COLORS.length;

/** Ranking used when several payoff subjects are available in a color. */
const PIE_PREFERENCE: Readonly<Record<PieLevel, number>> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
  offPie: 3,
};

export interface ArchetypePlan {
  /** Canonical pair key in WUBRG order: `UR`. */
  readonly pair: string;
  readonly colors: ColorPair;
  /**
   * The color whose uncommon slots carry this pair's signpost. Each color
   * hosts exactly two of the ten pairs, so no color pays for four archetypes
   * out of four uncommon slots.
   */
  readonly host: Color;
  /** Brief mechanics that live in at least one of the pair's colors. */
  readonly mechanics: readonly string[];
  /** Keywords the pair's plan is expressed with, best color-pie placement first. */
  readonly payoffKeywords: readonly Keyword[];
  /** Effect primitives the pair's plan is expressed with. */
  readonly payoffEffects: readonly EffectKind[];
  /**
   * Ability kinds the payoff effects are printed inside, from the mechanics that
   * named them.
   *
   * A pair whose payoff is a keyword advertises it on the type line, and
   * `assignSignposts` stamps it. A pair whose payoff is an *effect* has no such
   * place to put it: a creature prints an effect only inside an ability, and
   * `checkAbilityKinds` refuses an ability on a slot the allocator gave no
   * kinds. So the plan carries the kinds forward, and the signpost is allocated
   * them — otherwise the archetype gate asks the signpost for vocabulary the
   * conformance gate forbids it, and no card satisfies both.
   *
   * Empty when the pair's payoff is a keyword, when the mechanics that carry it
   * name no ability kind, and when the brief names no payoff at all.
   */
  readonly payoffAbilityKinds: readonly AbilityKind[];
  /** One line for prompts and reports. */
  readonly identity: string;
}

function appliesToPair(colors: readonly Color[], pair: ColorPair): boolean {
  return colors.length === 0 || colors.some((color) => pair.includes(color));
}

/** Best on-pie placement of `subject` across the pair, or `undefined` if off-pie in both. */
function bestLevel(subject: Keyword | EffectKind, pair: ColorPair): PieLevel | undefined {
  const levels = pair
    .map((color) => classify(subject, color).level)
    .filter((level) => PIE_PREFERENCE[level] < PIE_PREFERENCE.offPie);
  return levels.sort((a, b) => PIE_PREFERENCE[a] - PIE_PREFERENCE[b])[0];
}

function onPieSubjects<T extends Keyword | EffectKind>(subjects: readonly T[], pair: ColorPair): T[] {
  const ranked = subjects
    .flatMap((subject) => {
      const level = bestLevel(subject, pair);
      return level === undefined ? [] : [{ subject, level }];
    })
    .sort((a, b) => PIE_PREFERENCE[a.level] - PIE_PREFERENCE[b.level]);
  return [...new Set(ranked.map((item) => item.subject))];
}

/**
 * Which color carries each pair's signpost.
 *
 * Walks the canonical pair order and gives each pair to the first of its two
 * colors that still has signpost capacity. With ten pairs, five colors and a
 * capacity of two, that assignment exists and is unique in this order — no
 * search and no hand-written wheel table.
 */
export function signpostHosts(): ReadonlyMap<string, Color> {
  const used = new Map<Color, number>(COLORS.map((color) => [color, 0]));
  const hosts = new Map<string, Color>();
  for (const pair of COLOR_PAIRS) {
    const host = pair.find((color) => (used.get(color) ?? 0) < SIGNPOSTS_PER_COLOR) ?? pair[1];
    used.set(host, (used.get(host) ?? 0) + 1);
    hosts.set(colorPairKey(pair), host);
  }
  return hosts;
}

function identityOf(plan: Omit<ArchetypePlan, 'identity'>): string {
  const vocabulary = [
    plan.payoffKeywords.length > 0 ? plan.payoffKeywords.join('/') : '',
    plan.payoffEffects.length > 0 ? plan.payoffEffects.join('/') : '',
  ]
    .filter((part) => part.length > 0)
    .join(' plus ');
  const mechanics = plan.mechanics.length > 0 ? ` (${plan.mechanics.join(', ')})` : '';
  return vocabulary.length === 0
    ? `${plan.pair}: bodies and answers only; the brief names no mechanic in either color`
    : `${plan.pair}: ${vocabulary}${mechanics}`;
}

/**
 * Derives all ten archetype plans from a brief. Deterministic and model-free:
 * the same brief always produces the same plans, which is what lets the
 * allocator reserve slots against them before any model call.
 */
export function planArchetypes(brief: SetBrief): readonly ArchetypePlan[] {
  const hosts = signpostHosts();
  return COLOR_PAIRS.map((pair): ArchetypePlan => {
    const key = colorPairKey(pair);
    const mechanics = brief.mechanics.filter((mechanic) => appliesToPair(mechanic.colors, pair));
    const payoffEffects = onPieSubjects(
      mechanics.flatMap((mechanic) => mechanic.effectKinds),
      pair,
    );
    const base = {
      pair: key,
      colors: pair,
      host: hosts.get(key) ?? pair[0],
      mechanics: mechanics.map((mechanic) => mechanic.name),
      payoffKeywords: onPieSubjects(
        mechanics.flatMap((mechanic) => mechanic.keywords),
        pair,
      ),
      payoffEffects,
      // Only the mechanics that actually survived the pie into this pair's
      // payoff: a mechanic whose every effect is off-pie here is not what the
      // signpost would be printing, so its ability kinds are not what the
      // signpost needs.
      payoffAbilityKinds: [
        ...new Set(
          mechanics
            .filter((mechanic) => mechanic.effectKinds.some((kind) => payoffEffects.includes(kind)))
            .flatMap((mechanic) => mechanic.abilityKinds),
        ),
      ],
    };
    return { ...base, identity: identityOf(base) };
  });
}

/** The plans a color appears in, in canonical pair order. */
export function plansForColor(plans: readonly ArchetypePlan[], color: Color): ArchetypePlan[] {
  return plans.filter((plan) => plan.colors.includes(color));
}

/** The plans a color hosts the signpost for. */
export function plansHostedBy(plans: readonly ArchetypePlan[], color: Color): ArchetypePlan[] {
  return plans.filter((plan) => plan.host === color);
}
