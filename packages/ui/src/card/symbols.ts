/**
 * The mana-symbol registry, moved to `@mtg/render-spec` by `mtg-ey09`.
 *
 * Re-exported from here so no module path inside this package changed. It is
 * the largest single piece of the old `card/` directory that is not a UI at
 * all: a table of tokens, the art each resolves to under each symbol set, and
 * the chunker that finds them in a line of rules text.
 */
export {
  DEFAULT_SYMBOL_SET,
  LOCAL_SYMBOL_BASE,
  MAX_GENERIC_SYMBOL,
  PRINTED_SYMBOL_SET,
  SCRYFALL_SYMBOL_BASE,
  SYMBOL_ADVANCE_EM,
  SYMBOL_BOX_EM,
  SYMBOL_DIR,
  SYMBOL_DROP_EM,
  SYMBOL_MARGIN_EM,
  SYMBOL_SETS,
  SYMBOL_TOKENS,
  colorWord,
  oracleChunks,
  symbolArt,
  symbolAssetName,
  symbolLabel,
  symbolSetFrom,
} from '@mtg/render-spec';
export type { OracleChunk, OracleSymbolChunk, OracleTextChunk, SymbolArt, SymbolSet } from '@mtg/render-spec';
