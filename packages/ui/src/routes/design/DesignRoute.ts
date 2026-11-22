/**
 * The Design destination: write a set brief, see what it would build, and run it
 * for nothing.
 *
 * `mtg-yddw`. The seventh mode beside Play, Draft, Decks, Cards, Analysis and
 * Replay. Everything it knows about what a legal brief is comes off
 * `/design-api`, because the schema reaches `@mtg/design-data`, which reads its
 * canon off disk at import time and so cannot be bundled into a browser. That is
 * not a workaround: it means there is exactly one definition of a legal brief in
 * the repository, and this page cannot drift from it.
 *
 * # One draft, held here
 *
 * Every panel is a function of the draft and hands the whole next draft back, so
 * the JSON on screen is the same value the server judged rather than a
 * reconstruction of it. The draft survives a reload through `./draft-store.ts`,
 * and a write that cannot be kept is said out loud rather than swallowed: a
 * paragraph of theme and a list of named cards is an evening's work.
 *
 * # Asked again on every edit, and only over one flight
 *
 * Validation and the skeleton plan are both free and both re-asked as the brief
 * changes, after a short pause so a keystroke is not a request. Answers are
 * guarded by a counter rather than canceled: a slow answer to an old draft
 * would otherwise paint refusals about text nobody has on screen any more.
 *
 * # What this page will not do
 *
 * Spend money. The run is a fixture replay, the server has no paid branch, and
 * `./RunPanel.ts` carries the argument. And it does not edit authored cards: a
 * brief that carries finished DSL cards keeps them, untouched, through
 * `carriedFrom` — a text box for a card is a way to break a set.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchVocabulary, planDraft, runDraft, validateDraft } from './client';
import type { BriefIssue, PlanAnswer, RunAnswer, SkeletonPlan, ValidationAnswer, Vocabulary } from './client';
import { blankDraft, briefFileName, briefFrom } from './draft';
import type { BriefDraft } from './draft';
import { carriedFrom, draftFrom, parseBriefText, readDraft, writeDraft } from './draft-store';
import { BriefFilePanel } from './BriefFilePanel';
import { IdentityPanel } from './IdentityPanel';
import { MechanicsPanel } from './MechanicsPanel';
import { NotesPanel } from './NotesPanel';
import { RequiredCardsPanel } from './RequiredCardsPanel';
import { SignaturesPanel, SpellRolesPanel } from './RolesPanel';
import { RunPanel } from './RunPanel';
import { invalidNote, SkeletonPanel } from './SkeletonPanel';
import { StatusPanel } from './StatusPanel';
import { NONE_TOUCHED, pointerOf, revealedIssues, withTouched } from './touched';
import type { Touched } from './touched';

export const DESIGN_TITLE = 'Design a set';

const DESIGN_EXPLAIN =
  'A brief is what the generator is given: a world, the mechanics it may use, and the cards it must print. Everything below is checked by the generator itself, and the skeleton is derived from the brief without calling a model.';

export const NEW_BRIEF_LABEL = 'Start a new brief';

export const NOT_KEPT_NOTE =
  'This browser will not keep the draft, so it is gone at the next reload. Save the brief to a file before you close the tab.';

export function openedNote(name: string): string {
  return `Read “${name}” into the form. Nothing it carries that this editor does not show — authored cards included — is changed by editing here.`;
}

export function unreadableNote(name: string, reason: string): string {
  return `“${name}” could not be read: ${reason}`;
}

/** How long a person stops typing before the page asks the server. */
const QUIET_MS = 350;

export interface DesignRouteProps {
  /** Overrides the pause between the last keystroke and the request, for tests. */
  readonly quietMs?: number;
}

export function DesignRoute(props: DesignRouteProps = {}): ReactElement {
  const quiet = props.quietMs ?? QUIET_MS;
  /** The draft this tab opened on, kept so the reveal rule can ask where it came from. */
  const [restored] = useState<BriefDraft | null>(readDraft);
  const [draft, setDraft] = useState<BriefDraft>(() => restored ?? blankDraft());
  const [touched, setTouched] = useState<Touched>(NONE_TOUCHED);
  /** A brief that was written elsewhere shows its refusals at once; a new one does not. */
  const [revealAll, setRevealAll] = useState(restored !== null);
  /** Whatever an opened brief carried that this editor does not model. */
  const [carried, setCarried] = useState<Readonly<Record<string, unknown>>>({});
  const [vocabulary, setVocabulary] = useState<Vocabulary | null>(null);
  const [validation, setValidation] = useState<ValidationAnswer | null>(null);
  const [plan, setPlan] = useState<PlanAnswer | null>(null);
  const [run, setRun] = useState<RunAnswer | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** The brief exactly as the server sees it, and as the box on screen holds it. */
  const brief = useMemo<Readonly<Record<string, unknown>>>(
    () => ({ ...carried, ...briefFrom(draft) }),
    [carried, draft],
  );
  const json = useMemo(() => `${JSON.stringify(brief, null, 2)}\n`, [brief]);

  /**
   * Which flight is current.
   *
   * A ref rather than state: it is compared inside an answer that arrived after
   * the draft moved on, and re-rendering because a counter changed would be a
   * render for nothing.
   */
  const flight = useRef(0);

  useEffect(() => {
    let current = true;
    void fetchVocabulary().then((answer) => {
      if (current && answer.kind === 'vocabulary') setVocabulary(answer.vocabulary);
    });
    return (): void => {
      current = false;
    };
  }, []);

  useEffect(() => {
    setMessage(writeDraft(draft) ? null : NOT_KEPT_NOTE);
  }, [draft]);

  useEffect(() => {
    flight.current += 1;
    const mine = flight.current;
    setPending(true);
    const timer = setTimeout(() => {
      void validateDraft(brief).then((answer) => {
        if (flight.current !== mine) return;
        setValidation(answer);
        setPending(false);
        // The plan is asked only for a brief that parsed, because the plan route
        // would answer the same refusals a second time and the panel would then
        // have two ways to say one thing.
        if (answer.kind !== 'valid') {
          setPlan(null);
          return;
        }
        void planDraft(brief).then((planned) => {
          if (flight.current === mine) setPlan(planned);
        });
      });
    }, quiet);
    return (): void => {
      clearTimeout(timer);
    };
  }, [brief, quiet]);

  const issues: readonly BriefIssue[] =
    validation !== null && validation.kind === 'invalid' ? validation.issues : [];
  const shown = useMemo(() => revealedIssues(issues, touched, revealAll), [issues, touched, revealAll]);
  /** Fields rather than refusals: one field can earn two, and it is still one field to fix. */
  const outstanding = useMemo(() => new Set(issues.map((issue) => issue.pointer)).size, [issues]);

  /**
   * A field is touched when it is left, and when it is clicked: a chip and a
   * checkbox are answered by pressing them and may never take focus at all.
   */
  const touch = useCallback((event: { readonly target: unknown }): void => {
    const pointer = pointerOf(event.target);
    if (pointer === null) return;
    setTouched((known) => withTouched(known, pointer));
  }, []);

  const open = useCallback((text: string, name: string): void => {
    const parsed = parseBriefText(text);
    if (!parsed.ok) {
      setMessage(unreadableNote(name, parsed.message));
      return;
    }
    setDraft(draftFrom(parsed.value));
    setCarried(carriedFrom(parsed.value));
    setRevealAll(true);
    setRun(null);
    setMessage(openedNote(name));
  }, []);

  const start = useCallback((): void => {
    setDraft(blankDraft());
    setCarried({});
    setTouched(NONE_TOUCHED);
    setRevealAll(false);
    setRun(null);
    setMessage(null);
  }, []);

  const go = useCallback((): void => {
    setRunning(true);
    void runDraft(brief).then((answer) => {
      setRun(answer);
      setRunning(false);
    });
  }, [brief]);

  const planned: SkeletonPlan | null = plan !== null && plan.kind === 'plan' ? plan.plan : null;
  const planNote =
    plan === null
      ? null
      : plan.kind === 'invalid'
        ? invalidNote(plan.issues.length)
        : plan.kind === 'refused'
          ? plan.reason
          : plan.kind === 'unreachable'
            ? plan.reason
            : null;

  return createElement(
    'div',
    { className: 'mtg-design' },
    createElement(
      'header',
      { className: 'mtg-design__head' },
      createElement('h1', { className: 'mtg-panel__title' }, DESIGN_TITLE),
      createElement('p', { className: 'mtg-prompt__explain' }, DESIGN_EXPLAIN),
      createElement(
        'div',
        { className: 'mtg-toolbar' },
        createElement('button', { type: 'button', className: 'mtg-btn', onClick: start }, NEW_BRIEF_LABEL),
      ),
      message === null
        ? null
        : createElement('p', { className: 'mtg-design__hint', role: 'status' }, message),
    ),
    createElement(
      'div',
      { className: 'mtg-design__columns' },
      createElement(
        'div',
        { className: 'mtg-design__column', onBlur: touch, onClick: touch },
        createElement(IdentityPanel, { draft, onChange: setDraft, issues: shown, vocabulary }),
        createElement(MechanicsPanel, { draft, onChange: setDraft, issues: shown, vocabulary }),
        createElement(NotesPanel, { draft, onChange: setDraft, issues: shown }),
        createElement(RequiredCardsPanel, { draft, onChange: setDraft, issues: shown, vocabulary }),
        createElement(SpellRolesPanel, { draft, onChange: setDraft, issues: shown, vocabulary }),
        createElement(SignaturesPanel, { draft, onChange: setDraft, issues: shown, vocabulary }),
      ),
      createElement(
        'div',
        { className: 'mtg-design__column' },
        createElement(StatusPanel, { answer: validation, pending, shown: shown.length }),
        createElement(SkeletonPanel, { plan: planned, note: planNote }),
        createElement(RunPanel, {
          answer: run,
          running,
          onRun: go,
          canRun: validation !== null && validation.kind === 'valid',
          outstanding,
        }),
        createElement(BriefFilePanel, { json, fileName: briefFileName(draft), onOpen: open }),
      ),
    ),
  );
}
