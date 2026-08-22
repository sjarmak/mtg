# Project Instructions for AI Agents

## Read AGENTS.md first

`AGENTS.md` holds the binding codebase conventions: workspace layout, the
`package.json` template, code style, the LLM provider rules, third-party engine
licensing, the destructive-command rule, and two web-UI constraints that fail
silently rather than loudly. This file is loaded automatically and that one is
not, so read it before writing code.

## Build & Test

```bash
npm run typecheck     # tsc --noEmit, strict, noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm test              # vitest, unit + balance projects
npm run lint          # eslint packages --max-warnings=0
npm run format        # prettier --check
npm run test:balance  # seeded 10,035-game format-health gate, blocking in CI
npm run slice         # the whole loop: set-gen, deck build, mass sim, metrics verdict, Forge boot
npm run play          # open the lab and play a sealed game; no API key, no Forge
npm run lab           # open the lab on a real deck: Scryfall art and its mana base
```

`npm run play` is the human entry point. It takes the set from the most recent
`npm run slice` run, then the committed `tideglass-reach` fixture, so a clean
checkout can play immediately; it stages the set at
`packages/ui/public/set.json` and starts Vite. When it cannot find a set it
prints every place it looked, and it never starts a server on a set the DSL
would reject. Pass a path to play something else:
`npm run play -- path/to/set.json`.

Both launchers also stage the **rules-text symbols**, because a `{T}`
referenced from another host is an empty box for a viewer who cannot reach it.
`packages/ui/tools/stage-symbols.ts` pulls the 29 symbols through
`@mtg/image-cache` into `data/images/` and copies them into
`packages/ui/public/symbols/` (gitignored, nothing vendored), and the page
draws them from its own origin. **All 29 or none** — one short would draw one
empty box, so a single failure hands the page the lab's own drawings instead
and the launcher says which on stdout.

`npm run lab` is the same arrangement for a real deck: it takes the artifact
from the most recent `decklab --artifact` run, falls back to the committed
`boros-aggro` deck, stages it at `packages/ui/public/deck.json` and opens the
Deck tab. It also pulls each illustration into `packages/ui/public/art/`
(gitignored) and points the staged deck at the local copies, so the page never
reaches another host while you are looking at it.

Twenty-one packages: `card-geometry`, `card-render`, `cube`, `data`, `deckbuild`, `decklab`, `design-data`, `draft-export`, `dsl`, `engine`, `forge-export`, `image-cache`, `kernel`, `llm`, `metrics`, `netplay`, `referee`, `setgen`, `sim`, `slice`, `ui`.

That sentence is checked: `packages/slice/test/workspace-roster.test.ts` fails
when the names or the count stop matching `packages/`. A roster loaded into
every session and verified by nothing goes stale the first time somebody adds a
package.

The card store is ingested rather than committed:
`data/store/mtg.sqlite` is gitignored and a re-ingest is idempotent. Query it
with `npx tsx packages/data/src/cli.ts find "<name>"`.

## Architecture Overview

Set-generation and playing lab. Engine strategy is settled in
`docs/adr/0001-engine-strategy.md`, including the two kill-tests and their
pre-committed fallbacks; the CR 613 kernel-velocity kill-test has been run and
passed, so the Forge-bridge fallback does not fire. The decision is a
**build-first hybrid** — custom strict-TypeScript event-sourced rules kernel
plus a typed mechanics DSL as the core; Forge at arm's length (subprocess only,
GPL — never vendored) as parity oracle, DSL transpile target and early human
play surface; XMage and Argentum (MIT) mined as reference designs for the
layers and replacement subsystems; an LLM referee handling only framed,
schema-constrained rulings while the kernel owns all state.

Load-bearing invariant: the set generator's output space stays inside the
engine's enforceable space — cards are emitted in the DSL, never free text the
engine cannot run. Inside, not equal to: `ModelAbilityIsAbility` and
`ModelEffectSchema` prove containment at compile time.

Prior-art evidence and the two argued architectures live in `docs/research/`.

## Conventions & Patterns

- ZFC: semantic judgment (card quality, flavor, design tradeoffs, rulings) goes
  to models; code owns IO, schema validation, state, sim mechanics, budgets.
- Balance is a CI assertion, not a vibe: seeded sims, win-rate bands,
  no-dominant-strategy guards as tests.
- Sim logs emit a superset of the 17Lands replay schema under identical column
  names, so human-data calibration is a join.
- License hygiene: GPL and AGPL engines behind process boundaries only; a CI
  guard fails the build on a vendored engine path. Non-commercial, under the
  WotC Fan Content Policy.
