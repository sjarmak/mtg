/**
 * The names more than one package barrel exports, and why each one is allowed.
 *
 * `package-surfaces.test.ts` gates on this list. The loop that finds collisions
 * is the cheap half; this file is the expensive half, because the question a
 * disjointness rule cannot answer on its own is which sharing is deliberate.
 * Three kinds of answer appear below and they are not interchangeable:
 *
 *  - **A schema declared more than once on purpose**, because the import that
 *    would remove the copy closes a dependency cycle or drags a Node-only module
 *    into a browser bundle. These are the entries a blanket rule gets wrong, and
 *    every one of them names the test that holds the copies together. A copy
 *    with no such test is written down as exactly that.
 *  - **A homonym**: two packages that mean unrelated things by one English word,
 *    with no shared shape to drift. The cost is real but bounded — a file that
 *    imports both aliases one — and it is paid where it lands rather than by
 *    renaming a central type.
 *  - **Duplication that should be merged**, kept here only because the merge is
 *    a change to packages this gate's own commit did not own. An entry of this
 *    kind states the merge that is owed.
 *
 * A new collision is expected to FAIL this gate, not to be added to the list on
 * sight. Adding an entry means writing the reason first and finding it true; if
 * the reason will not write, the name is a collision to fix.
 */

export interface SharedExport {
  /** The exported name. */
  readonly name: string;
  /** Every package whose barrel exports it, sorted, without the `@mtg/` prefix. */
  readonly packages: readonly string[];
  /** Why more than one package declares it. */
  readonly why: string;
}

const ART_MANIFEST = `The art manifest schema is declared twice on purpose (AGENTS.md).
\`@mtg/card-render\` pulls React in through \`@mtg/ui\`, and \`@mtg/ui\` cannot import
\`@mtg/card-render\` back because that arrow closes a cycle. So each states the shape it
reads, and \`packages/card-render/test/parity.test.ts\` holds the two renderers to one
specification.`;

const DECK_ARTIFACT = `The deck artifact's producer and its consumer describe it separately
because \`@mtg/ui\` must not depend on \`@mtg/decklab\`: that would put \`better-sqlite3\`
in a browser bundle (AGENTS.md). The two meet at a checked seam — \`packages/decklab/src/artifact.ts\`
writes it, \`packages/ui/src/lab/deck-artifact.ts\` parses it, and \`DECK_ARTIFACT_VERSION\`
is bumped on both sides together. \`packages/decklab/test/artifact-seam.test.ts\` writes one
artifact with the real producer and reads it back through the page's own parser, so a field
either side gains, loses or renames fails there rather than in a browser (mtg-bc2.133).`;

const REPLAY_COLUMNS = `\`packages/ui/src/replay/columns.ts\` states it: \`@mtg/sim\`'s entry
point pulls \`node:worker_threads\` and \`node:fs\`, and this package is bundled for a
browser, so it imports only erased types from \`@mtg/sim\` and restates the column grammar.
\`packages/ui/test/replay-contract.test.ts\` imports \`@mtg/sim\` for real, in Node, and fails
if a single field name, column spelling or the schema version drifts apart.`;

const REPLAY_SEAT = `Same seam as the replay columns: \`@mtg/ui\` cannot import \`@mtg/sim\`'s
runtime. \`@mtg/metrics\` reads the sim log in Node and derives its seat vocabulary from
\`@mtg/sim\`'s types, so it cannot drift; \`@mtg/ui\` restates it against the CSV and is held
to \`@mtg/sim\` by \`packages/ui/test/replay-contract.test.ts\`.`;

/**
 * Sorted by name, which is the order the gate reports collisions in, so a
 * failure diff lines up with this file.
 */
export const SHARED_EXPORTS: readonly SharedExport[] = [
  { name: 'ART_MANIFEST_VERSION', packages: ['card-render', 'ui'], why: ART_MANIFEST },
  { name: 'ArtManifest', packages: ['card-render', 'ui'], why: ART_MANIFEST },
  { name: 'ArtResolver', packages: ['card-render', 'ui'], why: ART_MANIFEST },

  { name: 'DECK_ARTIFACT_VERSION', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },
  { name: 'DeckArt', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },
  { name: 'DeckArtifact', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },
  { name: 'DeckArtifactCheck', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },
  { name: 'DeckArtifactColor', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },
  { name: 'DeckArtifactEntry', packages: ['decklab', 'ui'], why: DECK_ARTIFACT },

  { name: 'END_REASONS', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'SIDES', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'SideTotals', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'SideTurnStats', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'TURN_OWNER_FIELDS', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'TURN_SIDE_EOT_FIELDS', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'TURN_SIDE_FIELDS', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'eotColumn', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'ownerColumn', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'sideColumn', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },
  { name: 'totalColumn', packages: ['sim', 'ui'], why: REPLAY_COLUMNS },

  { name: 'EndReason', packages: ['metrics', 'ui'], why: REPLAY_SEAT },
  { name: 'otherSide', packages: ['metrics', 'ui'], why: REPLAY_SEAT },

  {
    name: 'Card',
    packages: ['dsl', 'ui'],
    why: `\`@mtg/dsl\`'s is the card record the kernel runs; \`@mtg/ui\`'s is the React
component that draws one, named for what it draws. The one file that needs both,
\`packages/ui/src/card/Card.ts\`, imports the record as \`DslCard\` — the cost is a single
alias in a single file, against renaming the DSL's central type everywhere.`,
  },
  {
    name: 'CurveBucket',
    packages: ['deckbuild', 'design-data'],
    why: `\`@mtg/deckbuild\`'s is a mana value index in \`0..6\`; \`@mtg/design-data\`'s is a
validated \`{ mvMin, mvMax, … }\` record off a design skeleton. A number and an object, one
English phrase — there is no shape here for the two to agree or disagree about.`,
  },
  {
    name: 'DEFAULT_BATCH_SIZE',
    packages: ['data', 'setgen'],
    why: `\`@mtg/data\`'s is 1,000 rows per SQLite transaction during ingest; \`@mtg/setgen\`'s
is 10 cards per model call. Two unrelated numbers that happen to bound a batch.`,
  },
  {
    name: 'DeckEntry',
    packages: ['decklab', 'forge-export'],
    why: `\`@mtg/decklab\`'s is \`{ name, count }\` off a deck audit; \`@mtg/forge-export\`'s is
\`{ count, cardName, setCode? }\` on the way into a Forge \`.dck\` file, where the edition
code is what Forge reads. Merging them would put a Forge file format concern in the deck
lab's audit.`,
  },
  {
    name: 'ShortfallKind',
    packages: ['deckbuild', 'setgen'],
    why: `\`@mtg/deckbuild\`'s discriminates the gaps in a 40-card Limited deck;
\`@mtg/setgen\`'s names the ways an archetype is unplayable in a generated set. Different
subjects, and neither vocabulary is a superset of the other.`,
  },
  {
    name: 'Side',
    packages: ['decklab', 'sim'],
    why: `\`@mtg/decklab\`'s is \`'A' | 'B'\`, which of two decks the blind judge is looking at;
\`@mtg/sim\`'s is \`'user' | 'oppo'\`, the seat, spelled to match 17lands' perspective columns.
Aligning them would mean naming a seat after a blinding or a blinding after a seat.`,
  },
  {
    name: 'Source',
    packages: ['data', 'design-data'],
    why: `\`@mtg/data\`'s is row provenance, \`'scryfall' | 'lab'\`; \`@mtg/design-data\`'s is a
cited document — title, author, publisher, url, year. A tag and a citation.`,
  },
  {
    name: 'Violation',
    packages: ['decklab', 'dsl'],
    why: `\`@mtg/dsl\`'s is a card validation finding (\`code\`, \`message\`, \`path\`) and its
messages are prompt text one hop from the model, so its spelling is pinned by recorded
fixtures (AGENTS.md); \`@mtg/decklab\`'s is a deck audit finding (\`name\`, \`kind\`, \`detail\`)
about real cards the kernel never runs.`,
  },
  {
    name: 'cardColors',
    packages: ['deckbuild', 'ui'],
    why: `Two right answers to "what colors is this card". \`@mtg/deckbuild\`'s unions the
declared colors with the cost's, because an unvalidated card must not slip an off-color
spell into a deck; \`@mtg/ui\`'s additionally reads \`producesMana\` and a basic land's type,
because a face has to show a land's color. A builder that used the face's rule would let
a land's produced color count as a spell color.`,
  },
  {
    name: 'createRng',
    packages: ['kernel', 'setgen'],
    why: `\`@mtg/kernel\`'s is sfc32 with a 128-bit state that serializes into \`GameState\`
and is threaded through the reducer, so a game replays byte-identically; \`@mtg/setgen\`'s
is mulberry32 behind a closure, seeded once per generation run. One implementation cannot
be both a pure function of serialized state and a closure that carries its own.`,
  },
  {
    name: 'shuffle',
    packages: ['kernel', 'setgen'],
    why: `The same split as \`createRng\`: the kernel's returns the shuffled array and the
next \`RngState\`, setgen's draws from its closure. They are the two generators' surfaces,
not two spellings of one shuffle.`,
  },
  {
    name: 'slugify',
    packages: ['forge-export', 'setgen'],
    why: `\`@mtg/forge-export\`'s reproduces Forge's own file naming — \`lightning_bolt\`,
underscores, punctuation dropped — which was read off the shipped 2.0.14 resources rather
than guessed; \`@mtg/setgen\`'s mints DSL card ids — \`tgr-reefclan-harpooner\`, hyphens,
NFKD-folded. Different separators and different folding, each load-bearing where it is.`,
  },
];
