/**
 * A hash router in one file.
 *
 * A handful of modes over one app, so a routing dependency would be most of a
 * kilobyte of matcher for one switch. Hashes also mean the built app is
 * a static file that works from `file://` and from any subpath, which matters
 * because these pages get opened straight out of an `out/` run directory.
 *
 * Shape: `#/<mode>/<sub>?<params>` — `#/analysis/replay?game=3`. A mode is one
 * of four destinations and a sub is a section inside it; a hash that names no
 * sub lands on the mode's default section. An unrecognized mode falls back to
 * the default rather than throwing; a stale bookmark should land somewhere
 * useful, and nothing downstream depends on the URL being valid.
 *
 * No `lib: dom` is available under the workspace tsconfig, so the browser is
 * reached through the narrow `HashSource` interface below rather than through
 * ambient `window`.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

export const UI_MODES = ['play', 'customize', 'cards', 'analysis'] as const;
export type UiMode = (typeof UI_MODES)[number];

/**
 * The sections inside each mode, in the order they are drawn.
 *
 * Four modes over what used to be seven tabs (`mtg-a982g.1`): Draft is a way
 * to play, Design and Decks are two things a person customizes, Replay is a
 * view over the analysis. A section is a place inside a destination rather
 * than a destination of its own, which is why the shell draws it as a second
 * row under the mode row and not as a seventh tab.
 *
 * `satisfies` rather than an annotation, so each mode's tuple keeps its
 * literal types and `SubOf` can say which subs belong to which mode.
 */
export const UI_SUBS = {
  play: ['constructed', 'draft', 'sealed', 'commander'],
  customize: ['sets', 'decks'],
  cards: ['gallery', 'decks'],
  analysis: ['explorer', 'replay'],
} as const satisfies Record<UiMode, readonly string[]>;

export type SubOf<M extends UiMode> = (typeof UI_SUBS)[M][number];
export type UiSub = SubOf<UiMode>;

/**
 * A mode paired with one of its own subs.
 *
 * A distributive union rather than `{ mode: UiMode; sub: UiSub }`, so
 * `{ mode: 'cards', sub: 'replay' }` fails to typecheck instead of falling to a
 * default at runtime: the pair is built through `routeAt` or read off a parsed
 * hash, and both of those know which subs a mode has.
 */
export type RouteAt = { [M in UiMode]: { readonly mode: M; readonly sub: SubOf<M> } }[UiMode];

/** Where a mode lands when the hash names no section. */
export const DEFAULT_SUBS: { readonly [M in UiMode]: SubOf<M> } = {
  play: 'constructed',
  customize: 'sets',
  cards: 'gallery',
  analysis: 'explorer',
};

/**
 * The four destinations, in the order they are drawn.
 *
 * The same four on a phone and on a desktop — "do not create different IA
 * between desktop and mobile" — so this array is what the bar's tab row and the
 * phone's bottom bar both read, and neither can grow a fifth entry the other
 * does not have.
 *
 * Written out rather than derived from `UI_MODES`, which it currently equals. A
 * route is not automatically a destination, and the day one of them is not, the
 * tab row should not learn about it by growing.
 *
 * Home is still not one of them, for the reason it never was: its entry point is
 * the mark in the corner, which is on screen in tiers where the tab row is not.
 */
export const PRIMARY_MODES = ['play', 'customize', 'cards', 'analysis'] as const;

export const DEFAULT_MODE: UiMode = 'play';

export const MODE_LABELS: Readonly<Record<UiMode, string>> = {
  play: 'Play',
  customize: 'Customize',
  cards: 'Cards',
  analysis: 'Analysis',
};

/**
 * One label per sub name. `decks` is a section of both Customize and Cards and
 * reads the same word in both, so the record is keyed by the name rather than
 * by the pair.
 */
export const SUB_LABELS: Readonly<Record<UiSub, string>> = {
  constructed: 'Constructed',
  draft: 'Draft',
  sealed: 'Sealed',
  commander: 'Commander',
  sets: 'Sets',
  decks: 'Decks',
  gallery: 'Gallery',
  explorer: 'Explorer',
  replay: 'Replay',
};

/**
 * Hashes that used to name a mode and now name a mode and a section.
 *
 * `#/draft`, `#/decks`, `#/replay` and `#/design` were tabs for the life of the
 * app before `mtg-a982g.1` folded seven tabs into four, and `#/deck` was the
 * Deck tab before `mtg-tewc.3` renamed it Decks. All of them are in bookmarks,
 * in the launcher's stdout and in every link this repository has ever written
 * down. Falling through to `DEFAULT_MODE` would land a person on Play with no
 * sign anything had moved, which is the one failure the unknown-mode rule
 * below is not for: an unknown mode is a typo, a retired one is a promise.
 *
 * `#/home` and `#/more` resolve to Play with no section, so the default fills
 * it. `#/home` named a dashboard that repeated Play and Decks; `#/more` named a
 * page whose whole content was links to Analysis and Replay. `#/sets` named a
 * page whose whole content was the set list, and the nearest thing to it now is
 * the Sets section of Customize.
 */
export const MODE_ALIASES: Readonly<Record<string, { readonly mode: UiMode; readonly sub?: UiSub }>> = {
  draft: { mode: 'play', sub: 'draft' },
  decks: { mode: 'customize', sub: 'decks' },
  deck: { mode: 'customize', sub: 'decks' },
  design: { mode: 'customize', sub: 'sets' },
  sets: { mode: 'customize', sub: 'sets' },
  replay: { mode: 'analysis', sub: 'replay' },
  home: { mode: 'play' },
  more: { mode: 'play' },
};

export type UiRoute = RouteAt & { readonly params: Readonly<Record<string, string>> };

/**
 * What a link or a navigation names: a mode, optionally a section, optionally
 * params. Loose on purpose where `RouteAt` is strict — the shell's mode row and
 * a printed href want to say `{ mode }` in one line, and the parse on the far
 * side fills the section in.
 */
export interface HashTarget {
  readonly mode: UiMode;
  readonly sub?: UiSub;
  readonly params?: Readonly<Record<string, string>>;
}

export interface HashSource {
  readonly location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/** The browser's hash, or `null` when this is not running in one. */
export function hashSource(): HashSource | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as Partial<HashSource>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  if (typeof partial.location !== 'object' || partial.location === null) return null;
  if (typeof partial.location.hash !== 'string') return null;
  return candidate as HashSource;
}

function isMode(value: string): value is UiMode {
  return (UI_MODES as readonly string[]).includes(value);
}

function isSubOf<M extends UiMode>(mode: M, value: string | undefined): value is SubOf<M> {
  return value !== undefined && (UI_SUBS[mode] as readonly string[]).includes(value);
}

/** The typed constructor: a mode, one of its own subs, and the params. */
export function routeAt<M extends UiMode>(
  mode: M,
  sub: SubOf<M>,
  params: Readonly<Record<string, string>> = {},
): UiRoute {
  // The cast is the one place the distributive union is assembled from parts;
  // the signature has already held `sub` to `mode`'s own list.
  return { mode, sub, params } as UiRoute;
}

/**
 * The Play section a token param implies, or `undefined` when the params carry
 * none. `?table=` is a seat at a constructed table and `?room=` is a seat in a
 * sealed room (`../routes/PlayRoute.ts`), so a bare `#/play?room=x` lands
 * on Sealed rather than on the default.
 */
export function tokenSub(params: Readonly<Record<string, string>>): UiSub | undefined {
  if (params['table'] !== undefined) return 'constructed';
  if (params['room'] !== undefined) return 'sealed';
  return undefined;
}

function resolveMode(segment: string): { readonly mode: UiMode; readonly sub?: UiSub } {
  if (isMode(segment)) return { mode: segment };
  return MODE_ALIASES[segment] ?? { mode: DEFAULT_MODE };
}

/**
 * `#/analysis/replay?game=3` to a route. Unknown modes resolve to
 * `DEFAULT_MODE`; a retired mode resolves through `MODE_ALIASES` first and
 * keeps its params; an unknown or missing sub resolves to the mode's default.
 */
export function parseHash(hash: string): UiRoute {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = trimmed.split('?', 2);
  const segments = pathPart.replace(/^\/+/, '').split('/');
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) params[key] = value;
  const resolved = resolveMode(segments[0] ?? '');
  const named = resolved.sub ?? segments[1];
  if (isSubOf(resolved.mode, named)) return routeAt(resolved.mode, named, params);
  const implied = resolved.mode === 'play' ? tokenSub(params) : undefined;
  if (isSubOf(resolved.mode, implied)) return routeAt(resolved.mode, implied, params);
  return routeAt(resolved.mode, DEFAULT_SUBS[resolved.mode], params);
}

/**
 * A target to the hash that reproduces it. Params are sorted for stable URLs;
 * a target with no sub emits `#/<mode>` and lands on the default section.
 */
export function routeHash(target: HashTarget): string {
  const entries = Object.entries(target.params ?? {})
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(entries).toString();
  const path = target.sub === undefined ? `#/${target.mode}` : `#/${target.mode}/${target.sub}`;
  return query.length === 0 ? path : `${path}?${query}`;
}

export interface UiRouter {
  readonly route: UiRoute;
  /** Replaces the whole route. */
  readonly navigate: (target: HashTarget) => void;
  /**
   * Switches destination, retaining the global source but dropping mode-local
   * params. A target naming no sub lands on the mode's default section.
   */
  readonly goTo: (target: HashTarget) => void;
  /** Switches section inside the current mode, keeping every param. */
  readonly goToSub: (sub: UiSub) => void;
  /** Merges params into the current route; an empty string removes a key. */
  readonly setParams: (params: Readonly<Record<string, string>>) => void;
  /**
   * How many times a landing screen has been asked for.
   *
   * `goTo` is what the mark in the corner and the tab row both call, and what
   * both of them mean is *take me to that tab's landing screen*. The hash
   * cannot carry that on its own. A sealed build and a precon table are React
   * state under an unchanged `#/play`, so assigning the same hash fires no
   * `hashchange` and the press does nothing at all; a precon table is the worse
   * half of it, because its `?deck=` and `?against=` do clear, leaving the bar naming
   * no game while the game is still on screen.
   *
   * So the ask is a number rather than a hash. It changes on every `goTo`,
   * including the one that stays in the same mode, and a route holding a screen
   * of its own reads it and puts its landing screen back
   * (`../routes/PlayRoute.ts` is the one that does).
   *
   * `goToSub` leaves it alone. Moving between sections of one destination is
   * not a press of the mark, and a section row that re-landed the route on
   * every press would throw away the game the person was in the middle of.
   */
  readonly landing: number;
}

const EMPTY_HASH = '';

/**
 * The params a tab link and a section link carry across: which set, and which
 * opponent.
 *
 * Everything else in the hash names something inside the page being left -- a
 * seed, a pick list, a deck, a seat at a table -- and a link that carried it to
 * the next section would name nothing there. `?cube=` is the older spelling of
 * `?source=` and is normalized on the way, so a legacy draft bookmark still
 * identifies the source.
 *
 * `vs` rides along because the two Play choices are independent
 * (`../routes/play/availability.ts` owns the param): somebody choosing sets
 * with the network column open is still choosing with the network column open
 * on the next section, and dropping it silently reopened the bot column on
 * every press.
 */
export function modeParams(route: UiRoute): UiRoute['params'] {
  const source = route.params['cube'] ?? route.params['source'];
  const vs = route.params['vs'];
  return {
    ...(source === undefined ? {} : { source }),
    ...(vs === undefined ? {} : { vs }),
  };
}

function subscribeToHash(onChange: () => void): () => void {
  const source = hashSource();
  if (source === null) return () => undefined;
  source.addEventListener('hashchange', onChange);
  return () => {
    source.removeEventListener('hashchange', onChange);
  };
}

function currentHash(): string {
  return hashSource()?.location.hash ?? EMPTY_HASH;
}

/** Subscribes to the location hash and exposes the parsed route. */
export function useHashRoute(): UiRouter {
  const hash = useSyncExternalStore(subscribeToHash, currentHash, () => EMPTY_HASH);
  const route = useMemo(() => parseHash(hash), [hash]);
  const navigate = useCallback((next: HashTarget): void => {
    const source = hashSource();
    if (source === null) {
      throw new Error('navigate() needs a browser location; this host has no window');
    }
    source.location.hash = routeHash(next);
  }, []);
  // Bumped on every `goTo`, not only the one that lands on the mode it started
  // in: a press of the mark is a press of the mark, and a route that reads this
  // is arriving on its landing screen either way.
  const [landing, setLanding] = useState(0);
  const goTo = useCallback(
    (target: HashTarget): void => {
      setLanding((asked) => asked + 1);
      navigate({ ...target, params: target.params ?? modeParams(route) });
    },
    [navigate, route],
  );
  const goToSub = useCallback(
    (sub: UiSub): void => {
      navigate({ mode: route.mode, sub, params: route.params });
    },
    [navigate, route.mode, route.params],
  );
  const setParams = useCallback(
    (params: Readonly<Record<string, string>>): void => {
      const merged: Record<string, string> = { ...route.params, ...params };
      for (const [key, value] of Object.entries(merged)) {
        if (value.length === 0) delete merged[key];
      }
      navigate({ mode: route.mode, sub: route.sub, params: merged });
    },
    [navigate, route.mode, route.sub, route.params],
  );
  return { route, navigate, goTo, goToSub, setParams, landing };
}
