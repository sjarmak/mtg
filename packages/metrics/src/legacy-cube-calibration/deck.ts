/** A common, deliberately conservative deck builder for every policy arm. */
import {
  LIMITED_COLORS,
  prepareLimitedDeck,
  suggestLimitedBasics,
  toDeckRef,
  validateLimitedDeck,
} from '@mtg/limited';
import type { LimitedColor } from '@mtg/limited';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import { baselineCardScore } from './draft';

export const CALIBRATION_BUILDER_VERSION = 'two-color-package-preserving/v1';
const SPELLS = 23;
const LANDS = 17;
const OFF_COLOR_PENALTY = 100;
const PACKAGE_PRESERVATION_BONUS = 100;
const profile = (c: PrintedCardCatalogEntry) => {
  const result = LEGACY_CUBE_ADVISOR_MODEL.profilesByName?.get(c.correctedName);
  if (!result) throw new Error(`Missing profile ${c.correctedName}`);
  return result;
};
const colorsOf = (c: PrintedCardCatalogEntry) => c.faces[0]?.colors ?? c.colors;
const isLand = (c: PrintedCardCatalogEntry) => (c.faces[0]?.typeLine ?? c.typeLine).includes('Land');

function candidate(pool: readonly PrintedCardCatalogEntry[], colors: readonly LimitedColor[]) {
  const compatible = pool.filter((c) => !isLand(c) && colorsOf(c).every((color) => colors.includes(color)));
  // A minimally functional recipe is not a complete deck. Preserve its available
  // pieces (up to the authored structural targets) before filling the curve.
  const packages = LEGACY_CUBE_ADVISOR_MODEL.packages.filter((p) =>
    p.needs.filter((n) => n.critical).every((n) => compatible.some((c) => profile(c).tags.includes(n.tag))),
  );
  const reserved = new Set(
    packages.flatMap((p) =>
      p.needs
        .filter((n) => n.critical)
        .flatMap((n) =>
          compatible
            .filter((c) => profile(c).tags.includes(n.tag))
            .sort((a, b) => profile(b).quality - profile(a).quality)
            .slice(0, n.min)
            .map((c) => c.physicalId),
        ),
    ),
  );
  const score = (c: PrintedCardCatalogEntry) =>
    baselineCardScore(c) -
    colorsOf(c).filter((color) => !colors.includes(color)).length * OFF_COLOR_PENALTY +
    (reserved.has(c.physicalId) ? PACKAGE_PRESERVATION_BONUS : 0);
  const spells = pool
    .filter((c) => !isLand(c))
    .map((card, index) => ({ card, index }))
    .sort((a, b) => score(b.card) - score(a.card) || a.index - b.index)
    .slice(0, SPELLS)
    .map((c) => c.card);
  const lands = pool
    .filter((c) => isLand(c) && profile(c).fixing.some((color) => colors.includes(color as LimitedColor)))
    .slice(0, LANDS - colors.length);
  return {
    colors,
    spells,
    lands,
    packages: packages
      .filter((p) =>
        p.needs.filter((n) => n.critical).every((n) => spells.some((c) => profile(c).tags.includes(n.tag))),
      )
      .map((p) => p.id),
    score: spells.reduce((sum, c) => sum + score(c), 0),
  };
}

export function buildCalibrationDeck(pool: readonly PrintedCardCatalogEntry[], name: string) {
  const colorSets = LIMITED_COLORS.flatMap((first, i) => [
    [first],
    ...LIMITED_COLORS.slice(i + 1).map((second) => [first, second]),
  ]);
  const best = colorSets.map((colors) => candidate(pool, colors)).sort((a, b) => b.score - a.score)[0]!;
  if (best.spells.length !== SPELLS) throw new Error('Pool has fewer than 23 spells');
  const selected = [...best.spells, ...best.lands];
  const prepared = prepareLimitedDeck(
    pool.map((payload) => ({ physicalId: payload.physicalId, payload })),
    ({ payload }) => ({
      name: payload.correctedName,
      colors: isLand(payload) ? [] : colorsOf(payload),
      manaValue: payload.manaValue,
      type: isLand(payload)
        ? 'nonbasic-land'
        : (payload.faces[0]?.typeLine ?? payload.typeLine).includes('Creature')
          ? 'creature'
          : 'noncreature-spell',
      score: baselineCardScore(payload),
    }),
    { suggestedBasicLands: LANDS - best.lands.length },
  );
  const deck = suggestLimitedBasics({ ...prepared, selectedPhysicalIds: selected.map((c) => c.physicalId) });
  return {
    builderVersion: CALIBRATION_BUILDER_VERSION,
    colors: best.colors,
    packages: best.packages,
    selected,
    ref: toDeckRef(deck, name),
    report: validateLimitedDeck(deck),
    diagnostics: best.spells
      .filter((c) => colorsOf(c).some((color) => !best.colors.includes(color)))
      .map((c) => `Off-plan spell: ${c.correctedName}`),
  };
}
export type CalibrationDeck = ReturnType<typeof buildCalibrationDeck>;
