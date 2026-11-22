/**
 * The lab analysis surface: is this set fair, and the evidence for the answer.
 *
 * Evidence sections behind one run picker, mounted inside the shell another
 * package owns. Fairness is the default answer and the others are what it
 * rests on. The
 * route holds no state of its own — the selected section, run, baseline and
 * rarity filter all live in the hash, so a red gate can be sent to somebody as
 * a link and they see the same screen.
 *
 * The header is the part that has to be right even when nobody scrolls. It
 * carries the gate counts (and `under-sampled` is a third count, never folded
 * into pass) and the duplicate-trajectory share, which is the number that says
 * how much of a run was new information. Bot determinism is the failure mode
 * this dashboard is most likely to launder: ten thousand seeded games that
 * replayed one line are one piece of evidence, and every confidence interval
 * below is computed over the distinct count for exactly that reason.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { UiRoute, UiRouter } from '../../app/router';
import { renderCopy } from '../../copy';
import { ArchetypePanel } from './archetypes';
import { AnalysisStyles, Stat } from './chart';
import { RARITY_ANY, CardPerformancePanel } from './card-performance';
import { CompositionPanel } from './composition';
import { RevisionDiffPanel } from './diff';
import { ClaimsPanel } from './claims';
import { FairnessPanel } from './fairness';
import { RunSummaryPanels } from '../AnalysisRoute';
import { GameDetailPanels } from './game-detail';
import type { AnalysisLogState } from '../AnalysisRoute';
import { duplicateTone, integer, percent } from './evidence';
import { GameShapePanel } from './game-shape';
import { PreconMatchupPanel } from './precon-matchups';
import { CalibrationEvidencePanel, RetuneEvidencePanel } from './calibration';
import { REFERENCE_CODES } from './calibration-model';
import type { CalibrationState, ReferenceCode, RetuneState } from './calibration-model';
import { EVIDENCE_SECTION_LABEL, EvidencePanel } from './evidence-panel';
import type { EvidenceState } from './evidence-record';
import type { AnalysisRun, RunGate, SetDocument } from './model';

/**
 * Fairness remains the default, because it is the question. Reference
 * calibration leads the navigation because it is useful before a run exists.
 *
 * The other sections are the evidence behind it, and they were the whole
 * of this surface until somebody asked what the tab was for. Landing on a
 * composition chart answers "what is in this set"; landing here answers "is it
 * any good", which is what a person opening a balance dashboard came to find
 * out.
 */
export const ANALYSIS_SECTIONS = [
  'calibration',
  'fairness',
  'claims',
  'composition',
  'archetypes',
  'shape',
  'cards',
  'precons',
  'games',
  'diff',
  'evidence',
] as const;
export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];
export const DEFAULT_SECTION: AnalysisSection = 'fairness';

export const SECTION_LABELS: Readonly<Record<AnalysisSection, string>> = {
  calibration: 'Reference calibration',
  fairness: 'Is it fair',
  claims: 'Does it do what it claims',
  composition: 'Set composition',
  archetypes: 'Archetype health',
  shape: 'Game shape',
  cards: 'Per-card performance',
  precons: 'Precon matchups',
  games: 'Games played',
  diff: 'Revision diff',
  evidence: EVIDENCE_SECTION_LABEL,
};

/** One run and, when it is available, the set file the run measured. */
export interface AnalysisRunView {
  readonly run: AnalysisRun;
  readonly set: SetDocument | null;
}

/**
 * The four states reading the documents can be in.
 *
 * The same four `DeckState`, `ReplayState` and `PlaySetState` model, and for
 * the same reason (`mtg-ey8g`): a checkout that has never measured a set wants
 * the command, and a document that failed the reader wants the field it
 * tripped on. A single nullable list makes those one blank page, which is
 * exactly what this route had — `LabApp` held a real three-state load and
 * flattened it at the call site, so "still reading" and "could not read"
 * survived only as prose inside a hint and `absent` did not exist at all.
 */
export type AnalysisRunsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly runs: readonly AnalysisRunView[] }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface AnalysisSurfaceProps {
  readonly runs: AnalysisRunsState;
  /**
   * The run's statistics log, which is a different file from the documents and
   * arrives on its own schedule — hence its own state rather than a field on
   * the run. It feeds the `games` section: `mtg-2ayr`'s master half.
   */
  readonly games: AnalysisLogState;
  /** Static reference evidence staged by `npm run play`, independent of a sim run. */
  readonly calibration?: CalibrationState;
  /** Optional exact before/after proposal; absent until retuning writes one. */
  readonly retune?: RetuneState;
  /** The staged ledger snapshot for the `evidence` section; absent until `npm run play` scans one. */
  readonly evidence?: EvidenceState;
  /** The selected set, format or cube's join key, scoping the `evidence` section; null lists everything. */
  readonly subjectKey?: string | null;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** Where a run document would come from, shown when there are none. */
  readonly sourceHint?: string;
}

/**
 * An integer route param, or the fallback when it is absent or unparseable.
 *
 * A junk `?turn=x` opens the default turn rather than an error page: the
 * address bar is a surface a person types into, and the drill-down clamps
 * whatever it is handed.
 */
function intParam(route: UiRoute, key: string): number | null {
  const raw = route.params[key];
  if (raw === undefined || raw === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : null;
}

export function sectionFromRoute(route: UiRoute): AnalysisSection {
  const raw = route.params['section'];
  return ANALYSIS_SECTIONS.find((section) => section === raw) ?? DEFAULT_SECTION;
}

function pickRun(views: readonly AnalysisRunView[], id: string | undefined): AnalysisRunView | null {
  if (views.length === 0) return null;
  const found = id === undefined ? undefined : views.find((view) => view.run.id === id);
  return found ?? views[0] ?? null;
}

function pickBaseline(
  views: readonly AnalysisRunView[],
  current: AnalysisRunView,
  id: string | undefined,
): AnalysisRunView | null {
  const others = views.filter((view) => view.run.id !== current.run.id);
  const found = id === undefined ? undefined : others.find((view) => view.run.id === id);
  return found ?? others[0] ?? null;
}

function emptyState(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

function subnav(section: AnalysisSection, onSelect: (section: AnalysisSection) => void): ReactElement {
  return createElement(
    'nav',
    { className: 'mtg-subnav', 'aria-label': 'Analysis sections' },
    ...ANALYSIS_SECTIONS.map((candidate) =>
      createElement(
        'button',
        {
          key: candidate,
          type: 'button',
          className: 'mtg-subnav__item',
          ...(candidate === section ? { 'aria-current': 'page' as const } : {}),
          onClick: () => {
            onSelect(candidate);
          },
        },
        SECTION_LABELS[candidate],
      ),
    ),
  );
}

function runPicker(
  views: readonly AnalysisRunView[],
  current: AnalysisRunView,
  label: string,
  param: string,
  onSetParams: (params: Readonly<Record<string, string>>) => void,
): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    createElement('span', { className: 'mtg-field__label' }, label),
    createElement(
      'select',
      {
        className: 'mtg-select',
        value: current.run.id,
        onChange: (event: { target: { value: string } }) => {
          onSetParams({ [param]: event.target.value });
        },
      },
      ...views.map((view) =>
        createElement('option', { key: view.run.id, value: view.run.id }, view.run.label),
      ),
    ),
  );
}

/**
 * The failing gates, named.
 *
 * "3 fail" at the top of a dashboard is the number a reader has to go looking
 * for the meaning of. Each row here carries the gate's own detail and bound, so
 * the answer to "is this set any good" is one screen rather than one screen
 * plus a hunt.
 */
function failures(gates: readonly RunGate[]): ReactElement | null {
  const failed = gates.filter((gate) => gate.status === 'fail');
  if (failed.length === 0) return null;
  return createElement(
    'section',
    { className: 'mtg-panel', 'aria-label': 'Failing gates' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Failing gates'),
      createElement(
        'span',
        { className: 'mtg-panel__note' },
        `${integer(failed.length)} of ${integer(gates.length)}`,
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'div',
        { className: 'mtg-dl' },
        ...failed.flatMap((gate) => [
          createElement(
            'span',
            { key: `${gate.id}-k`, className: 'mtg-dl__key', title: gate.source },
            createElement('span', { className: 'mtg-badge', 'data-tone': 'negative' }, 'fail'),
            ` ${gate.label}`,
          ),
          createElement('span', { key: `${gate.id}-v`, className: 'mtg-dl__value' }, gate.detail),
        ]),
      ),
    ),
  );
}

/**
 * The tone of the gate tile.
 *
 * Green is the strongest claim on the page, so it is reserved for a run that
 * actually passed something. A run whose every gate is under-sampled has
 * nothing to fail and nothing to pass; painting its `0 pass · 0 fail` green
 * contradicted the sentence printed directly under it.
 */
function gateTone(passed: number, failed: number): 'positive' | 'negative' | 'pending' {
  if (failed > 0) return 'negative';
  return passed > 0 ? 'positive' : 'pending';
}

function header(view: AnalysisRunView): ReactElement {
  const health = view.run.health;
  const failed = health.gates.filter((gate) => gate.status === 'fail');
  const under = health.gates.filter((gate) => gate.status === 'underSampled');
  // `notApplicable` is the fourth status and it is not a pass either — a pool
  // with no activated ability on any card has no usage rate to measure, at any
  // run size. Counting it as one is how a run whose every judged gate abstained
  // painted its tile green: `passed` was everything that was not a fail or an
  // abstention, which quietly included every gate with nothing to measure.
  const notApplicable = health.gates.filter((gate) => gate.status === 'notApplicable');
  // The fifth status, and the third way to not be a pass: the miss was smaller
  // than the seed deviation at this run's volume, so the run could not tell it
  // from its own dice. It has to be subtracted here for the same reason
  // `notApplicable` does, and the note names each abstention separately because
  // "buy more games" and "this volume cannot judge it" are different answers.
  const insideNoise = health.gates.filter((gate) => gate.status === 'withinNoise');
  const passed =
    health.gates.length - failed.length - under.length - notApplicable.length - insideNoise.length;
  // Only the abstentions this run actually has. A zero is not an abstention,
  // and printing it as one is how "25 pass · 0 fail" came to sit over "0
  // under-sampled, which is not a pass" — a sentence that reads as a
  // qualification of the green number above it and qualifies nothing. A run
  // with no abstention at all says so instead, because "every gate judged" is
  // the fact that makes the census complete.
  const abstentions: readonly string[] = [
    ...(under.length === 0 ? [] : [`${integer(under.length)} under-sampled`]),
    ...(notApplicable.length === 0 ? [] : [`${integer(notApplicable.length)} with nothing to measure`]),
    ...(insideNoise.length === 0 ? [] : [`${integer(insideNoise.length)} inside the seed noise`]),
  ];
  const note =
    abstentions.length === 0
      ? `every one of the ${integer(health.gates.length)} gates was judged`
      : `${abstentions.join(', ')}, ${abstentions.length === 1 ? 'which is not a pass' : 'none of which is a pass'}`;
  return createElement(
    'div',
    { className: 'mtg-stats' },
    createElement(Stat, {
      key: 'gates',
      label: 'Gates',
      value: `${integer(passed)} pass · ${integer(failed.length)} fail`,
      note,
      tone: gateTone(passed, failed.length),
    }),
    createElement(Stat, {
      key: 'games',
      label: 'Games',
      value: integer(health.games),
      note: `${integer(health.distinctGames)} distinct trajectories`,
    }),
    createElement(Stat, {
      key: 'duplicates',
      label: 'Repeated trajectories',
      value: percent(health.duplicateShare),
      note: 'seeded games that replayed another game move for move',
      tone: duplicateTone(health.duplicateShare),
    }),
  );
}

/**
 * The run's technical identity, folded shut.
 *
 * It used to be a fourth headline tile — `Run seed` over `mtg-analysis/v0`,
 * with an absolute command line under it — beside three tiles that answer a
 * question somebody has. A seed and the command that produced it are what you
 * want *after* the numbers surprise you, and only then, so they read here
 * behind a summary rather than in the same size as the verdict.
 */
function runDetails(view: AnalysisRunView): ReactElement {
  return createElement(
    'details',
    { className: 'mtg-rundetails' },
    createElement('summary', null, 'Run details'),
    createElement(
      'dl',
      { className: 'mtg-rundetails__list' },
      createElement('dt', { key: 'seed-term' }, 'Seed'),
      createElement('dd', { key: 'seed-value' }, view.run.seed),
      createElement('dt', { key: 'by-term' }, 'Produced by'),
      createElement('dd', { key: 'by-value' }, view.run.producedBy),
    ),
  );
}

function sectionBody(
  section: AnalysisSection,
  view: AnalysisRunView,
  baseline: AnalysisRunView | null,
  games: AnalysisLogState,
  route: UiRoute,
  onSetParams: (params: Readonly<Record<string, string>>) => void,
): ReactNode {
  switch (section) {
    case 'calibration':
      // Rendered before a run is selected in `AnalysisSurface`, because static
      // calibration remains useful in a checkout with no simulation document.
      return null;
    case 'evidence':
      // Likewise: the staged ledgers are about the selected set whether or not
      // a run measured it.
      return null;
    case 'fairness':
      return createElement(FairnessPanel, {
        fairness: view.run.fairness,
        games: view.run.health.games,
        distinctGames: view.run.health.distinctGames,
      });
    case 'claims':
      return view.run.claims === null
        ? createElement(
            'div',
            { 'aria-label': SECTION_LABELS.claims },
            emptyState(
              'This format states no capabilities',
              'Nothing was claimed, so there is nothing to measure. State them as cube criteria and analyze again; a capability nobody stated is never invented here.',
            ),
          )
        : createElement(ClaimsPanel, { claims: view.run.claims });
    case 'composition':
      return view.set === null
        ? emptyState(
            'No set file loaded',
            `${view.run.label} carries metrics but not the cards they were measured on. Load the set JSON beside the run to compare its curve, colors and rarities against the ${view.run.targets.profile} skeleton.`,
          )
        : createElement(CompositionPanel, { set: view.set, targets: view.run.targets });
    case 'archetypes':
      return createElement(ArchetypePanel, { health: view.run.health });
    case 'shape':
      return createElement(GameShapePanel, { health: view.run.health });
    case 'cards':
      return createElement(CardPerformancePanel, {
        cards: view.run.cards,
        rarity: route.params['rarity'] ?? RARITY_ANY,
        onSelectRarity: (rarity: string) => {
          onSetParams({ rarity: rarity === RARITY_ANY ? '' : rarity });
        },
      });
    case 'precons':
      return view.run.precons === null
        ? createElement(
            'div',
            { 'aria-label': SECTION_LABELS.precons },
            emptyState(
              'No precon matchup run',
              'No written deck file matched this set when it was analyzed. Add matching preconstructed decks and run `npm run analyze` again.',
            ),
          )
        : createElement(PreconMatchupPanel, { matchups: view.run.precons });
    case 'games':
      // The run summarized, then one game of it walked turn by turn. Both read
      // `@mtg/sim`'s statistics log, and the drill-down draws only when that
      // log is ready — the other three states are `RunSummaryPanels`' to say,
      // and saying them twice on one screen is worse than saying them once.
      return createElement(
        'div',
        { className: 'mtg-analysis', 'aria-label': SECTION_LABELS.games },
        createElement(RunSummaryPanels, { state: games }),
        games.status !== 'ready'
          ? null
          : createElement(GameDetailPanels, {
              log: games.log,
              gameIndex: intParam(route, 'game') ?? 0,
              turn: intParam(route, 'turn'),
              onSelectGame: (index: number) => {
                // The turn number is addressed within a game, so carrying it
                // across a game change lands on a turn of a different game or
                // on none at all. Clearing it opens the new game at its end.
                onSetParams({ game: String(index), turn: '' });
              },
              onSelectTurn: (turn: number) => {
                onSetParams({ turn: String(turn) });
              },
            }),
      );
    case 'diff':
      return baseline === null
        ? emptyState(
            'Nothing to compare against',
            'A revision diff needs two runs. Load a second analysis document (the same sweep against the previous set revision) and it appears here.',
          )
        : createElement(RevisionDiffPanel, { base: baseline.run, revision: view.run });
  }
}

/**
 * The three states that are not a run, each drawn as itself.
 *
 * `absent` names the command, which is the state a clean checkout is in and
 * the one worth being helpful about; `failed` carries the reader's own message,
 * which names the field the document tripped on; `loading` says so rather than
 * pretending there is nothing.
 */
function nonRunState(state: AnalysisRunsState, sourceHint: string | undefined): ReactElement | null {
  switch (state.status) {
    case 'loading':
      return emptyState('Reading the analysis document…', sourceHint ?? 'One moment.');
    case 'absent':
      return emptyState(
        'Nothing measured yet',
        sourceHint ??
          'Run `npm run analyze` to play a seeded sweep over the staged set and write its analysis document. It takes a few seconds and answers whether the set is fair.',
      );
    case 'failed':
      return emptyState('That analysis document could not be read', state.message);
    case 'ready':
      return state.runs.length === 0
        ? emptyState(
            'Nothing measured yet',
            'The analysis document holds no runs. Run `npm run analyze` to measure a set into it.',
          )
        : null;
  }
}

export function AnalysisSurface(props: AnalysisSurfaceProps): ReactElement {
  const section = sectionFromRoute(props.route);
  const calibration = props.calibration ?? { status: 'absent' };
  const retune =
    calibration.status === 'ready'
      ? (props.retune ?? { status: 'absent' })
      : calibration.status === 'loading'
        ? { status: 'loading' as const }
        : {
            status: 'blocked' as const,
            message: 'Calibration must be ready before retune evidence can be examined.',
          };
  const pageHead = createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Set analysis'),
    calibration.status === 'ready'
      ? createElement('span', { className: 'mtg-page-note' }, calibration.artifact.subject.name)
      : null,
  );
  const navigation = subnav(section, (next) => {
    props.onSetParams({ section: next });
  });
  if (section === 'calibration') {
    const requested = props.route.params['reference'];
    const referenceCode: ReferenceCode = REFERENCE_CODES.find((code) => code === requested) ?? 'M11';
    return createElement(
      'div',
      { className: 'mtg-analysis' },
      createElement(AnalysisStyles, null),
      pageHead,
      navigation,
      createElement(CalibrationEvidencePanel, {
        state: calibration,
        referenceCode,
        onSelectReference: (code: ReferenceCode) => {
          props.onSetParams({ reference: code });
        },
      }),
      createElement(RetuneEvidencePanel, { state: retune }),
    );
  }
  if (section === 'evidence') {
    return createElement(
      'div',
      { className: 'mtg-analysis' },
      createElement(AnalysisStyles, null),
      pageHead,
      navigation,
      createElement(EvidencePanel, {
        state: props.evidence ?? { status: 'absent' },
        subjectKey: props.subjectKey ?? null,
      }),
    );
  }
  const blocked = nonRunState(props.runs, props.sourceHint);
  if (blocked !== null) {
    return createElement('div', null, createElement(AnalysisStyles, null), pageHead, navigation, blocked);
  }
  const views = props.runs.status === 'ready' ? props.runs.runs : [];
  const current = pickRun(views, props.route.params['run']);
  if (current === null) {
    return createElement(
      'div',
      null,
      createElement(AnalysisStyles, null),
      emptyState('Nothing measured yet', props.sourceHint ?? 'Run `npm run analyze`.'),
    );
  }
  const baseline = pickBaseline(views, current, props.route.params['base']);

  const toolbar = createElement(
    'div',
    { className: 'mtg-toolbar' },
    runPicker(views, current, 'Run', 'run', props.onSetParams),
    section === 'diff' && baseline !== null
      ? runPicker(
          views.filter((view) => view.run.id !== current.run.id),
          baseline,
          'Compare against',
          'base',
          props.onSetParams,
        )
      : null,
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'span',
      { className: 'mtg-page-note' },
      `${current.run.set.code} · ${current.run.set.name}`,
    ),
  );

  return createElement(
    'div',
    { className: 'mtg-analysis' },
    createElement(AnalysisStyles, null),
    createElement(
      'div',
      { className: 'mtg-page-head' },
      createElement('h1', { className: 'mtg-page-title' }, 'Set analysis'),
      // The games count reads here and nowhere else. It used to ride in the app
      // header on every route — `XMP · 2,700 games analyzed` over a deck you
      // were building — where it was a number with no page to be about. This is
      // the page it is about, and the run it measured is named in the toolbar a
      // line below.
      createElement(
        'span',
        { className: 'mtg-page-note' },
        `${integer(current.run.health.games)} games analyzed`,
      ),
      // And nothing else. `health.label` used to read here: a sentence the
      // producing tool writes about its own machinery — "10 color pairs, 45
      // matchups x 60 games, greedy v0 bots on the flagship set, decks built
      // by @mtg/deckbuild" is the staged run's — which named two internal tools
      // and a version marker on a screen a player opens, cost a wrapped line of
      // a 390px phone's first screen, and repeated the game count printed
      // beside it and the set named in the toolbar below. The sweep shape it
      // carries that nothing else does is on the run itself, and `analyze`
      // writes it in the units a reader has.
    ),
    toolbar,
    navigation,
    header(current),
    runDetails(current),
    failures(current.run.health.gates),
    sectionBody(section, current, baseline, props.games, props.route, props.onSetParams),
  );
}

/**
 * Plugs the surface into `App`'s `views` map.
 *
 * The router is the only thing the shell hands a view, so this closes over the
 * data and reads the section, run and filters back out of the route.
 */
export function analysisView(
  runs: AnalysisRunsState,
  games: AnalysisLogState,
  calibration: CalibrationState = { status: 'absent' },
  retune: RetuneState = { status: 'absent' },
  evidence: EvidenceState = { status: 'absent' },
  subjectKey: string | null = null,
  sourceHint?: string,
): (router: UiRouter) => ReactNode {
  return (router: UiRouter): ReactNode =>
    createElement(AnalysisSurface, {
      runs,
      games,
      calibration,
      retune,
      evidence,
      subjectKey,
      route: router.route,
      onSetParams: router.setParams,
      ...(sourceHint === undefined ? {} : { sourceHint }),
    });
}
