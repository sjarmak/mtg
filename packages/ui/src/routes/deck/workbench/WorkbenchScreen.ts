/**
 * The deck workbench: a form, a shelf, and whatever is selected between them.
 *
 * `mtg-yp33`. Everything about the arrangement follows from one measurement: a
 * build is minutes, not milliseconds. So the build is a job the page polls, the
 * three states it can be in are drawn rather than inferred from whether a fetch
 * is still open, and the record of a session is a shelf of named variations
 * rather than a transcript.
 *
 * # Four states, and none of them is a blank page
 *
 * *No server.* The tab still opens and says which command starts one, the way
 * the Design tab does. Nothing throws.
 *
 * *Server, no spend ceiling.* Everything reads: the shelf, every variation ever
 * built, the form itself. Only the build button is disabled, beside the sentence
 * that says why. That is the arrangement that stops a page from spending money
 * nobody authorized, and it is drawn as a deliberate state rather than as a
 * failure.
 *
 * *Building.* One at a time, because each build spends against the ceiling.
 *
 * *Built.* The variation is on the shelf and on screen, and it can be rebuilt
 * with one field changed.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Answer, Issue, Job, Shelf, Variation, WorkbenchSet } from './client';
import {
  deleteVariation,
  fetchJob,
  fetchSets,
  fetchShelf,
  fetchVariation,
  startBuild,
  validateCriteria,
} from './client';
import { CriteriaForm } from './CriteriaForm';
import { VariationShelf } from './VariationShelf';
import { VariationView } from './VariationView';
import type { WorkbenchDraft } from './draft';
import { draftOf, EMPTY_DRAFT, suggestedName, toCriteriaRequest } from './draft';

export const WORKBENCH_TITLE = 'Deck workbench';

/**
 * How often a running build is asked about.
 *
 * Two seconds because the thing being watched takes minutes: a tighter poll
 * would be dozens of requests per build to learn nothing, and a looser one would
 * leave a finished deck sitting unseen for longer than it took to notice.
 */
const POLL_MS = 2000;

/** Whether the deck server answered at all, and what it said if it refused. */
type ServerState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'ready'; readonly sets: readonly WorkbenchSet[] }
  | { readonly kind: 'unreachable'; readonly message: string };

export interface WorkbenchScreenProps {
  /**
   * Handed a finished variation to deal a game from.
   *
   * Optional, and its absence is a real state rather than a missing wire: a deck
   * can only be played when the page has the staged set its card ids resolve
   * against. See `./play.ts`.
   */
  /**
   * Hands a variation to a game, with the deck it should face.
   *
   * `opponentId` is another variation on the shelf, or `null` for the mirror
   * `../../play/deal.ts` has always dealt. The screen passes the id rather than
   * the deck, because reopening a variation against the pool is the caller's
   * job and it is the caller that owns the refusal when a card is gone.
   */
  readonly onPlay?: (variation: Variation, opponentId: string | null) => void;
  /**
   * A refusal decided outside this screen, drawn beside its own.
   *
   * The one that arrives this way is a deck that cannot be dealt because the
   * staged sets no longer hold cards it names. That check belongs to whoever
   * holds the pool, which is not this component, and the sentence still has to
   * appear where the person pressed the button.
   */
  readonly refusal?: string;
  /**
   * A variation to open instead of the newest one.
   *
   * `mtg-yp33.8`. The Decks tab lists every built variation now, so pressing one
   * has to arrive here already showing that deck. Absent means the shelf's own
   * rule applies: the newest is what somebody returning to this tab is most
   * likely to want, and opening it costs nothing.
   */
  readonly openVariationId?: string;
}

export function WorkbenchScreen(props: WorkbenchScreenProps): ReactElement {
  const [server, setServer] = useState<ServerState>({ kind: 'reading' });
  const [draft, setDraft] = useState<WorkbenchDraft>(EMPTY_DRAFT);
  const [name, setName] = useState('');
  /** Whether the person has edited the name, so a suggestion stops overwriting it. */
  const [namedByHand, setNamedByHand] = useState(false);
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [shelf, setShelf] = useState<Shelf>({ variations: [], unreadable: [] });
  const [selected, setSelected] = useState<Variation | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [armed, setArmed] = useState(true);
  /** A refusal that belongs to no field: the server declining the whole request. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [parent, setParent] = useState<{ readonly id: string; readonly name: string } | null>(null);

  /**
   * What the build itself said, in the order it was said.
   *
   * Both sentences answer the same button and both go inside the pinned block
   * that holds it: `refusal` is the server declining the request, and a failed
   * job is a build that started and did not finish. They were siblings of the
   * form, which put them at the end of a scroll the button is pinned above.
   */
  const buildRefusals: readonly string[] = [
    ...(refusal === null ? [] : [refusal]),
    ...(job !== null && job.state === 'failed'
      ? [`“${job.name}” could not be built: ${job.error ?? 'no reason was given'}`]
      : []),
  ];

  const reloadShelf = useCallback(async (): Promise<void> => {
    const answer = await fetchShelf();
    if (answer.kind === 'ok') setShelf(answer.value);
  }, []);

  useEffect(() => {
    void (async (): Promise<void> => {
      const answer = await fetchSets();
      if (answer.kind !== 'ok') {
        setServer({ kind: 'unreachable', message: answer.message });
        return;
      }
      setServer({ kind: 'ready', sets: answer.value.sets });
      // Drawn at load rather than discovered by pressing the button. The
      // unarmed state is a deliberate arrangement, and a page that draws an
      // enabled button over it is describing a server that does not exist.
      setArmed(answer.value.builds);
      const shelfAnswer = await fetchShelf();
      if (shelfAnswer.kind !== 'ok') return;
      setShelf(shelfAnswer.value);
      // The newest build, opened. Measured before this, the right pane opened as
      // 1158x836 holding one 234px sentence — 0.44% of it carrying anything —
      // while the shelf that would have filled it sat 347px below the fold of
      // the other column. A session's last build is the one thing a person
      // returning to this tab is most likely to want, and nothing is spent
      // opening it: the shelf row already names the id.
      const wanted = props.openVariationId;
      const chosen =
        wanted === undefined
          ? shelfAnswer.value.variations[0]
          : shelfAnswer.value.variations.find((row) => row.id === wanted);
      if (chosen === undefined) return;
      const opened = await fetchVariation(chosen.id);
      if (opened.kind === 'ok') setSelected(opened.value);
    })();
    // Once, on arrival. Which variation is open after that is this screen's own
    // business, and re-applying the caller's id on every render would undo every
    // shelf row the person pressed after it -- the rule `DeckLibrary` follows
    // for the link's deck id, one file up.
  }, []);

  // Validation on every edit rather than on submit, for the reason the design
  // route gives: a list of refusals under a button is a list somebody has to map
  // back onto a form by hand, and this form has ten fields.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (server.kind !== 'ready') return undefined;
    if (draft.prompt.trim() === '' && draft.sets.length === 0) {
      setIssues([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        const answer = await validateCriteria(toCriteriaRequest(draftRef.current));
        if (!live) return;
        if (answer.kind === 'ok') setIssues(answer.value.ok ? [] : answer.value.issues);
      })();
    }, 250);
    return (): void => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, server.kind]);

  // The poll. It runs only while a job is running, and stops itself the moment
  // the job settles, so an idle tab makes no requests at all.
  useEffect(() => {
    if (job === null || job.state !== 'running') return undefined;
    let live = true;
    const timer = setInterval(() => {
      void (async (): Promise<void> => {
        const answer = await fetchJob(job.id);
        if (!live || answer.kind !== 'ok') return;
        setJob(answer.value);
        if (answer.value.state === 'done' && answer.value.variation !== undefined) {
          setSelected(answer.value.variation);
          await reloadShelf();
        }
      })();
    }, POLL_MS);
    return (): void => {
      live = false;
      clearInterval(timer);
    };
  }, [job, reloadShelf]);

  const build = useCallback((): void => {
    setRefusal(null);
    void (async (): Promise<void> => {
      const answer: Answer<Job> = await startBuild({
        criteria: toCriteriaRequest(draftRef.current),
        name: name.trim() === '' ? suggestedName(draftRef.current) : name.trim(),
        parentId: parent?.id ?? null,
      });
      if (answer.kind === 'ok') {
        setJob(answer.value);
        return;
      }
      // Unarmed is not a failure and not a missing server: it is the deliberate
      // arrangement, so the button state changes and the sentence is the
      // server's own.
      if (answer.kind === 'unarmed') {
        setArmed(false);
        setRefusal(answer.message);
        return;
      }
      setRefusal(answer.message);
    })();
  }, [name, parent]);

  const open = useCallback((id: string): void => {
    void (async (): Promise<void> => {
      const answer = await fetchVariation(id);
      if (answer.kind === 'ok') setSelected(answer.value);
      else setRefusal(answer.message);
    })();
  }, []);

  const rebuild = useCallback((): void => {
    if (selected === null) return;
    // The criteria come back into the boxes and the parent is recorded, so the
    // next build is a variation beside this one rather than a replacement of it.
    setDraft(draftOf(selected.criteria));
    setParent({ id: selected.id, name: selected.name });
    if (!namedByHand) setName(`${selected.name} (again)`);
  }, [selected, namedByHand]);

  const remove = useCallback((): void => {
    if (selected === null) return;
    void (async (): Promise<void> => {
      const answer = await deleteVariation(selected.id);
      if (answer.kind !== 'ok') {
        setRefusal(answer.message);
        return;
      }
      setSelected(null);
      if (parent?.id === selected.id) setParent(null);
      await reloadShelf();
    })();
  }, [selected, parent, reloadShelf]);

  if (server.kind === 'reading') {
    return createElement(
      'div',
      { className: 'mtg-workbench' },
      createElement('p', { className: 'mtg-workbench__hint' }, 'Reading the deck server…'),
    );
  }

  if (server.kind === 'unreachable') {
    return createElement(
      'div',
      { className: 'mtg-workbench' },
      createElement('p', { className: 'mtg-workbench__hint' }, server.message),
    );
  }

  const building = job !== null && job.state === 'running';
  // From the shelf rather than a second request, the way `./VariationShelf.ts`
  // resolves it. A parent that is no longer on the shelf was deleted, and that
  // is worth drawing as nothing rather than as a name nobody can open.
  const parentRow =
    selected?.parentId === null || selected?.parentId === undefined
      ? undefined
      : shelf.variations.find((row) => row.id === selected.parentId);
  const selectedParent = parentRow === undefined ? null : { id: parentRow.id, name: parentRow.name };

  return createElement(
    'div',
    { className: 'mtg-workbench' },
    createElement(
      'div',
      { className: 'mtg-workbench__panes' },

      createElement(
        'div',
        { className: 'mtg-workbench__left' },
        // The shelf leads the column and the form follows it. `mtg-yp33.9`,
        // and the playtester's call: measured at 1600x1000 the shelf started at
        // y=1384 in an 836px column, 548px below the fold and behind the whole
        // form, in a pane whose scrollbar you had to discover -- the same
        // defect `mtg-brd8` fixed for the Build button by pinning it. Leading
        // with it inverts what the column is for rather than spending more of
        // an already-full viewport on a second pinned region: the form is used
        // once per deck, and the shelf is the thing you come back to.
        VariationShelf({
          variations: shelf.variations,
          unreadableCount: shelf.unreadable.length,
          selectedId: selected?.id ?? null,
          onSelect: open,
        }),
        // No title here. `../deck-screen.ts` already draws `WORKBENCH_TITLE` in
        // the frame's head bar, and this drew a second copy of it inside the
        // left column, one line under the first.
        CriteriaForm({
          draft,
          onChange: (next) => {
            setDraft(next);
            if (!namedByHand && parent === null) setName(suggestedName(next));
          },
          sets: server.sets,
          issues,
          name,
          onNameChange: (value) => {
            setNamedByHand(true);
            setName(value);
          },
          canBuild: armed,
          building,
          onBuild: build,
          refusals: buildRefusals,
          ...(parent === null ? {} : { parentName: parent.name }),
        }),
        building
          ? createElement(
              'p',
              { className: 'mtg-workbench__hint' },
              `Building “${job.name}”. This takes minutes: the model is reading the pool and choosing ` +
                'cards, and every round is checked against the criteria before the next one.',
            )
          : null,
      ),

      createElement(
        'div',
        { className: 'mtg-workbench__right' },
        selected === null
          ? createElement(
              'p',
              { className: 'mtg-workbench__hint' },
              'Pick a variation to read it, or build one.',
            )
          : VariationView({
              variation: selected,
              onRebuild: rebuild,
              onDelete: remove,
              ...(selectedParent === null ? {} : { parent: selectedParent, onOpenParent: open }),
              ...(props.refusal === undefined ? {} : { refusal: props.refusal }),
              ...(props.onPlay === undefined
                ? {}
                : {
                    onPlay: (opponentId: string | null): void => {
                      props.onPlay?.(selected, opponentId);
                    },
                    // Every other deck on the shelf, in the shelf's own order.
                    // A deck is not among its own opponents: a mirror is the
                    // select's first option and picking it twice would be two
                    // names for one game.
                    opponents: shelf.variations
                      .filter((row) => row.id !== selected.id)
                      .map((row) => ({ id: row.id, name: row.name })),
                  }),
            }),
      ),
    ),
  );
}
