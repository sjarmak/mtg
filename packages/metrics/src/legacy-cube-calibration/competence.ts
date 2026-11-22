import { LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';

export interface BotCompetenceEvidence {
  readonly interaction: string;
  /** Exact implementation + configuration + binary digest, not a marketing name. */
  readonly bot: string;
  readonly status: 'passed' | 'failed' | 'unproven';
  readonly artifact: string;
  readonly seeds: readonly string[];
  /** Cards exercised together by this probe, not all cards in the interaction family. */
  readonly coverage?: readonly string[];
}

/** Trigger on the distinctive piece, not on generic ETBs, spells, or creatures. */
const PACKAGE_TRIGGERS: Readonly<Record<string, readonly string[]>> = {
  reanimate: ['reanimation'],
  'cheat-threat': ['cheat'],
  'blink-etb': ['blink'],
  'artifact-engine': ['artifact-payoff'],
  'spells-density': ['spells-payoff'],
  'sacrifice-loop': ['sacrifice-outlet', 'sacrifice-payoff'],
  'mana-ramp': ['ramp-payoff'],
  'graveyard-value': ['graveyard-payoff'],
  'tokens-wide': ['go-wide-payoff'],
  'opposition-tokens': ['tap-payoff'],
  equipment: ['equipment'],
  'natural-order': ['natural-order'],
  'creature-toolbox': ['creature-density-payoff'],
  'twin-combo': ['twin-copy'],
  'kiki-combo': ['kiki-copy'],
  'land-recursion': ['land-recursion'],
  'upheaval-mana': ['mana-reset'],
};

export function competenceForDeck(
  cards: readonly PrintedCardCatalogEntry[],
  evidence: readonly BotCompetenceEvidence[],
  bot: string,
) {
  const profiles = cards.map((card) => {
    const profile = LEGACY_CUBE_ADVISOR_MODEL.profilesByName?.get(card.correctedName);
    if (!profile) throw new Error(`Missing competence metadata for ${card.correctedName}`);
    return profile;
  });
  const tags = new Set(profiles.flatMap((p) => p.tags));
  for (const recipe of LEGACY_CUBE_ADVISOR_MODEL.packages) {
    if (!PACKAGE_TRIGGERS[recipe.id]) throw new Error(`Missing competence gate for ${recipe.id}`);
  }
  const required = [
    'fundamentals',
    ...Object.entries(PACKAGE_TRIGGERS)
      .filter(([, triggers]) => triggers.some((tag) => tags.has(tag)))
      .map(([id]) => id),
  ];
  const checks = required.map((id) => {
    const reports = evidence.filter((e) => e.interaction === id && e.bot === bot);
    const needs = LEGACY_CUBE_ADVISOR_MODEL.packages.find((p) => p.id === id)?.needs ?? [];
    const relevant = profiles.filter((p) => needs.some((n) => p.tags.includes(n.tag))).map((p) => p.name);
    const invalid =
      reports.length === 0 ||
      reports.some(
        (e) =>
          e.status !== 'passed' || !e.artifact.trim() || new Set(e.seeds.filter((s) => s.trim())).size < 2,
      );
    // Do not manufacture a tested combination by unioning unrelated fixtures.
    const covered =
      id === 'fundamentals' ||
      reports.some((e) => relevant.length > 0 && relevant.every((name) => e.coverage?.includes(name)));
    return { interaction: id, cards: relevant, missing: invalid || !covered };
  });
  const missing = checks.filter((c) => c.missing).map((c) => c.interaction);
  const uncovered = checks.filter((c) => c.missing).map(({ interaction, cards }) => ({ interaction, cards }));
  return { required, missing, uncovered, eligible: missing.length === 0 };
}
