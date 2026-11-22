/**
 * The set-icon registry, held by `@mtg/render-spec` beside the mana-symbol
 * registry and re-exported here on the arrangement `./symbols.ts` has: the
 * face reads it from `card/`, and the specification owns it.
 */
export {
  LOCAL_SET_ICON_BASE,
  SCRYFALL_SET_ICON_BASE,
  SET_ICON_DIR,
  STAGED_SET_ICONS,
  setIconAssetName,
  setIconHref,
  setIconSourceUrl,
  stagedSetIconsFrom,
} from '@mtg/render-spec';
