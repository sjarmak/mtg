/**
 * What gets photographed, at what size, after which presses.
 *
 * `mtg-aqxi.5`. Separated from `./shots.ts` so the plan is a list to read and
 * argue with rather than something buried in a CDP driver, and so a test can
 * import it: the shot names appear in the handoff and in commit messages, and a
 * name that only exists inside a driver is a name nothing checks.
 *
 * Every capture is a URL plus a journey of accessible names. Nothing addresses
 * an element by class or by position, because a class is an implementation
 * detail this lane is deliberately changing under itself — a journey written
 * against `.mtg-gallery` would break on the redesign it exists to photograph,
 * while "the control named Side panel" survives it and fails loudly if the
 * control loses its name.
 */

export interface Viewport {
  /** Goes in the filename, so it is a word rather than a size. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /**
   * What the browser is told about the input device.
   *
   * Stated rather than inferred from the width, for the reason
   * `../test/play/landscape-phone.browser.test.ts` states: a landscape phone is
   * 844 CSS px wide, which is a desktop width by every media query on this
   * surface, and under `pointer: coarse` a control is 44px tall because that is
   * the touch floor rather than because of its type. A rig on a fine pointer
   * photographs a page the device never draws.
   */
  readonly pointer: 'fine' | 'coarse';
}

/**
 * The two sizes this redesign is argued at.
 *
 * The phone is the size the spec names, with the browser's own chrome already
 * off it. The desk is here because the playtester asked for the same improvements on
 * the normal web version, and an information-architecture change that helps a
 * phone can just as easily leave a 1440px window emptier than it found it: the
 * pair is what makes that visible instead of assumed.
 */
export const PHONE: Viewport = { name: 'phone', width: 844, height: 390, pointer: 'coarse' };
/**
 * The same phone held the other way, which is the way a phone is usually held.
 *
 * `PHONE` is 844 CSS px wide and every media query on this surface reads that as
 * a desktop, so the landscape shot is evidence about a wide short window and
 * says nothing at all about a narrow tall one. A presentation pass asked for at
 * 390x844 (`mtg-dcxg`) cannot be argued from the landscape frame.
 */
export const PORTRAIT: Viewport = { name: 'portrait', width: 390, height: 844, pointer: 'coarse' };
export const DESK: Viewport = { name: 'desk', width: 1440, height: 900, pointer: 'fine' };

const BOTH = [PORTRAIT, PHONE, DESK] as const;

export interface Shot {
  readonly name: string;
  /** Everything after the origin, `fixtures.html#/…` included. */
  readonly hash: string;
  /** Controls to press, by accessible name, in order. Prefix match. */
  readonly steps: readonly string[];
  /** A selector the page must be drawing before the frame is taken. */
  readonly settle: string;
  readonly viewports: readonly Viewport[];
  /** What this frame is evidence about, printed by `--list`. */
  readonly about: string;
}

/**
 * The seven captures, in the order the spec asks for them.
 *
 * Three of the board, because the board's three states are not variations on
 * one picture: the rail shut is what a phone opens on, the rail open is what the
 * contextual panel costs, and a loaded stack is the state the whole seam
 * arrangement exists for. Two of the draft and two of deckbuilding, for the same
 * reason — a pack with nothing selected and a pack with something selected are
 * the before and after of the single worst interaction on that surface.
 */
export const SHOTS: readonly Shot[] = [
  {
    name: 'play-dense',
    hash: 'fixtures.html#/play',
    steps: [],
    settle: '.mtg-board',
    viewports: BOTH,
    about: 'the stated mid-game density, as the surface opens',
  },
  {
    name: 'play-rail',
    hash: 'fixtures.html#/play',
    steps: ['Side panel'],
    settle: '.mtg-board',
    viewports: BOTH,
    about: 'the same board with the contextual rail disclosed',
  },
  {
    name: 'play-stack',
    hash: 'fixtures.html#/play-stack',
    steps: [],
    settle: '.mtg-board',
    viewports: BOTH,
    about: 'two of the opponent spells waiting, with the question back on the viewer',
  },
  {
    name: 'draft-pack',
    hash: 'fixtures.html#/draft',
    steps: [],
    settle: '.mtg-draft',
    viewports: BOTH,
    about: 'a full pack, nothing chosen',
  },
  {
    name: 'draft-selected',
    hash: 'fixtures.html#/draft',
    steps: ['Skywatch Sentinel'],
    settle: '.mtg-draft',
    viewports: BOTH,
    about: 'a pack with one card under inspection',
  },
  {
    name: 'deck-built',
    hash: 'fixtures.html#/deck',
    steps: [],
    settle: '.mtg-builder, .mtg-panel',
    viewports: BOTH,
    about: 'the suggested build, as deckbuilding opens',
  },
  {
    name: 'deck-pool',
    hash: 'fixtures.html#/deck',
    steps: ['Compact'],
    settle: '.mtg-builder, .mtg-panel',
    viewports: BOTH,
    about: 'the pool beside the deck, at the density a 60-card list needs',
  },
  {
    // `mtg-rgc.21`. Compact is the density a pane opens at, so the two shots
    // above both photograph it and the other half of the View control went
    // unphotographed: the claim that full draws the *same* mana-value columns,
    // at face size, was checked by rigs reading boxes and by nothing anybody
    // could look at. The step presses the pool pane's control, which is the
    // first `Full cards` on the page.
    name: 'deck-full',
    hash: 'fixtures.html#/deck',
    steps: ['Full cards'],
    settle: '.mtg-builder, .mtg-panel',
    viewports: BOTH,
    about: 'the pool in mana-value columns at full face size',
  },
  {
    // `mtg-j1rg`. Keeping a Limited deck writes a line above the panes saying
    // where it went, and a line that appears on a press is a layout claim: it
    // takes a row off a frame that divides a fixed height between two panes.
    // The three shots above photograph the screen with nothing pressed, so the
    // one state this lane added went unlooked-at. The step presses the control
    // by its own label, and the deck it keeps is this fixture's suggested
    // build, kept in the throwaway profile the rig launches with.
    name: 'deck-kept',
    hash: 'fixtures.html#/deck',
    steps: ['Keep this deck'],
    settle: '.mtg-builder, .mtg-panel',
    viewports: BOTH,
    about: 'the sealed builder after keeping the deck, with the note that says where it went',
  },
];

/**
 * The shipped routes, photographed through `index.html` rather than the
 * fixtures page.
 *
 * The seven captures above pin *states* the fixtures page can hold still — a
 * mid-game board, a loaded stack — and none of them is the app a person opens.
 * These are: the shell, the set picker, and each tab's landing at both sizes,
 * which is what a presentation pass has to look at before it can claim a route
 * is done.
 *
 * They read the staged set at `public/set.json`, so they need a `npm run play`
 * (or a `stage-set` run) on the machine first. That is the same input the
 * launcher uses and it is deliberately not a fixture: a route shot taken over
 * the DSL examples would photograph a page nobody has.
 */
export const ROUTE_SHOTS: readonly Shot[] = [
  {
    name: 'route-play',
    hash: 'index.html#/play/constructed',
    steps: [],
    // The route's own wrapper rather than a deck grid: a set with no precons
    // draws one line saying so and nothing else, which is exactly the state
    // requirement 6 of the interface pass is about. Constructed rather than a
    // bare `#/play/` because the mode's default section is what a landing
    // shot is evidence about, and Sealed is a section of its own now
    // (`../src/routes/play/PlayChooser.ts`), not a second block on this page.
    settle: '.mtg-play-route',
    viewports: BOTH,
    about: 'the Play landing: the set and its preconstructed decks',
  },
  {
    name: 'route-decks',
    hash: 'index.html#/customize/decks',
    steps: [],
    settle: '.mtg-deckcards, .mtg-empty',
    viewports: BOTH,
    about: 'the deck library, preconstructed above saved',
  },
  {
    name: 'route-deck-editor',
    hash: 'index.html#/customize/decks',
    // The editor is a press away from the library and nothing photographed it:
    // requirement 8 of the interface pass is entirely about this screen.
    steps: ['New deck'],
    settle: '.mtg-builder',
    viewports: BOTH,
    about: 'the deck editor: its toolbar, its deck pane and its pool',
  },
  {
    name: 'route-deck-open',
    // The one screen `mtg-tz11` is about, and nothing photographed it: the
    // library's rows all lead here, and the shots above stop at the library.
    // The first row rather than a named one or a deep link: every row's control
    // is named `Open <deck>`, `journeyExpression` presses the first control
    // whose name starts with the step, and which decks are on the shelf is a
    // fact about what is staged. So this photographs a deck the checkout
    // actually has, whichever set that is, instead of the one deck a link could
    // name and a clean checkout might not hold.
    hash: 'index.html#/customize/decks',
    steps: ['Open '],
    settle: '.mtg-deck__pane-scroll, .mtg-empty',
    viewports: BOTH,
    about: 'an open deck as a frame: a header bar per pane, strip columns under it',
  },
  {
    name: 'route-cards',
    hash: 'index.html#/cards/gallery',
    steps: [],
    settle: '.mtg-gallery',
    viewports: BOTH,
    about: 'the card browser and its one filter bar',
  },
  {
    name: 'route-cards-compact',
    hash: 'index.html#/cards/gallery?size=compact',
    steps: [],
    settle: '.mtg-gallery',
    viewports: BOTH,
    about: 'the same browser as an index rather than a gallery',
  },
  {
    name: 'route-draft',
    hash: 'index.html#/play/draft',
    steps: [],
    // The pack, which is the whole route: a draft opens dealt, so there is no
    // landing to photograph and nothing to press before the shot.
    settle: '.mtg-gallery, .mtg-empty',
    viewports: BOTH,
    about: 'a draft in progress over the staged set: the pack, the pool, the bar',
  },
  {
    name: 'route-analysis',
    hash: 'index.html#/analysis/explorer',
    steps: [],
    // The route's own wrapper rather than a panel: the landing section is the
    // fairness verdict, which draws `.mtg-verdict` and `.mtg-reading` and no
    // `.mtg-panel` at all unless a gate failed. On the staged run — 25 pass, 0
    // fail — the only thing this selector ever matched was the `.mtg-empty` of
    // the "Reading the analysis document…" state, which is committed for the
    // few milliseconds between the first paint and `analysis.json` landing. The
    // wait polls every 80ms, so whether the shot settled at all was whether a
    // poll fell inside that window: it failed at phone and at desk in the
    // 2026-08-23 sweep and passed on rerun. `.mtg-analysis` is on the wrapper
    // of every screen that has a run, and `.mtg-empty` stays for the states
    // that have none.
    settle: '.mtg-analysis, .mtg-empty',
    viewports: BOTH,
    about: 'the analysis workspace over the staged run',
  },
  {
    name: 'route-design',
    hash: 'index.html#/customize/sets',
    steps: [],
    // The brief form, which is the route with or without a design server: the
    // page draws the form and says the server is unreachable, and that refusal
    // is itself one of the states this pass has to look at.
    settle: '.mtg-design, .mtg-panel, .mtg-empty',
    viewports: BOTH,
    about: 'the set designer: the brief form and what it says with no server',
  },
  {
    name: 'route-replay',
    hash: 'index.html#/analysis/replay',
    steps: [],
    // The transport rather than the empty state: `emptyState` also draws the
    // "Loading the replay" panel, so an `.mtg-empty` settle photographed the
    // spinner every time.
    settle: '.mtg-transport',
    viewports: BOTH,
    about: 'the replay workspace and its transport',
  },
];

/** The plan, narrowed to the names asked for. An empty ask is the whole plan. */
export function shotsFor(only: readonly string[]): readonly Shot[] {
  const plan = [...SHOTS, ...ROUTE_SHOTS];
  if (only.length === 0) return plan;
  return plan.filter((shot) => only.includes(shot.name));
}
