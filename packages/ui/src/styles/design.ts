/**
 * The set designer's layout: two columns, a form on the left and what the brief
 * would build on the right.
 *
 * `mtg-yddw`. Two columns because the whole argument for the designer being a
 * surface rather than a form is that a brief's consequences are visible while it
 * is written — a skeleton census on a second screen, or below a fold, is a thing
 * you go and look at, which is the same cost as running the command. Under
 * 60rem it is one column and the consequences follow the form, because a 390px
 * phone has one column whatever the argument.
 *
 * `data-refused` marks a field the server refused, and it is an attribute rather
 * than a class so a field's own markup does not change shape between the two
 * states. Color is not the whole of the signal: the refusal is also a sentence
 * under the field, because a red border says something is wrong and never says
 * what.
 */
export const DESIGN_CSS = `
.mtg-design { display: flex; flex-direction: column; gap: var(--mtg-space-4); padding: var(--mtg-space-4); }
.mtg-design__head { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-design__columns {
  display: grid; gap: var(--mtg-space-4);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start;
}
.mtg-design__column { display: flex; flex-direction: column; gap: var(--mtg-space-4); min-inline-size: 0; }
@media (max-width: 60rem) {
  .mtg-design__columns { grid-template-columns: minmax(0, 1fr); }
}
.mtg-design__field { display: flex; flex-direction: column; gap: var(--mtg-space-1); min-inline-size: 0; flex: 1 1 12rem; }
.mtg-design__row { display: flex; flex-wrap: wrap; gap: var(--mtg-space-3); align-items: flex-start; }
.mtg-design__item {
  display: flex; flex-direction: column; gap: var(--mtg-space-3);
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken);
}
.mtg-design__hint { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); }
.mtg-design__issue { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-negative); }
.mtg-design__verdict { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink); }
.mtg-design__verdict[data-state='invalid'],
.mtg-design__verdict[data-state='refused'] { color: var(--mtg-negative); }
.mtg-design__verdict[data-state='unreachable'],
.mtg-design__verdict[data-state='unfinished'] { color: var(--mtg-ink-muted); }
.mtg-input[data-refused='true'],
.mtg-select[data-refused='true'] { border-color: var(--mtg-negative); }
.mtg-design__notes { margin: 0; padding-inline-start: var(--mtg-space-4); font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-design__notes li[data-refused='true'] { color: var(--mtg-negative); }
.mtg-design__scroll { overflow-x: auto; max-inline-size: 100%; }
.mtg-design__table { border-collapse: collapse; font-size: var(--mtg-text-sm); font-variant-numeric: tabular-nums; }
.mtg-design__table th, .mtg-design__table td {
  padding: var(--mtg-space-1) var(--mtg-space-3);
  border-block-end: 1px solid var(--mtg-line);
  text-align: end;
}
.mtg-design__table th[scope='row'] { text-align: start; color: var(--mtg-ink-muted); font-weight: 400; }
.mtg-design__curve { display: flex; flex-direction: column; gap: 2px; }
.mtg-design__bar { display: flex; align-items: center; gap: var(--mtg-space-2); font-size: var(--mtg-text-sm); }
.mtg-design__bar-label { inline-size: 1.5rem; text-align: end; color: var(--mtg-ink-muted); font-variant-numeric: tabular-nums; }
.mtg-design__bar-fill {
  display: inline-flex; align-items: center; justify-content: flex-end;
  min-inline-size: 1.5rem; padding-inline-end: var(--mtg-space-2);
  background: var(--mtg-accent-soft); color: var(--mtg-ink);
  border-radius: var(--mtg-radius-md);
  font-variant-numeric: tabular-nums;
}
`;
