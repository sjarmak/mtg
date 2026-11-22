/**
 * The feedback helper: a floating button and the panel it opens.
 *
 * Fixed to the bottom-right corner above everything, because it is drawn over
 * every route and must not move what it is reporting on. Above the phone's
 * fixed navigation (`mobile.ts`, z-index 3), since a report is written while
 * that is on screen.
 */
export const FEEDBACK_CSS = `
.mtg-feedback {
  position: fixed; z-index: 4;
  right: max(var(--mtg-space-4), env(safe-area-inset-right));
  bottom: max(var(--mtg-space-4), env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: flex-end; gap: var(--mtg-space-2);
  max-width: min(28rem, calc(100vw - 2 * var(--mtg-space-4)));
}
.mtg-feedback--open { align-items: stretch; }
.mtg-feedback__open { font-weight: 600; }
.mtg-feedback-toggle[aria-pressed='true'] { background: var(--mtg-accent); color: var(--mtg-accent-ink); }
.mtg-feedback--pointing {
  left: 50%; right: auto; translate: -50% 0;
  padding: var(--mtg-space-2) var(--mtg-space-4);
  border-radius: var(--mtg-radius-md); background: var(--mtg-accent); color: var(--mtg-accent-ink);
  font-size: var(--mtg-text-sm); font-weight: 600;
}
.mtg-feedback__panel {
  width: 28rem; max-width: 100%; max-height: calc(100dvh - 6rem); overflow: auto;
  padding: var(--mtg-space-4);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  box-shadow: var(--mtg-shadow-card);
  display: flex; flex-direction: column; gap: var(--mtg-space-3);
}
.mtg-feedback__heading { margin: 0; font-size: var(--mtg-text-base); }
.mtg-feedback__status, .mtg-feedback__outcome { margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-feedback__outcome { color: var(--mtg-ink); }
.mtg-feedback__paste {
  min-height: 4rem; display: grid; place-items: center;
  padding: var(--mtg-space-2);
  border: 1px dashed var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken); color: var(--mtg-ink-muted);
  font-size: var(--mtg-text-sm); text-align: center;
}
.mtg-feedback__paste:focus-visible { outline: 2px solid var(--mtg-accent); }
.mtg-feedback__shot { max-width: 100%; max-height: 12rem; border-radius: var(--mtg-radius-sm); }
.mtg-feedback__field { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
.mtg-feedback__label { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-feedback__input { min-width: 0; width: 100%; resize: vertical; }
.mtg-feedback__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-3); }
.mtg-feedback__inline { display: inline-flex; align-items: center; gap: var(--mtg-space-2); font-size: var(--mtg-text-sm); }
.mtg-feedback__pointed { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); font-family: var(--mtg-font-mono); overflow-wrap: anywhere; }
/* The model's proposed bead, set apart from the fields above it because it is
   the lab answering rather than the person writing. Both arms wear it: the
   refused one is a bare paragraph, so the rule resets the margin itself. */
.mtg-feedback__draft {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  margin: 0;
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken);
  font-size: var(--mtg-text-sm);
}
.mtg-feedback__draft > p { margin: 0; }
.mtg-feedback__draft > ul { margin: 0; padding-inline-start: var(--mtg-space-4); }
`;
