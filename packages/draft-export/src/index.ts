/**
 * `@mtg/draft-export` — DSL set -> Draftmancer custom-set file.
 *
 * Draftmancer (MIT) is the lab's draft surface, adopted rather than built:
 * `docs/research/prior-art-tooling.md` §1.1 records why, and it is the only
 * open format found that describes custom cards *and* booster collation. This
 * package is the offline compile target for it — it writes a file, and nothing
 * here clones, installs, configures or talks to Draftmancer itself.
 *
 * The rating each card carries is the whole of the bot layer for a custom set,
 * because no external bot service handles cards without oracle ids; ADR-0003
 * settles the scale.
 */

export {
  RATING_MAX,
  RATING_MIN,
  RATING_RANGE_IN_COLOR_CARDS,
  rateCards,
  SIMPLE_BOT_COLOR_BONUS,
} from './rating';
export type { CardRating } from './rating';

export { toCustomCard, toCustomCards } from './custom-cards';
export type { DraftmancerCustomCard } from './custom-cards';

export {
  buildLayouts,
  buildSheets,
  collationReport,
  DEFAULT_LAYOUT_NAME,
  formatCollationReport,
  sheetName,
} from './collation';
export type {
  CollationReport,
  DraftmancerLayout,
  DraftmancerLayouts,
  DraftmancerSheet,
  ShortSlot,
} from './collation';

export { DraftExportError, exportDraftmancerSet } from './emit';
export type { DraftExportOptions, DraftmancerExport } from './emit';

export { DraftError } from './errors';

export { countPickedColors, simpleBotPick, simpleBotScore, simpleBotScores } from './simple-bot';
export type { ColorCounts } from './simple-bot';

export { openPack, openPackFromLayouts } from './packs';

export {
  DEFAULT_DRAFT_SEED,
  DEFAULT_PACKS_PER_SEAT,
  DEFAULT_SEATS,
  passDirection,
  runDraft,
  runHumanDraft,
} from './draft';
export type {
  DraftOptions,
  DraftPick,
  DraftResult,
  DraftSeat,
  HumanDraftChoice,
  HumanDraftOptions,
  HumanDraftProgress,
  PassDirection,
} from './draft';

export { draftedPool, draftedPools } from './pool';
