/**
 * The deck as a self-contained document a browser can render.
 *
 * `formatConstructedDeckReport` prints the same facts for a terminal, and
 * nothing else in the package serializes a deck, so this is where a built deck
 * becomes data somebody else can consume. The artifact carries its own art
 * URLs: the store holds 38,623 printings with `image_uris` and the only way
 * that reaches a page is if the Node side that already has a database handle
 * reads it here. The browser gets a static JSON file and never learns the store
 * exists.
 *
 * Self-contained is the load-bearing word. A committed artifact renders on a
 * checkout with no database, no API key and no model call, which is what makes
 * `npm run lab` work the way `npm run play` does. That means every number the
 * page prints is in this file's output — including the castability bands, so
 * the panel quotes the threshold the deck was actually held to rather than a
 * constant copied into the UI and left to drift.
 */
import type { DataStore } from '@mtg/data';
import { findCardsByName, getPrintings } from '@mtg/data';
import type { Color } from '@mtg/dsl';
import { BASIC_LAND_FOR_COLOR, COLORS } from '@mtg/dsl';
import { CURVE_BUCKETS } from '@mtg/deckbuild';
import type { CurveBucket } from '@mtg/deckbuild';
import { CASTABILITY_TARGET, HEAVY_CASTABILITY_TARGET } from './assemble';
import type { AssembledDeck, CastabilityCheck } from './assemble';
import type { BuiltDeck } from './build';
import { enumerateCriteria } from './criteria';
import type { Criterion, DeckFormat } from './criteria';
import type { LandCountSource } from './land-plan';
import type { Inclusion } from './verify';
import { deckPrice } from './verify';

/**
 * Bumped when a field changes meaning or leaves. The reader checks it, so an
 * artifact written by an older tool fails by name instead of rendering a page
 * with silently missing sections.
 *
 * `sideboard` arrived under `mtg-o5z1` without moving it, because an optional
 * field that arrives changes how nothing already written is read.
 */
export const DECK_ARTIFACT_VERSION = 1;

/** One illustration, with the credit Scryfall's terms ask for. */
export interface DeckArt {
  /** Scryfall's `art_crop`: the illustration alone, without the card frame. */
  readonly src: string;
  /** Describes the illustration, not the card; the name is already text. */
  readonly alt: string;
  readonly artist: string | null;
  readonly setCode: string;
}

export interface DeckArtifactEntry {
  readonly name: string;
  readonly count: number;
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly colorIdentity: string;
  readonly priceUsd: number | null;
  /** Criterion ids this inclusion cited; empty for basics, which cite nothing. */
  readonly criteria: readonly string[];
  /** The model's stated reason, or how the basic count was arrived at. */
  readonly reason: string;
  /** `null` renders the pending frame rather than a blank. */
  readonly art: DeckArt | null;
}

/** A `CastabilityCheck` with `undefined` spelled as `null`, so JSON keeps it. */
export interface DeckArtifactCheck {
  readonly cardName: string;
  readonly pips: number;
  readonly manaValue: number;
  readonly target: number;
}

export interface DeckArtifactColor {
  readonly color: Color;
  readonly pipCount: number;
  readonly weightedDemand: number;
  readonly sources: number;
  readonly basicSources: number;
  readonly nonBasicSources: number;
  readonly sourceFloor: number;
  readonly castability: number;
  readonly meetsTarget: boolean;
  /** The check that set the floor; `null` when the color asks for nothing. */
  readonly binding: DeckArtifactCheck | null;
}

export interface DeckArtifactManaBase {
  readonly totalLands: number;
  readonly nonBasicLands: number;
  /** The band a color's cheapest requirement is held to. */
  readonly castabilityTarget: number;
  /** The band the deck's heaviest single-card requirement is held to. */
  readonly heavyCastabilityTarget: number;
  readonly colors: readonly DeckArtifactColor[];
}

export interface DeckArtifact {
  readonly version: number;
  readonly prompt: string;
  readonly format: DeckFormat;
  readonly colors: readonly Color[];
  /** Every criterion an inclusion may cite, so the page can resolve the ids. */
  readonly criteria: readonly Criterion[];
  readonly plan: string;
  readonly totalCards: number;
  readonly priceUsd: number;
  readonly universeSize: number;
  readonly landPlan: {
    readonly count: number;
    readonly source: LandCountSource;
    readonly reason: string;
  };
  readonly spells: readonly DeckArtifactEntry[];
  readonly lands: readonly DeckArtifactEntry[];
  readonly basics: readonly DeckArtifactEntry[];
  /**
   * Cards set aside rather than played, drawn as the page's second pane.
   *
   * Omitted by `toDeckArtifact`, and that is a statement rather than an
   * oversight: this pipeline asks a model for exactly the deck, verifies each
   * proposal and assembles what survived, so nothing is ever left over. A
   * refusal is not a sideboard — `verify.ts` rejects a card because it is
   * unknown, banned, a fifth copy or cites a criterion nobody stated, and none
   * of those is a card you would board in. `@mtg/deckbuild`'s `DeckBuildResult`
   * does carry a real one (the playables its sealed pool did not take), but that
   * builder runs over DSL cards for the play surface and never reaches here.
   *
   * The field is on the document anyway because the document is the contract for
   * *a staged deck*, not for one producer's output: `npm run lab -- <path>`
   * reads any file through `@mtg/ui`'s schema, so a deck that does have a
   * sideboard renders one without either declaration moving again. Absent means
   * nobody said; an empty array means a builder that sets cards aside set none
   * aside here, and the page draws those two differently.
   */
  readonly sideboard?: readonly DeckArtifactEntry[];
  readonly manaBase: DeckArtifactManaBase;
  readonly curve: {
    readonly histogram: Readonly<Record<CurveBucket, number>>;
    readonly averageManaValue: number;
  };
  readonly shortfalls: readonly string[];
}

/**
 * The printing an illustration comes from.
 *
 * The store currently ingests Scryfall's default-cards bulk, which is one row
 * per oracle card, so most names offer exactly one choice. The ordering is
 * defined anyway, because which art a card shows should not depend on which
 * bulk file was last ingested: `getPrintings` orders by release date, so the
 * earliest printing wins, and an English non-digital one wins over a
 * digital-only reprint that happens to predate it. The second pass exists for
 * cards that only ever appeared in a digital set, which would otherwise lose
 * their art for a reason nobody watching the page could guess.
 */
function pickArt(store: DataStore, oracleId: string): DeckArt | null {
  const printings = getPrintings(store, oracleId);
  const withArt = printings.filter((printing) => typeof printing.imageUris?.['art_crop'] === 'string');
  const preferred = withArt.find((printing) => printing.lang === 'en' && !printing.digital);
  const chosen = preferred ?? withArt[0];
  if (chosen === undefined) return null;
  const src = chosen.imageUris?.['art_crop'];
  if (src === undefined) return null;
  return {
    src,
    alt:
      chosen.artist === null
        ? `Illustration from ${chosen.setCode.toUpperCase()}`
        : `Illustration by ${chosen.artist}`,
    artist: chosen.artist,
    setCode: chosen.setCode.toUpperCase(),
  };
}

function toEntry(store: DataStore, inclusion: Inclusion): DeckArtifactEntry {
  const { card } = inclusion;
  return {
    name: card.name,
    count: inclusion.count,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    colorIdentity: card.colorIdentity,
    priceUsd: card.priceUsd,
    criteria: inclusion.criteria,
    reason: inclusion.reason,
    art: pickArt(store, card.oracleId),
  };
}

/**
 * The basics as entries the page can render like any other card.
 *
 * A basic is not an `Inclusion` — nothing proposed it and it cites no criterion
 * — so its row is reconstructed from the store by name. A store that somehow
 * has no Plains still produces a row: the count is the deck's own arithmetic
 * and is the thing worth showing, and dropping the row would make a 24-land
 * deck print as 17 lands with no explanation.
 */
function basicEntries(store: DataStore, deck: AssembledDeck): readonly DeckArtifactEntry[] {
  const entries: DeckArtifactEntry[] = [];
  for (const color of COLORS) {
    const count = deck.manaBase.basics[color];
    if (count === 0) continue;
    const name = BASIC_LAND_FOR_COLOR[color];
    const row = findCardsByName(store, name, { exact: true, limit: 1 })[0];
    entries.push({
      name,
      count,
      manaCost: null,
      manaValue: 0,
      typeLine: row?.typeLine ?? `Basic Land — ${name}`,
      colorIdentity: color,
      priceUsd: null,
      criteria: [],
      reason: `${String(count)} of the ${String(deck.manaBase.totalLands)} lands, apportioned to ${color} by the mana base.`,
      art: row === undefined ? null : pickArt(store, row.oracleId),
    });
  }
  return entries;
}

function toCheck(check: CastabilityCheck | undefined): DeckArtifactCheck | null {
  if (check === undefined) return null;
  return { cardName: check.cardName, pips: check.pips, manaValue: check.manaValue, target: check.target };
}

/** The curve histogram as a plain object, with every bucket present. */
function toHistogram(deck: AssembledDeck): Readonly<Record<CurveBucket, number>> {
  const histogram: Partial<Record<CurveBucket, number>> = {};
  for (const bucket of CURVE_BUCKETS) histogram[bucket] = deck.curve.histogram[bucket];
  return histogram as Readonly<Record<CurveBucket, number>>;
}

/**
 * A built deck plus the store it was built from, as one renderable document.
 *
 * The store is read here and nowhere downstream, so the result survives being
 * copied to a machine that has neither the database nor a model.
 */
export function toDeckArtifact(built: BuiltDeck, store: DataStore): DeckArtifact {
  const { criteria, deck } = built;
  return {
    version: DECK_ARTIFACT_VERSION,
    prompt: criteria.prompt,
    format: criteria.format,
    colors: criteria.colors,
    criteria: enumerateCriteria(criteria),
    plan: built.plan,
    totalCards: deck.totalCards,
    priceUsd: deckPrice([...deck.spells, ...deck.lands]),
    universeSize: built.universeSize,
    landPlan: { count: built.landPlan.count, source: built.landPlan.source, reason: built.landPlan.reason },
    spells: deck.spells.map((inclusion) => toEntry(store, inclusion)),
    lands: deck.lands.map((inclusion) => toEntry(store, inclusion)),
    basics: basicEntries(store, deck),
    manaBase: {
      totalLands: deck.manaBase.totalLands,
      nonBasicLands: deck.manaBase.nonBasicLands,
      castabilityTarget: CASTABILITY_TARGET,
      heavyCastabilityTarget: HEAVY_CASTABILITY_TARGET,
      colors: deck.manaBase.reports.map((report) => ({
        color: report.color,
        pipCount: report.pipCount,
        weightedDemand: report.weightedDemand,
        sources: report.sources,
        basicSources: report.basicSources,
        nonBasicSources: report.nonBasicSources,
        sourceFloor: report.sourceFloor,
        castability: report.castability,
        meetsTarget: report.meetsTarget,
        binding: toCheck(report.binding),
      })),
    },
    curve: { histogram: toHistogram(deck), averageManaValue: deck.curve.averageManaValue },
    shortfalls: deck.shortfalls,
  };
}
