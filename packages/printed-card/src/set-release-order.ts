/**
 * Real-world release dates for the Magic sets (and their token sheets) this
 * repository has onboarded, keyed by Scryfall set code.
 *
 * This exists so a runtime tie-break between two printings that are provably
 * the same card (same oracle id) can prefer the older one deterministically,
 * instead of guessing or refusing. It is not a Scryfall client: dates are
 * looked up once (`https://api.scryfall.com/sets/<code>`) when a set is
 * onboarded and recorded here as a plain fact, the same way a set's own card
 * data is recorded once and checked in. Add an entry when a new set's
 * printed-format import lands; nothing here refreshes itself.
 */
const SET_RELEASE_DATES: Readonly<Record<string, string>> = {
  ISD: '2011-09-30',
  TISD: '2011-09-30',
  AKH: '2017-04-28',
  TAKH: '2017-04-28',
  MP2: '2017-04-28',
  HOU: '2017-07-14',
  THOU: '2017-07-14',
};

/** The recorded release date for a known set code, or undefined for one not yet onboarded. */
export function releaseDateOf(setCode: string | undefined): string | undefined {
  return setCode === undefined ? undefined : SET_RELEASE_DATES[setCode.toUpperCase()];
}
