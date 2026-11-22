/** Quiet, scrolling prose inside the existing context rail. */
export const ADVISOR_CSS = `
.mtg-advisor { font-size: var(--mtg-text-sm); line-height: 1.5; overflow-wrap: anywhere; }
.mtg-advisor h2 { font-size: var(--mtg-text-base); margin: 0 0 var(--mtg-space-3); }
.mtg-advisor h3 { font-size: var(--mtg-text-sm); margin: var(--mtg-space-3) 0 var(--mtg-space-1); }
.mtg-advisor p { margin: var(--mtg-space-2) 0; }
.mtg-advisor ul { padding-inline-start: var(--mtg-space-5); margin-block: var(--mtg-space-2); }
.mtg-advisor details { border-bottom: 1px solid var(--mtg-line); padding-block: var(--mtg-space-2); }
.mtg-advisor summary { cursor: pointer; font-weight: 600; }
.mtg-advisor summary:hover { color: var(--mtg-accent); }
.mtg-advisor label { display: grid; gap: var(--mtg-space-2); margin-bottom: var(--mtg-space-3); }
.mtg-advisor select { max-width: 100%; color: var(--mtg-ink); background: var(--mtg-surface-raised); }
.mtg-advisor__note { color: var(--mtg-ink-muted); }
.mtg-advisor__preview { display: block; color: var(--mtg-ink-muted); font-weight: 400; }
`;
