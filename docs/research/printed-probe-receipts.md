# Printed interaction probe receipts

`packages/ui/tools/printed-probe-run.ts` connects reviewed interaction tests to the
printed play-admission evidence contract. It is private, local tooling, not a
format-enablement switch. It requires no model service and touches no shared server.

## Historical support report

`packages/data/tools/printed-support-report.ts` joins a saved admission manifest,
its referenced receipts, pinned format/catalogs, and the actual Forge script archive.
It writes JSON to stdout and never starts a backend or enables play:

```sh
npx tsx packages/data/tools/printed-support-report.ts --config /path/to/report-config.json
```

The strict config is explicit about its scope. All paths below are relative to
the config file, except absolute paths, which remain absolute:

```json
{
  "schemaVersion": 1,
  "runtimeScope": "historical",
  "runtimeProvenance": "probe-run/provenance.json",
  "format": "akh-hou-limited-format-v1.json",
  "catalogs": ["akh-printed-catalog-v1.json", "hou-printed-catalog-v1.json", "mp2-printed-catalog-v1.json"],
  "admission": "admission.json",
  "evidenceRoot": "evidence",
  "forgeScripts": "cardsfolder.zip"
}
```

`runtimeProvenance` reads the existing probe producer's measured `subject`.
That saved subject must match the requested format and admission evidence;
the entire script archive must match its hash before and after inventory reads.
Every referenced script is also checked against its catalog hash. Receipt paths
are interpreted only under `evidenceRoot`, and symlinks escaping that root are
rejected. Configured input paths are trusted local operator choices, not a sandbox:
they may name regular files outside the config directory. Each archive read uses
the existing `unzip -p` approach with a ten-second deadline and one-MiB output bound.

The report always says `runtimeScope: "historical"` and
`liveRuntimeVerified: false`. Even a historically complete admission does not
establish that a currently running backend matches it. Missing reviews stay missing,
pending reviews stay pending, and script tokens are navigation facts, not proof
of supported interactions. Exit zero means the report was verified and generated,
not that its `admitted` field is true. Saved provenance remains trusted local
evidence, not an attestation against a malicious writer.

## Execution boundary

`runPrintedProbeSuite` accepts a workspace, pinned format/catalog inputs, an explicit
new output directory, a process deadline, and reviewed probe definitions. Each probe
names one test file, its expected test names, printing IDs, a controller,
and decision families. Multiple probes may claim disjoint assertion groups in the
same file; their union must cover every test in that file. Each file is executed
and hashed once, while controller checks and receipts retain the original groups.
Overlapping assertion claims are rejected, even across different controllers.
Assertion names must match Vitest's complete test names exactly.
The runner checks catalog membership; deciding whether a test actually proves a
decision family remains a review responsibility.

The runner compiles the current Java bridge, bundles the installed TypeScript adapter,
and copies those artifacts plus Forge's JAR and resources into an owned runtime
snapshot. It measures the copies, removes the original compilation, and passes the
snapshot manifest to the selected tests. Files are read-only as an accident guard,
not protection against a malicious process running as their owner.

Tests participating in qualification must use the test-only `snapshotForgeBackend`
helper. With no snapshot selected, that helper uses the normal workspace backend.
With a snapshot selected, it checks the measured identity, loads the copied adapter,
and explicitly selects the copied Forge home and compiled bridge. Missing, malformed,
or changed snapshots never fall back to workspace inputs.

Every successful session open records the exact test file/name, measured runtime,
actual format, and participating controllers. The runner requires matching usage for
every selected test. Passing unrelated tests without such usage cannot mint receipts.
No hidden game zones are recorded in this usage journal.

## Evidence checks and outputs

Before writing passed receipts, the runner requires:

- a successful test process and complete, exact test population;
- no failed, skipped, pending, missing, duplicate, or unexpected test results;
- matching snapshot usage for every assertion and the claimed controller;
- unchanged runtime bytes, selected tests, and the full shared
  `packages/forge-export/test/support` file tree (including additions/deletions).

Shared assertion helpers belong in that support directory. Every regular file
there is fingerprinted conservatively, even if a particular cohort does not
import it. Symlink entries are refused as an accident guard; this is still
trusted-local provenance, not protection against an adversarial concurrent writer.
Earlier receipts that omit a shared assertion helper must be rerun rather than
having their provenance retroactively amended.

The output directory contains `provenance.json`, `vitest.json`, `process.json`,
`snapshot-usage.jsonl`, and one structured receipt per probe under `probes/`.
The directory is created exclusively; rerunning cannot overwrite earlier evidence.
Failed runs retain available diagnostics but produce no passed receipts. The owned
POSIX process group includes Vitest, its workers, and Forge grandchildren, so a
deadline or output overflow terminates that group before snapshot cleanup.

The existing admission loader checks each receipt's file digest and matches its
complete subject and probe result against the admission manifest. These checks bind
claims together; they are not cryptographic attestation of a trusted producer.
The runner itself and the test assertions still require code review.

## Current verified slice

The end-to-end regression selects thirty-four probes with sixty-eight game assertions:

- Binding Mummy: local accept and decline paths, plus the native bot's opposing tap.
- Local match choices: either starting seat, legal priority, and two London
  mulligans with exact selected-card bottoming and hand/library conservation.
  The opponent's hand remains hidden; this does not qualify native pregame policy.
- Native priority: the bot casts a creature, yields a local response window,
  and the exact stack object resolves onto its battlefield after the local pass.
  This is action-level evidence, not a judgment of the bot's strategic policy.
- Native mulligans: a seeded land-light deck produces public mulligan messages;
  the resulting hidden hand size agrees with those messages and all sixty cards
  remain in hand/library. This does not judge which hidden cards the bot bottoms.
- Native starting-player choice: a seeded engine choice reaches the bot's first
  turn after only a local keep. No local starting choice is offered, and submitting
  one is rejected. This checks the controller path and outcome, not strategic quality.
- Cartouche/Trial of Solidarity: local owned-creature targeting and both trigger
  orders; separately, the native bot returns and recasts the same physical Trial.
- Decimator Beetle: local linked counter targets with the opposing target accepted
  or declined; the native bot removes its own counter and adds opposing counters.
- Market: local physical-card discard selection after drawing two, including
  invented/stale choice rejection; the native bot independently casts Market from
  its graveyard, draws and discards two, and exiles the source.
- Dawn: local graveyard casting, timing restrictions, exact creature recovery and
  source exile; the native bot independently casts Dawn and recovers creatures.
- Dusk/Dawn: a separate local sequence proves Dusk's power-three cutoff on both
  battlefields and Dawn's recovery of only the caster's low-power graveyard
  creatures, excluding high-power and opposing cards and exiling the source.
- Ahn-Crop Crasher: local decline/accept, exact blocker prevention, one skipped
  untap and subsequent recovery; the native bot independently exerts into a blocker
  and skips its next untap.
- Khenra Eternal: local unblocked, single-blocked, and double-blocked combat;
  exactly one life lost before combat damage when blocked and no Afflict trigger
  when unblocked. The native bot attacks into a local blocker and its Afflict
  trigger causes the same pre-damage life loss. These probes qualify neither
  other Afflict values nor attack-selection quality in other board positions.
- Censor, Sweltering Suns, and Desert of the Indomitable: exact cycling source
  discard and single-card draw. The local tests additionally count mana payments;
  native bot tests use public zone conservation and do not inspect payment choices.
- Censor counter-unless payment: separate local pay/decline assertions and a
  native casting assertion against a tapped-out local caster. The payer is local
  in every case; these do not prove the bot's optional-payment decisions.
- Shefet Monitor: local Forest/Desert selection and decline, with the search before
  the cycling draw; the native bot searches and draws with public zone counts.
- Sacred Cat and Adorned Pouncer: local source exile and distinct graveyard-token
  creation, timing restrictions, mana payment, and combat lifelink or double strike.
  The native bot independently casts and loses each creature, then produces its
  expected Zombie Cat body from the graveyard.
- Never // Return: local Never creature and planeswalker targeting, excluding
  lands and rejecting invented/stale choices; the native bot destroys a threat
  with Never, then casts Return to exile a graveyard card and create a 2/2 Zombie.
  The bot assertions track exact public source and target zone transitions. They
  do not qualify the fixture cards' other abilities. A separate local Return probe
  selects from each graveyard owner, verifies the complete legal target set,
  rejects invented/stale choices, preserves nonselected graveyard cards, and checks
  source/target exile plus exactly one new 2/2 Zombie. Its selection family is
  deliberately distinct from the native bot's combined Never/Return sequence.
- The five basic lands: local land-play limit, exact colored mana, tap/reuse limits,
  mana clearing, and next-turn untap; separate native probes pay generic `{3}` for
  Sweltering Suns cycling using three basic lands and draw one card. The v4 native
  probe checks those exact objects were untapped and the public mana pool was
  empty immediately before payment, then checks they untap at the first observed
  subsequent own turn. It also tracks public land objects across at least three
  land-play turns: each addition is exactly one land, observed during the bot's
  own main phase with an empty stack, and no second addition occurs in that turn.
  This proves the observed sequence, not inspection of hidden bot move options.
  Each name's
  seven AKH/HOU printings share a reviewed rules shape and Forge script digest,
  checked by `printed-basic-probe-bindings.test.ts`. This is explicit rules/script
  equivalence, not seven independently executed printing-art variants. The bot
  generic-payment family does not claim colored-spell payment or hidden payment choices.
  A separate colored-payment family checks native casting of Adorned Pouncer,
  Khenra Eternal, and Defiant Khenra, plus cycling of Censor and Shefet Monitor.
  Each uses only the matching basic land and checks the paid action on the public
  stack, exact tapped-land count, and empty remaining mana. Five wrong-color
  controls observe no such action through turn twelve despite sufficient land
  count. This is a seeded regression, not inspection of the bot's hidden hand or
  proof of the fixture cards' complete behavior.

Defiant Khenra has two printing-specific probes, local and native, covering four
casting/attack scenarios. They check public spell resolution, 2/2 stats, summoning
restrictions, committed attacking/tapping, exact combat damage, and trading with
a local blocker. A separate native blocking fixture has a local Sacred Cat attack:
the Cat dies, lifelink gains one life, the defending player takes no damage, and
one previously undamaged Khenra survives untapped with one damage. The projection
has no block-assignment edge; this is a seeded outcome check, not visibility into
the bot's choice. The matching local case validates legal blocker targets,
rejects an invented move, and checks the selected blocker is the damaged survivor.
Both cases now follow that exact survivor into the next defender turn and require
zero marked damage and an untapped 2/2. Native v2 and local v1 share the
`textless-creature-block-survival-and-cleanup` family. These receipts do not qualify other textless creatures or
complete the card's support review.

The basic-land reviews use three shared, behavior-oriented families:
`basic-land-main-phase-play-once-per-turn`, `basic-land-colored-mana-use`, and
`basic-land-untap-after-mana-use`. Local v2 covers all three; native v4 covers play
and untap; native colored-payment v2 covers colored mana use. Coverage is the
union of the appropriate probes, not a claim that every probe demonstrates all
three. The native color controls test one wrong color per matching color, not the
full wrong-color matrix. Printed-card admission still requires each declared
family for both controllers; no schema exception is made for basic lands.

The Cartouche probes deliberately name different decision families: the native
test does not prove trigger ordering, and stopping at recast does not prove its
resolution. Neither probe asserts an attachment edge absent from the public view.
The aftermath probes do not qualify Farm, untested recovery populations,
or strategic discard quality. Engine hands remain hidden; bot assertions use public
zone transitions and hand counts. Printing IDs identify the subject, not proof of
every face or ability on that printing.
The Crasher families also differ: the engine probe observes an exert trigger and
skipped untap, but does not inspect its hidden target choice or prove the resulting
block restriction. Neither probe qualifies other exert abilities.
It also runs unrelated green tests and verifies that missing snapshot usage prevents
receipt creation. Run it with:

```sh
MTG_REQUIRE_FORGE_BRIDGE=1 npx vitest run packages/ui/test/tools/printed-probe-run.integration.test.ts
```

That regression enters through `printedProbeMain` and deletes its temporary evidence
after checking it. The command and regression share the thirty-eight probe definitions in
`packages/ui/data/akh-hou-probes-v1.json`. For retained evidence, run:

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts \
  --config packages/ui/data/akh-hou-probes-v1.json \
  --out /absolute/path/to/new-evidence-directory \
  --timeout-ms 300000
```

The output directory must not exist; its parent must exist. Configuration, output,
and deadline are required, with no default execution on missing arguments. The
deadline is bounded to 1–600 seconds and applies to the supervised test subprocess.
Unknown or repeated options fail. `--help` alone performs no execution.
The aggregate deadline applies to this cohort's 74 game assertions; individual
interaction test deadlines are unchanged.

The seven additional textless creatures form a separate bounded cohort:
`packages/ui/data/akh-hou-textless-probes-v1.json`, twenty-eight probes/assertions for
local and native casting/unblocked attacks and blocking/survival/damage cleanup.
Each printing runs its own game for each controller and family. Use that config with the same CLI
and a fresh output directory (`--timeout-ms 180000`). Its regression is
`packages/ui/test/tools/printed-textless-probe-run.integration.test.ts` with
`MTG_REQUIRE_FORGE_BRIDGE=1`. Both configurations are required to cover the current
probe inventory; the first does not silently include the second. The receipt
ledger can combine cohorts only when their complete runtime subjects match.
In particular, adding the seven names to the adapter and Java probe allowlists
changed both identities, so older historical receipts cannot qualify this runtime.
These probes do not constitute full-card qualification. The seven creatures'
lethal combat paths have a separate bounded configuration,
`packages/ui/data/akh-hou-textless-lethal-probes-v1.json` (14 probes/assertions).
Use the same CLI and a fresh output directory with `--timeout-ms 180000`.
This cohort observes each local/native specimen attacking into a local Colossapede,
then checks exact public graveyard transitions, the surviving blocker's marked
damage (or the mirror trade), and damage from other unblocked attackers. It does
not claim the bot chose a lethal block, expose an intermediate state before
state-based death, or automatically review the full cards. All three configs
are required for the current inventory, with identical runtime subjects before
combining evidence.

Search and token probes retain separate local and engine families. The bot search
test does not prove every local selection/decline branch. The combined bot token
probe names both cards and both exact assertions, but does not qualify lifelink or
double-strike combat on those tokens. Fixture cards such as the Desert in a Shefet
search do not gain full-card approval through their presence in a test.

The configuration's workspace resolves relative to its own file; format/catalog
paths and probe test paths resolve relative to that workspace. These are trusted
local inputs naming executable tests, not a network-facing upload format. A
successful command prints its measured subject, receipt count, and `unproven`
qualification. Failures return nonzero and retain available diagnostics. Neither
outcome rewrites card reviews, installs admission, or restarts a service.

All returned runs remain `qualification: 'unproven'`. Receipts neither mark a card's
review complete nor qualify the whole format. Binding Mummy's token-entry and artifact
target variants, other cards and interactions, full match coverage, and production
admission wiring still need their own evidence. Existing AKH/HOU play gating remains.

## Admission-to-runtime loader

`packages/ui/tools/admitted-printed-backend.ts` supplies the Node-only launch seam.
Evidence verification lives in the explicit `@mtg/printed-card/node` entrypoint;
the portable schema root stays browser-safe, and UI tooling does not import the
card database package. A browser bundle regression checks that separation.
Its caller supplies trusted local runtime inputs, the pinned format/catalogs, and
an admission manifest with a confined evidence reader. No evidence returns an
explicit refusal without loading code. Otherwise it copies the runtime, verifies
all catalog printings and receipts against those measured copies, rechecks the
copies after evidence IO, and imports only the copied adapter. The recipe is
parsed before that IO so changes to the caller's object cannot change the admitted
format after verification.

The returned backend accepts only that printed format and preserves the adapter's
own card/capability refusals. Sessions use the existing isolated-backend owner.
Successful shutdown releases the snapshot; failed shutdown propagates and retains
the files because a child may still need them. Callers must await shutdown before
discarding the service. This is trusted local tooling, not a sandbox against a
malicious adapter or a request-supplied executable path.

The loader tests use synthetic complete receipts to exercise the full 550-printing
verification boundary. They are not compatibility evidence.

`startBackendService` accepts optional trusted local `printedAdmission` inputs and
calls this loader before registering an additional route. Missing configuration
keeps the existing Legacy-only service; refused evidence adds no route and its
reasons appear in the startup message. Malformed evidence fails startup and
releases resources. An admitted format cannot replace the Legacy Cube route.

`formatObservedBackend` presents one backend ID to the gateway while dispatching
support checks and opens by exact format to separate runtime owners. It preserves
child capability refusals, session identities, and each owner's isolated-session
lifecycle. No alternate owner is tried after a refusal. Identity or capability
disagreement fails construction; shutdown visits every distinct owner and reports
all failures. The real HTTP regression uses two deterministic fixture engines and
interleaved moves to verify session ownership, not card compatibility.

The standalone CLI does not yet accept admission paths, the shared service has not
been restarted with evidence, and no play control is enabled. Production activation
still needs complete compatibility evidence and browser-visible runtime status.
