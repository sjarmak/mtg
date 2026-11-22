# Legacy Cube calibration evidence contract

## Current implementation status — September 11, 2026

The local workflow now implements proposal, reserved campaign export, once-only
quality and adjacent-source review, canonical collection, gated adoption, and
active-weight export. Human observations, human transfer context, model judgments,
and competence-qualified bot outcomes remain separate evidence types. Adjacent
decks are not silently adapted into human pick labels.

The compact-prompt OAuth pilot completed seven reviews and retained the baseline.
It establishes that the review pipeline runs, not that its judgments are correct
or that the advisor is independently calibrated. A reproduced mana-accounting
defect was corrected separately with regression tests. No weight revision has
been adopted. Exact-list human validation and a justified held-out improvement
remain absent. The all-policy integration test passes within the default full
run, and every scheduled file is now accounted for. That run found two foil
test assumptions invalidated by a concurrent Limited-view default change;
the compact-specific fixture was made explicit and passes all eleven tests.
Reporting-channel errors remain visible. This is not a single clean final-tree
run; dated results below preserve the full result and focused corrections.

The following sections record the design and implementation sequence. Statements
that work was not yet implemented describe those earlier checkpoints.

## Revised evidence direction — September 10, 2026

The user approved using adjacent Cube human examples and sampled model judgments
to fill gaps. Exact-list human logs are useful but are not a prerequisite for
all calibration. The existing exact-match admission lane remains strict; the
mixed-evidence inventory and replay are implemented, while the provisional
adoption policy described here is not yet implemented.

Keep four evidence origins separate: matched human observations, transferred
human observations, model judgments, and competence-qualified bot results.
For adjacent lists, preserve the original decision and source, record card
overlap and missing package pieces, and state which claim can transfer. Overall
overlap alone cannot establish that a pick or combo transfers. An example
adapted to our list is a derived scenario, not an observed human decision.

Sample offline model review across archetypes, draft stages, uncertain picks,
and disagreements. Hide candidate identities and scores, counterbalance answer
order, and reserve source/session-separated holdouts before tuning. Repeated
model agreement must not be counted as independent human confirmation.

Mixed evidence may justify a reversible, explicitly provisional local
calibration; it must not be labeled exact-list human validation. Its adoption
contract still needs implementation and tests. Observable-only inputs,
structural explanation checks, interaction competence for bot outcome claims,
and deterministic regression gates remain requirements. Runtime advice remains
local and has no model calls.

Run `npx tsx packages/metrics/tools/legacy-cube-evidence.ts --report mixed` for
the read-only mixed inventory. It preserves original cases and source labels,
reports referenced-name overlap (not whole-Cube overlap), and replays complete
pick transcripts when every required card exists in the pinned catalog.
Unknown environments and malformed transcripts do not replay. Partial examples
remain visible without card substitutions. Transfer context still needs review;
replay agreement alone does not establish transferability. Finished decks are
retained but not assigned quality labels. Model run identity, sampling, and
independence review still need their own artifact contract before adoption.

Seven new tests cover this inventory and executable, including the actual public
example (12/15 names overlap), model/synthetic separation, transcript failures,
split protection, deterministic replay, and deck retention. The combined
mixed/admission/tuning/review-CLI run passes 37 tests; independent read-only
mixed/admission verification passes 23. Focused ESLint passes. No new weight
revision has been applied.

The separately curated `packages/metrics/data/legacy-cube-transfer-decks-v1.json`
preserves the finished white deck from the same
[Overturf article](https://articles.starcitygames.com/magic-the-gathering/select/is-elite-spellbinder-a-first-pick-in-legacy-cube/).
Its 23 spells and 17 Plains form the published 40-card deck. Twenty of the
23 nonbasic names match our catalog; Clarion Spirit, Glorious Protector, and
Glorious Anthem are absent. The mixed audit retains the deck without replacing
those cards or assigning a quality label. It shares the opening example's
tuning session, so it cannot become an independent heldout example. Corpus
SHA-256: `8367753383df7667d3ebb88851709da19fd726935b841da8072ec89348731aa7`.
The article's discussion of its high curve is useful transfer context; the
reported match record is not proof of quality in our environment.

## Decision

The calibration target is a trustworthy learning aid, not a bot win-rate optimizer. Runtime remains local and deterministic. Offline candidate weights may be adopted automatically only after independent held-out evidence and regression checks support the change. A supported no-change verdict is a valid result; missing evidence is not a passing result.

Bot competence is a condition on using match results, not a judgment about an archetype. An unproven interaction cannot count as an archetype loss. Unvalidated paths must remain available for recommendations and exploration, with an explicit label.

Existing OAuth accounts may assist research and critique offline. Model-authored labels are not independent human expert evidence. No new paid services, runtime model calls, commits, pushes, or external publication are authorized by this workflow.

## Architecture boundary

`@mtg/draft-export` owns card metadata, observable draft memory, path assessment, and pick explanations. The calibration package consumes that evaluator and the existing printed-card catalog. Forge remains an external process; its probe evidence qualifies the use of games, not the static metadata.

The first calibration interface is `advisor/weights.ts`: schema version 1, a revision label, and ten bounded scoring multipliers. Each defaults to one, preserving the authored evaluator. The interface changes card-quality, support, missing-piece, synergy, structure, mana-risk, dependency, commitment, flexibility, and fixing contributions. It does not alter observed facts, package definitions, signal inference, or structural need counts. All coefficients are included in each `DraftAdvice` and each offline draft result; the revision string alone is not an identity check. Parsing copies and freezes the coefficients.

`draftCalibrationPool` accepts candidate weights while retaining the fixed printed-curve opponent policy. Identical choices yield identical opponent pools. Different candidate picks can legitimately change what opponents receive; the implementation must not mistake that draft consequence for a change in opponent policy. Match comparisons continue to require fixed comparison decks and paired game seeds.

## Admission and independence

### Proposal-stage design

The offline search enumerates the baseline and a bounded single-coefficient
neighborhood, not an unbounded optimizer. Candidate order and tie-breaking are
fixed; the baseline wins equal agreement. This follows the reproducible
enumeration pattern documented by [ParameterGrid](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.ParameterGrid.html).
The existing TypeScript evaluator and Zod boundary are sufficient; no machine
learning library or model dependency is needed for this arithmetic.

The tuning entry point refuses a corpus containing any holdout entry, even an
entry that would be excluded. Each admitted pick is replayed under its labeled
mode without silently substituting another mode. Missing recommendations count
as disagreement. Agreement is averaged within a source/session and then across
sessions so a long transcript does not become many independent votes. Deck
membership alone has no quality label and is reported as unscored here.

A selected candidate is only a proposal. Pick agreement does not establish
castability, coherent final decks, explanation truth, exploration preservation,
or competent gameplay. Independent held-out review of those dimensions and the
regression gate must still precede adoption. Empty tuning data returns an
explicit evidence gap, not a supported no-change verdict. This design pass is
followed by test-first implementation under `mtg-6yfe`.

A source must identify its author, URL, date, draft/session group, environment, and the exact passage or frame supporting each label. Deck membership is checked against the pinned catalog, including front/back names; basic lands are separate deck resources. A pack needs all its cards, and a mid-draft situation needs the observations supporting its claims. A future deck or result cannot become evidence available at an earlier pick.

All situations from one source/session stay in one split. Multiple labels on one pack are not multiple independent samples. Held-out results cannot be repeatedly used to choose the next candidate and still be called held out. Candidate proposals use tuning data; adoption uses a frozen, versioned holdout. Changes to benchmark labels or membership invalidate the prior comparison.

Transfer examples, incomplete transcripts, model-authored cases, and modified historical decks remain useful regression material, but must be reported separately from independent expert validation. Replacing absent cards does not preserve the original author's judgment about the revised state.

The adoption comparison must establish coherent and castable decks, explanations supported by observable evidence, and preservation of viable strategic paths. Bot win rate alone cannot satisfy these requirements. Missing competent games cannot establish improvement or degradation. Insufficient independent evidence keeps the current weights and states the evidence gap.

## Frozen review

The held-out comparison is now implemented, separately from search, in
`holdout.ts`, `review-ledger.ts`, and `review-run.ts`. It is a diagnostic
comparison, not an adoption gate. The design and implementation received
separate read-only reviews. The separation follows the [scikit-learn evaluation guidance](https://scikit-learn.org/stable/modules/cross_validation.html):
tuning repeatedly against a test set leaks its labels into model selection.

A sealed proposal must record the complete baseline and selected weights,
the tuning corpus identity, all tuning source/session identities (including
excluded records), and catalog, model, source, runtime, and stage versions.
Sealing occurs before the review process receives holdout labels. A content
digest detects artifact changes; it does not authenticate the curator or prove
that a person has never inspected the holdout. The source manifest now pins
the proposal/review executables, dependency lockfile, printed-card parser,
and evaluator/calibration libraries by sorted path and SHA-256. Its digest
replaces the earlier library-only identity, invalidating earlier seals.

Review parses the sealed artifact and compares exactly its two arms on the
same holdout cases. It must not call the candidate generator or select a new
candidate. It checks normalized source URLs and session groups across both
corpora, not just within each corpus, and refuses overlap even when a record
would otherwise be excluded. A frozen benchmark containing excluded cases is
reported as invalid for review rather than silently changing its population.
Empty or deck-only evidence is insufficient for a pick-preference comparison.

The local review ledger must reserve holdout source/session identities before
evaluation with an exclusive, crash-visible write. A failed or interrupted
review cannot silently make exposed evidence fresh again. A changed corpus
hash, URL tracking parameter, subset, or session label cannot bypass a reused
source identity. Reopening an identical recorded result is a replay of that
result, not another independent validation. Concurrent attempts must have at
most one successful reservation; the ledger is a local workflow safeguard,
not protection against an operator deleting it or falsifying source metadata.

Pick comparisons retain per-case choices and reasons and paired per-session
agreement differences. Uncertainty is calculated over independent sessions,
not the number of picks. A small positive point estimate alone cannot justify
adoption. The current evidence schema cannot label coherent deck quality or
strategic explanation truth: forty legal cards are not a quality judgment,
and machine-readable reasons are not necessarily sound reasoning. Observable
card references and unchanged path availability can supply structural
regression checks, but those checks must retain their narrower names.

Adoption therefore needs separately measured deck-quality, explanation-truth,
and exploration evidence, plus current regression results. Eligible matched
bot games can supplement these measurements, never replace them. Missing
competence is missing evidence, not a loss. Until those measurements and their
provenance are implemented, a successful held-out pick comparison must remain
diagnostic and leave the authored weights untouched.

The pure API `sealTuningProposal` copies and freezes a selected tuning result's
weights and source identities; it refuses an insufficient-evidence result.
`reviewHeldOutPicks` validates its digest and current catalog/model/runtime,
rejects overlapping or excluded evidence, and replays only baseline and selected
weights. It preserves choices, reasons, and paired session differences, with a
conservative two-sided 95% Hoeffding interval over differences bounded in
[-1, 1]. One session has no interval. It does not select a replacement candidate
even if the frozen candidate disagrees with held-out preferences.

`runHeldOutPickReview` is the local filesystem boundary. It snapshots input
artifacts and the catalog before async work, validates before reserving, then
reserves the holdout before either arm is evaluated. An exclusive directory
lock serializes journal admission. A single reservation journal records all
source/session identities; a partial or corrupt journal blocks subsequent
review rather than leaving an incomplete set of claims. Results use exclusive
writes. Interrupted locks are not automatically removed. An empty or deck-only
comparison returns insufficient evidence without reserving or writing a result.
The offline CLI now exposes sealing and review. No UI adoption integration is present yet.

The initial 20-test review (seven holdout, five journal, eight tuning cases)
passed independently. Native V8 measurement reached 23/23 functions and 47/53
blocks for frozen review, 6/6 and 9/10 for orchestration, and 10/10 and 20/22 for
the ledger (88.7%, 90%, and 90.9% block coverage). These are executed JavaScript
counts, not source-mapped TypeScript line coverage. Temporary coverage hooks
were removed. Typecheck and lint passed for these modules. The full workspace
run began before these additions and is diagnostic, not final verification of
the new stage; its reference-seed case timed out while the exhaustive DSL
calibration passed. No authored weights have changed.

A subsequent focused run passes 36 tests: eight frozen-review cases, five ledger
cases, eight tuning cases, and fifteen admission cases. Added negative tests
verify a genuinely changed candidate can lose held-out agreement without
triggering another search, and correctly sealed but stale catalog/model
identities are rejected. The real proposal CLI still reports zero admitted
independent sessions and `insufficient-evidence`.

## Source audit, September 10, 2026

The authoritative application artifact is `legacy-cube-2021-card-catalog-v1.json`, containing 600 cards and content SHA-256 `65e32dd53edc2583c555ccf6922406229a2f6056ad21862370365b329bf5367c`. Its upstream Full Cardlist says last updated August 19, 2021. Dates alone do not establish identical environments.

### Overturf, May 19, 2021

[Is Elite Spellbinder A First Pick In Legacy Cube?](https://articles.starcitygames.com/magic-the-gathering/select/is-elite-spellbinder-a-first-pick-in-legacy-cube/) contains a complete first pack and a finished mono-white deck. Card names in the pack were recovered from the article's image alt text, not inferred from prose.

The first pack is ineligible: Liliana's Triumph, Meloku the Clouded Mirror, and Prismatic Lens are absent from the pinned catalog. The deck is also ineligible: Clarion Spirit, Glorious Protector, and Glorious Anthem are absent. Double-faced front names resolve without substituting cards. The author's flexible-pick preference specifically names an absent card, so even that ranking cannot be replayed unchanged. The retrospective discussion must not leak into P1P1 evidence. These are exclusion findings, not benchmark wins or losses.

### Overturf, August 25, 2021

[Everything I Know About Legacy Cube's Return To Magic Online](https://articles.starcitygames.com/magic-the-gathering/select/everything-i-know-about-legacy-cubes-return-to-magic-online-2/) is useful curator-era context, not a full draft transcript. Its account of removing Oko disagrees with Oko's presence in the application's pinned Full Cardlist. Do not use its date to certify identical membership or silently remove Oko from the application.

### Lowe, August 13, 2019

[Gen Con 2019 Legacy Cube Tournament Report](https://www.quietspeculation.com/2019/08/gen-con-2019-legacy-cube-tournament-report/) describes a 75-card-per-player draft, including different review rules. It is not an exact example of the application's 45-pick environment. Its strategic discussion can inform separate transfer tests, but its draft decisions are not admitted as matched-format holdout evidence.

### Davis, January 5, 2021

[What Does A Good Vintage Cube Draft Deck Look Like?](https://www.coolstuffinc.com/a/jimdavis-01052021-what-does-a-good-vintage-cube-draft-deck-look-like) is a Vintage Cube source despite one deck being described informally as a Legacy Cube-style Twin deck. Its listed Library of Alexandria and Izzet Signet are a format mismatch. It is not Legacy Cube evidence.

## Current verification boundary

A further bounded source search found [Kenji Egashira's 2015 Legacy Cube Sealed article](https://www.coolstuffinc.com/a/kenjiegashira-090715-drafting-with-numot-legacy-cube-sealed), which supplies two complete 40-card lists. Neither matches this catalog: the first contains eight absent cards and the second four. They also describe sealed pools, not observed draft decisions. The date-matched [Numot September 2021 video](https://www.youtube.com/watch?v=PvbFccjqOu0) and [Gaby Spartz Legacy Cube video](https://www.youtube.com/watch?v=A9tHEDkxCB8) did not yield verifiable full packs or decklists through the accessible pages. Video titles and descriptions are not substitutes for those observations. These additional checks did not produce admitted evidence.

The versioned weight seam has test-first coverage for default parity, malformed proposals, immutable result provenance, unchanged observable evidence, and seeded 45-pick replay. The tuning-only proposal stage and frozen pick-review APIs and commands now exist. This does not establish that any new weights are better. No coefficients have been adopted, and the sources audited above do not yet constitute an admitted independent holdout. Multidimensional quality review, automatic adoption, and broader evidence curation remain tracked under `mtg-6yfe`.

The executable source audit is:

```bash
npx tsx packages/metrics/tools/legacy-cube-evidence.ts
npx tsx packages/metrics/tools/legacy-cube-evidence.ts --corpus path/to/corpus.json
```

The separate read-only proposal stage is:

```bash
npx tsx packages/metrics/tools/legacy-cube-propose.ts
npx tsx packages/metrics/tools/legacy-cube-propose.ts --corpus path/to/tuning-only.json
```

It enumerates at most 21 candidates: the baseline and each of ten coefficients
raised or lowered by 0.25, skipping moves outside the existing zero-to-four bounds.
The pure API also accepts a different valid baseline and a finite positive step
no larger than one. It returns every replayed choice, requested-mode gaps,
structured reasons, session-level agreement, exact weights, and corpus/model
identities. The CLI adds the shared source fingerprint and Node version. It
writes nothing by default and cannot install a candidate in the draft UI.

To freeze a sufficiently populated tuning result and compare its two arms:

```bash
npx tsx packages/metrics/tools/legacy-cube-propose.ts --corpus path/to/tuning-only.json --seal-out path/to/sealed.json
npx tsx packages/metrics/tools/legacy-cube-review.ts --proposal path/to/sealed.json --holdout path/to/holdout-only.json --ledger path/to/review-ledger
```

Sealing refuses insufficient evidence and existing output files. The review
command requires all three paths, refuses duplicate/unknown options, reserves
sources before replay, and writes the diagnostic result to its explicit ledger.
Both commands accept regular JSON files only, bounded to 32 MiB; named pipes
are rejected without waiting for a writer. No command fetches source URLs.
The checked-in empty-admission corpus cannot be sealed. A completed comparison
still reports `adoptionEligible: false` and lists the unmeasured quality gates.

Five command/boundary tests pass, including actual subprocess seal/review,
overwrite and holdout-reuse refusal, insufficient evidence, source-manifest
coverage, malformed paths/JSON, oversized files, and named pipes. Together with
tuning and campaign I/O regressions, 15 tests pass. Independent read-only review
also passed its 16-test CLI/ledger/holdout run. Root typecheck and lint pass.

Exit zero means the proposal audit ran, not that calibration passed. On the
checked-in corpus it returns `insufficient-evidence`, an empty comparison list,
and unchanged authored weights. `baseline-retained` means only that the search
found no better tuning agreement; it is not a validated no-change adoption
verdict. `candidate-proposed` similarly requires independent review before use.
Ten test-first cases cover these boundaries, including real-evaluator replay
and the executable; an independent read-only reviewer reran all ten successfully.
Native V8 measurement reaches 6/6 functions and 10/11 blocks in proposal
generation, and 25/26 functions and 46/50 blocks in tuning replay (90.9% and
92.0% block coverage). These are executed JavaScript counts, not source-mapped
TypeScript lines. Temporary coverage hooks were removed. Root typecheck, lint,
the UI build, focused formatting, and 67 admission/export/I/O regression tests
pass after these additions. The subsequent complete workspace run finished with
16,497 tests passing, one reference-seed timeout, 312 skipped, and two reporting
channel timeouts. The reference-seed file passed all five tests in isolation.
This run predates the later CLI, pinned-path, and mixed-evidence additions; it is
diagnostic evidence, not a final green gate for the current tree.

It is read-only and offline. Exit zero means the audit ran successfully, not that any evidence passed. Inspect `admitted`, `excluded`, and the independent-session counts. The checked-in corpus currently reproduces the first-pack exclusion above and admits zero cases. Its SHA-256 identifies the parsed corpus, including labels and source metadata; changing a label changes that identity.

Admission validates the catalog digest, complete observable transcripts using the advisor's existing memory validator, available labeled choices, 40-card singleton decks, and exact card names or face aliases. Basic lands remain separate resources. It rejects source/session overlap between tuning and holdout and does not count model-authored, synthetic, or transfer examples as independent human evidence. URL normalization retains content identifiers while ignoring fragments and common tracking parameters. No URL is fetched by this tool.

Authorship, environment matching, and source locators are curator assertions that still require checking against the source. Passing structural admission is not proof of deck quality, castability, expert consensus, or sufficient statistical power. Pick labels support current-plan, flexible, pivot, and exploration preferences; exploration requires an explicit known archetype ID. Finished decks are membership evidence, not implicit positive quality labels. Replays include an observable structural audit that checks references, timestamps, rosters, and piece counts; it explicitly leaves strategic truth unmeasured.

Bot competence now requires a single matching probe to cover all relevant deck cards jointly for each non-fundamental package. Separate fixtures cannot be unioned into an untested combination. Installed evidence derives its card coverage from the pinned probe's spell and target. This is intentionally conservative and can exclude functional decks. General fundamentals coverage is still limited to the installed basic probe, not proof of every card's behavior. All draft paths and recommendations therefore remain labeled "Not yet bot-validated" without being suppressed.

The source-admission suite passes 15 tests, including the offline executable and its real exclusion corpus. The weight suite passes nine tests. Native V8 measurement of the admission module reaches 43/45 functions and 77/84 blocks (95.6% and 91.7%); this is executed JavaScript coverage, not source-mapped TypeScript line coverage. The temporary `takeCoverage()` test hook was removed after measurement. No coverage dependency was installed.

A fresh opt-in installed-Forge integration run also passes: one test executes four autonomous probes, fundamentals and reanimation at both seeds 42 and 43. It verifies exact initial states and the resulting objectives against the current implementation. This does not refresh the historical full campaign artifact or establish competence for other cards and packages.

### Blinded model sampling (September 10)

The offline sample exporter takes six fixed stages from a seeded 45-pick draft,
covering the opening, late packs, and the final pick. It supplies the public
600-card roster, observed Oracle faces, observation history, and the requested
objective, but not hidden packs, future choices, advisor scores, or preferred
answers. It writes no model calls and refuses to overwrite an output directory:

```bash
npx tsx packages/metrics/tools/legacy-cube-model-sample.ts --seed pilot-v1 --split tuning --policy pin:reanimator --out path/to/new-sample
```

Each task is hashed. Response validation rejects changed tasks, unavailable
choices, unobserved card references, and unknown archetypes. Valid responses
remain explicitly model-origin and not independent human evidence. This checks
structure and references, not the strategic truth of prose. Reversed pack-order
replicas are supported by the task builder; the exporter currently emits the
original order only.

One actual tuning pilot completed through the installed Codex CLI (0.154.0)
using existing ChatGPT OAuth, with API-key environment variables removed,
ephemeral read-only execution, user configuration ignored, and tools disabled.
The response passed the task and reference validator. It considered Thoughtseize,
Buried Alive, Bloodchief's Thirst, and Power Word Kill acceptable for an opening
Reanimator exploration pick, while explicitly treating the lane as speculative.
This is an unordered acceptable set, not a measured ranking or a quality gate.

The local pilot bundle is `/tmp/mtg-model-review-live-Sd1jqb/sample`; task zero
has SHA-256 `48af45c3723a5508a691910f44d47d856c3420af036ce258490cf4ee976934b1`.
The completed CLI thread was `01a08e4a-5fd0-7c50-8903-b40e96ebf8aa`, reporting
24,314 input and 1,492 output tokens. The actual resolved model version was not
reported; this pilot must not enter a version-controlled benchmark as though it
were pinned. Temporary artifacts are not durable evidence storage. A production
runner still needs pinned model provenance, durable response/event artifacts,
counterbalanced repeat sampling, and semantic review. No weights were adopted.

The offline importer now archives completed responses with declared provenance:

```bash
npx tsx packages/metrics/tools/legacy-cube-model-import.ts --task path/to/task.json --response path/to/response.json --provenance path/to/provenance.json --out path/to/new-receipt.json
```

It reconstructs the entire task from the pinned catalog before accepting the
response, including Oracle faces and instructions. Inputs use the shared bounded
regular-file reader; output is exclusive and never overwritten. The strict
provenance object records `provider: "codex-cli"`,
`authentication: "chatgpt-oauth"`, `cliVersion`, nullable `requestedModel` and
`resolvedModel`, `runId`, UTC `completedAt`, and `generatorRuntimeSha256`.
These are operator assertions, not authenticated provider attestations. Even a
named model does not establish strategic truth, independence, or adoption.

The pilot was imported successfully into
`out/legacy-cube-model-pilot-v1/receipt.json`, preserving its full task and answer
outside temporary storage. Receipt SHA-256 is
`eb6156b4d0a8f2527e07dafc48b109de85de00f95d2d86e0fa468e68bdb1ce13`.
Its completion timestamp comes from the response file's modification time, not
a provider attestation. Model names remain null. This local gitignored artifact
is not committed, remotely backed up, or eligible for adoption. Raw CLI event
capture and automatic provider provenance remain work for the runner.

Six import tests cover canonical reconstruction, provenance boundaries,
response binding, immutable input snapshots, actual subprocess import, and
overwrite refusal. The combined import/sample/review-CLI run passes 19 tests;
an independent read-only reviewer passes all 14 import/sample tests. Root
typecheck and focused lint pass after the import addition. The current full
workspace run began before this addition, so its result alone cannot validate
the new importer.

Native V8 coverage of the import module reaches 8/8 functions and 14/15 blocks
(93.3% block coverage). This measures executed JavaScript, not source-mapped
TypeScript lines. The temporary coverage-flush hook was removed afterward; no
coverage dependency was installed.

The latest focused run passes 28 tests across model review, mixed evidence,
review CLI, and heldout review. Those include task isolation, malformed inputs,
blinding, grounded references, and exporter no-overwrite behavior. A read-only
reviewer independently passed the earlier 13-test model/mixed subset.

### Offline model comparison

`model-comparison.ts` compares two explicit weight documents through the same
observable evaluator used for human pick replay. The receipt reader reconstructs
the catalog-bound task and answer and verifies the complete receipt, including
origin, limitations, and digest, before filtering by split. Duplicate tasks are
rejected. Session identity and opening-pack identity cannot cross splits; the
opening-pack check conservatively keeps renamed later observations and divergent
draft trajectories together. This is a within-input check, not a persistent
cross-invocation holdout reservation.

The comparison groups presentation replicas by observed situation and objective,
then averages decisions within sessions and sessions equally. Conflicting model
answers remain separate rows. Agreement is diagnostic, not a deck-quality score,
and every report states `strategicTruth: unmeasured` and `adoptionEligible: false`.
Pinned exploration and unavailable pivot choices retain their actual evaluator
behavior and machine-readable reasons. There is no candidate search in this tool.

Run `node --import tsx packages/metrics/tools/legacy-cube-model-compare.ts` with
required `--receipts` (JSON array), `--split`, `--baseline`, `--candidate`, and
`--out` arguments. Inputs use the existing bounded file reader. Output is
exclusive and records the runtime source fingerprint and Node version. No model
call or draft-time dependency is added.

The actual archived OAuth pilot was compared against the authored baseline and
a candidate with only synergy changed to 1.25. Both chose the same acceptable
card; both observable structural audits passed. This single tuning case provides
no evidence favoring adoption. The local report is
`out/legacy-cube-model-pilot-v1/comparison-v2.json`, runtime fingerprint
`036eaf93c6f7e1523cbb723e61b7b7c6a7c90beae73b2e3a63250d37444a0797`.
It remains model evidence with unreported model version, not human validation.

Nine comparison tests pass, including actual CLI execution, conflicting replicas,
renamed later-pick leakage, receipt tampering, exploration, and unavailable pivots.
An independent read-only reviewer also passed all nine. The preceding six-file
integration run passed 43 tests (before the final exploration test was added).
Root typecheck and lint pass; focused formatting and diff checks pass. Native V8
coverage reports 25/25 functions and 39/40 blocks (97.5%) in the comparison module,
not source-mapped TypeScript line coverage. The temporary flush hook was removed.
The existing full workspace run is still in progress and predates these changes.

### Adjacent human holdout and gap sampling

The user explicitly accepts adjacent Cube evidence and sampled offline model
judgment where exact-list human evidence is unavailable. This relaxes the data
source requirement, not the meaning of validation. Report matched human,
adjacent human, model, and competence-qualified bot results separately; do not
combine their counts into an apparent number of independent human observations.

`packages/metrics/data/legacy-cube-transfer-holdout-decks-v1.json` preserves a
40-card deck from Jim Davis's January 5, 2021
[Vintage Cube article](https://www.coolstuffinc.com/a/jimdavis-01052021-what-does-a-good-vintage-cube-draft-deck-look-like).
Its original cards are unchanged. Nineteen of 27 distinct nonbasic names match
the pinned catalog. The article's rating and record describe its own environment,
not a Legacy Cube outcome. It is a different author/source/session from the
Overturf tuning examples; the entire article is reserved to the holdout source
group. An independent read-only source check confirmed the transcription and
provenance. The mixed audit correctly retains missing cards, leaves deck quality
unmeasured, and does not admit it as matched human evidence. Nine mixed-evidence
tests pass, including the original counts and cross-split source rejection.

The next review protocol should sample gaps by archetype, draft stage, objective,
and failure mode, rather than simply requesting more opinions about easy picks.
Targeted cases include missing enablers versus missing payoffs, mana feasibility,
pivots, and competing reasonable picks. Keep an independently drawn random audit
sample alongside this targeted set: targeted disagreement cases cannot estimate
the prevalence of errors in ordinary drafts. Keep entire draft/source groups in
one split, and freeze prompts, rubrics, candidate weights, and the holdout before
review. Presentation replicas measure sensitivity; they are not new independent
drafts. Models should see observable context without the candidate's scores or
the human answer when providing an independent assessment.

Transfer review needs a contextual judgment about missing enablers, competing
packages, power level, fixing, and draft format. Card-name overlap alone is only
a coverage diagnostic. A model's transfer assessment must itself remain labeled
model judgment. Mechanically check grounded card references, counts, and mana
claims where possible; bot outcomes count only after the relevant interaction
competence probes pass. No single agreement metric substitutes for reviewing
deck coherence, explanation correctness, and useful alternative paths. The
current tools do not yet implement that complete review/adoption protocol.

### Finished-deck model review pilot

The offline deck sampler now drafts a real 45-card pool using an explicit seed,
split, policy, and optional weight document, then uses the shared calibration
deck builder. `legacy-cube-deck-sample.ts` writes an exclusive output directory
containing the catalog/runtime/weight manifest, task, response schema, and blinded
prompt. It makes no model calls. The prompt includes canonical Oracle faces and
the legal 40-card selection, but no policy identity, weights, seed, hidden packs,
opponent pools, or desired answer. Finished-deck context is deliberately separate
from pick-time review: the final pool cannot establish earlier openness.

`deck-review.ts` requests grounded assessments of coherence, castability, and
pool alternatives, including concrete repairs and uncertainty. The existing
model importer dispatches on the task version. `deck-review-evidence.ts`
reconstructs the entire task against the pinned catalog before accepting a
response; altered Oracle text, reports, task hashes, unknown card references,
duplicate criteria, and unexpected provenance fields are rejected. Accepted
receipts remain model evidence, with semantic accuracy unproven and adoption
eligibility false. Physical deck legality does not establish castability.

An actual ChatGPT OAuth review used the tuning sample
`learning-review-pilot-v1`, policy `pin:reanimator`, with tools disabled and an
empty working directory. Its artifacts are in
`out/legacy-cube-deck-review-pilot-v1/`. Task SHA-256 is
`75fe020774010b719358ef470d9c8398f7f02986361fafd19c644c30cd7aef86`;
the imported receipt is
`fb53536f477f246b820a5f3dd9eae9ffdc7db6114c892b0e9ebe951c6a47b458`.
The CLI did not report a resolved model version, so provenance leaves it null.
The review suggested construction alternatives but passed all three criteria.
Those are judgments, not validated outcomes or permission to adopt weights.

The pilot also supplied a concrete counterexample to trusting its verdict: it
claimed Golos's five-color activation was unavailable without additional mana
sources. The selected deck can pay that cost using Scrubland for white, Island
for blue, Swamp for black, Volcanic Island for red, Botanical Sanctum for green,
and two further Swamps for the generic portion. All are distinct selected copies.
This witnesses possibility with untapped lands, not reliable access by a given
turn. `factual-audit.json` preserves the claim and source-grounded correction;
it is explicitly model-assisted inspection, not independent human evidence or
a complete semantic audit. No weight change was adopted.

Six new tests cover canonical context, counts/ownership, task and receipt
tampering, judgment references, provenance, and actual sampler/importer CLI
execution with overwrite refusal. An independent read-only reviewer passed the
deck and existing model import tests. Native V8 coverage of the deck-review
module measured 88.9% functions and 85.7% blocks; its receipt module measured
100% functions and 90% blocks. These are not source-mapped TypeScript line
coverage figures. The temporary coverage flush hook was removed.

The final focused run passed 67 tests across six files, including the deck
review, model evidence/comparison, calibration IO, spelling, and public boundary.
Root typecheck and lint passed. The preceding complete workspace run finished
with 2,155 passing files and one failing file: 16,534 passing tests and three
public-boundary failures, plus two reporting-channel timeouts. The comment
substring and card-name census failures were fixed and the boundary's 40 tests
passed afterward. That rerun does not make the original full run green, and the
full run predates the finished-deck review additions.

The complete adoption loop remains unfinished: explanation/exploration quality
review, qualified reversible adoption, and UI loading of approved weights still
need integration. Model review receipts alone cannot satisfy those conditions.

### Explanation and exploration review pilot

The offline advice sampler now exports actual evaluator output over canonical
observable draft context. Its prompt contains qualitative path assessments,
recommendations, and individually addressable explanation claims, not numeric
weights, hidden packs, or a desired answer. Import reconstructs the task and
checks claim/card/archetype references and provenance. The receipt reader also
rejects forged evidence origins and adoption flags. Structural acceptance still
does not establish semantic accuracy or independent human validation.

An actual tool-disabled ChatGPT OAuth review of P1P8, seed
`explanation-pilot-v1`, policy `pin:reanimator`, is archived at
`out/legacy-cube-advice-review-pilot-v1/`. Task SHA-256 is
`01aeadad222d4a1a120fc4a3c4459723f2e3452006249004a8b1714b36076e5f`;
receipt SHA-256 is
`5dde8f07b73630f392cdae4e4bec96aa09ac1057842458315f246f5a056453b6`.
The reviewer failed both explanation accuracy and exploration usefulness.
The resolved model version was not reported and remains null. The complete
prompt was large: 902 claims and 146,348 reported input tokens. This was one
diagnostic tuning sample, not an accuracy estimate or held-out comparison.

Three findings were verified against the pinned Oracle data and corrected:
Wretched Confluence supplies card advantage; Batterskull supplies a threat via
living weapon; Cryptbreaker supplies repeatable tokens and sacrifice fodder.
Existing discard and equipment assignments remain intact. Two regression tests
failed before these corrections and passed afterward. Confluence is deliberately
not labeled reanimation: its recursion mode returns a creature to hand.
The other findings about Hogaak, equipment carriers, cheap interaction,
openness, and pivot costs remain diagnostic leads, not accepted verdicts.
The archived task describes the prior metadata and is not current-model evidence.

Six advice-review tests cover canonical reconstruction, tampering, qualitative
labels, observable-only context across six stages of a complete draft, receipt
reading, and real CLI export/import with overwrite refusal. A separate native V8
harness exercised 30 policy/stage scenarios and measured 28/28 functions and
69/69 blocks covered in advice-review.ts; these are not TypeScript line coverage.
After the metadata corrections, 53 focused tests in six files passed; independent
read-only verification passed all 12 real-card and metadata tests. The full
workspace run started before the metadata corrections and remained running at
this checkpoint. No weight change was adopted. Paired quality review binding,
reversible local adoption, and UI loading of approved weights remain unfinished.

### Matched quality-review comparisons

`quality-pair.ts` runs baseline and candidate weights with the same draft seed,
policy, fixed opponent policy, and shared deck builder. Each arm produces a real
45-card pool, a physically legal 40-card deck, and canonical advice-review tasks
at picks 0, 7, 15, 29, 37, and 44. Each advice task contains only the observations
available at that stage. Subsequent packs can differ when different picks change
what bots receive; matched seeds do not mean identical later trajectories.

The pair binds the catalog, metadata, runtime, builder, and bot versions. Its
reader regenerates both simulations rather than trusting hashes over supplied
pools or arm labels. `quality-comparison.ts` checks imported receipts against
the exact deck and six advice tasks of each arm and their runtime provenance.
It preserves coherence, castability, pool alternatives, explanation accuracy,
and exploration usefulness separately, with pass/fail/uncertain counts and
paired transitions. The report reader regenerates those counts and rejects
edited summaries. Review rationale and uncertainty remain attached.

Unchanged prompt payloads with different judgments are explicitly marked
`discordantUnchanged`: reviewer inconsistency is not a weight improvement.
Six observations from one draft are not six independent drafts. These modules
are comparison prerequisites, not a completed adoption gate: they do not reserve
holdout use, aggregate independent sessions, qualify gameplay, or install weights.
Model quality judgments remain fallible and are not independent human evidence.

Five TDD tests cover matched runs, complete stage ownership, canonical readers,
runtime and split tampering, missing/swapped/forged receipts, substantive criteria,
uncertainty, and the identical-subject confound. The final focused run passed
61 tests across quality pairs, advice review, deck review, spelling, and public
boundary. Root typecheck, lint, focused formatting, and diff whitespace checks
passed. Independent read-only verification also passed the pair tests. A native
V8 harness exercised five policy pairs with synthetic judgments. A final run after
the report reader was added covered 11/11 functions and 17/17 blocks in quality-pair,
and 22/22 functions and 31/31 blocks in quality-comparison. These are native V8
figures, not TypeScript line coverage; the synthetic judgments provide no strategic
calibration evidence. The workspace
suite begun before these modules was still running at this checkpoint.

### Frozen review campaigns and seed-level summaries

`quality-ledger.ts` freezes the baseline/candidate weights, catalog/model/runtime
fingerprints, draft and builder versions, seed/policy matrix, and five review
criteria before generating subjects. Its local journal consumes the actual
derived draft seeds. Changing policy, weights, or campaign grouping cannot reuse
them. It snapshots caller inputs before asynchronous IO, uses exclusive creation
and a directory lock, and refuses corrupt journals or interrupted locks. No
human-source URL is invented for a simulated draft. Historical runtime fingerprints
do not erase previously consumed seeds. This safeguard requires the operator to
retain the same ledger; deleting or replacing it defeats local history.

`quality-summary.ts` reconstructs every pair and receipt against that frozen
campaign and requires the complete matrix. For each criterion it averages stages
within a policy, policies within a draft seed, then seeds. Six reviewed picks and
two policies over one seed still count as one independent session. Uncertainty or
conflicting judgments of an unchanged subject leave the session unresolved; the
report does not drop those units or present their differences as measured gains.
The summaries keep model provenance separate from independent human evidence.

Six new ledger tests and two new summary tests followed RED → GREEN. Independent
read-only verification passed both files (13 tests). The focused integration and
review run passed 30 tests across five files; after removing a redundant second
simulation from summary validation, the final boundary/spelling/review run passed
57 tests across four files. Root typecheck and lint passed; after the small
refactor, root typecheck, focused lint, and diff whitespace checks passed again.
A direct native V8 harness over the final code covered 16/16 functions and 20/23
blocks in quality-ledger, and 27/27 functions and 41/41 blocks in quality-summary.
These are native function/block figures, not TypeScript line coverage. Artifacts
are in `/tmp/mtg-quality-ledger-coverage-uGtVKP` (direct harness PID 2670127).
These are contract tests with explicitly synthetic review labels, not evidence
of strategic improvement.

At that checkpoint these APIs were not yet wired to a reserved campaign exporter,
an adoption decision, or the UI's weight loader. They do not claim confidence intervals or adoption
authority. Reversible adoption and a realistic end-to-end calibration run remain
unfinished.

The earlier full suite has now terminated with exit 1: 2,157 files passed, three
failed, 89 skipped; 16,564 tests passed, four failed, 312 skipped; four reporting
channel timeouts. The final failure detail was truncated, so the cache (which also
retains historical failures) cannot conclusively identify all failures. Current
real-card advisor, model-comparison, and reference-seed files pass a single-worker
rerun together (23 tests). This does not turn that full run green or establish its
failure causes. No full workspace run is currently active.

### Reserved task bundles and collection

`quality-bundle.ts` now exports the reserved campaign and canonical paired draft
subjects, with deduplicated, hash-addressed prompts and response schemas. The
offline CLI is `packages/metrics/tools/legacy-cube-quality.ts`:

```sh
node --import tsx packages/metrics/tools/legacy-cube-quality.ts export --request request.json --ledger ledger --out fresh-bundle
node --import tsx packages/metrics/tools/legacy-cube-quality.ts collect --bundle fresh-bundle --ledger ledger --receipts receipts --out fresh-report
```

Requests carry the current runtime fingerprint and frozen campaign configuration.
Models receive only each task's `prompt.txt`, not arm labels or calibration weights.
Canonical review receipts are supplied separately as `<task-sha256>.json`; these
commands themselves make no model calls. Export consumes the reservation before
writing tasks and writes the manifest last. Failed exports do not release seeds.

Collection reconstructs the campaign, draft pairs, tasks, and review comparisons;
it requires the original reservation, exact task directories, intact prompts,
task JSON, and response schemas. A read-only review found that canonical receipts
alone previously allowed altered exported prompts; a failing regression test
reproduced that defect before the integrity checks were added. The bounded regular
file reader now supports text as well as JSON for this check.

The first valid collection claims its report hash in the same local ledger before
writing output. Identical recollection is reproducible; replacement reviews cannot
change that campaign's collected result. This does not prove that an operator did
not select reviews before first collection, and deleting the ledger defeats its
local history. Those limits remain explicit rather than being called independent
validation.

Nine bundle tests and five existing review CLI tests pass, including actual CLI
export/collection, stale runtime refusal, missing/modified artifacts, reservation
retention on failure, and frozen review sets. Both discovered integrity defects
followed RED → GREEN. All supplied judgments in these tests are explicitly
synthetic: this validates the workflow, not recommendation quality. Automatic
weight adoption, the UI weight loader, and a substantive end-to-end calibration
campaign remain unfinished; collection still reports adoption ineligible.

Root typecheck, lint, focused formatting, and diff whitespace checks pass. The
independent reviewer passed the original eight bundle tests and found no further
concrete correctness issue. Native V8 instrumentation pushed the combined
three-collection test past its unchanged five-second limit on a quiet machine.
Splitting identical recollection and replacement rejection into separate tests
preserved both assertions and brought all nine instrumented bundle tests within
that budget. This checkpoint does not supersede the failed full workspace run
reported above.

### Provisional held-out quality gate

Collection now evaluates its canonically reconstructed summary through
`quality-gate.ts`. It reports coherence, castability, pool alternatives,
explanation accuracy, and exploration usefulness separately. Draft seeds are the
independent units; extra policies or snapshots do not increase the sample size.
The one-sided Hoeffding lower bound for each paired mean is
`mean - sqrt(2 * log(5 / 0.05) / seeds)`, clipped at -1. The five simultaneous
bounds use a Bonferroni allocation of the family error rate.

The provisional gate requires held-out observations, at least two distinct seeds,
all candidate judgments passing, no unresolved judgments or inconsistent reviews,
and a positive lower bound for at least one criterion. Otherwise its result is
`retain-baseline` with machine-readable reasons. Passing is only
`quality-supported`, never adoption authority: model bias is not bounded, random
independent seeds are assumed, and observing no candidate failures is not proof
of population noninferiority. Transfer-context review, a sampling/reviewer audit,
regression gates, qualified bot evidence where used, and reversible installation
remain prerequisites for final adoption.

Six new arithmetic tests plus the paired-summary and bundle tests pass: 22 tests
in total, also actively rerun by an independent reviewer. Synthetic judgments in
these tests validate the implementation, not strategic quality. A direct native
V8 coverage harness exercised 19/19 functions and 48/48 blocks in the gate; these
are V8 counters, not TypeScript line coverage. Root typecheck, lint, focused
formatting, and diff whitespace checks pass. A new full workspace test run is in
progress, with its complete output retained at
`/tmp/mtg-calibration-workspace-gates-inFIsi/npm-test.log`; no full green result is
claimed at this checkpoint.

### Adjacent-evidence transfer review

`transfer-review.ts` now builds review tasks from the existing mixed-evidence
audit. Each task retains the complete original human case, absent-card list,
source and split, and the pinned catalog's Oracle faces. It requests separate
model-authored lessons marked transferable, conditional, not-transferable, or
uncertain, with source and Cube card references kept separate. Conditional lessons
must name conditions. Instructions explicitly prohibit reconstructing unseen
packs or carrying finished-deck win rates across environments.

The existing evidence CLI exposes `--report transfer-tasks`, including a response
schema. The existing model-import CLI accepts those tasks with an additional
required `--corpus` argument. Import rebuilds the task from that source corpus and
the pinned catalog rather than trusting self-hashed Oracle data. Receipts preserve
the existing OAuth provenance schema, explicitly operator-asserted provenance,
model origin, and uncertainty. They confer no adoption authority or independent
human validation. Neither command invokes a model.

Seven new tests cover task construction, source/split preservation, malformed
judgments, fabricated/rehashed task refusal, provenance, and real CLI export and
import. Together with mixed-evidence and existing model-evidence tests, 22 tests
pass and were independently rerun. These use synthetic judgment labels, not
substantive transfer conclusions. Root typecheck, scoped lint, formatting, and
diff whitespace checks pass. The earlier full workspace run started before these
new files; it is not verification of this addition.

An actual OAuth-backed transfer review now exists at
`out/legacy-cube-transfer-review-vxk3L5/` (local, not committed). It preserves the
export, task, prompt, response schema, event log, raw response, provenance, and
canonical imported receipt. Codex CLI 0.154.0 reused ChatGPT login with API-key
variables removed, user configuration and rules ignored, a fresh read-only
directory, and tools disabled. The event log contains only an agent message and
successful completion, with no tool execution. The run reported 106,843 input
tokens and 2,826 output tokens. No resolved model version was reported: this is
an unpinned pilot, not a production-pinned reviewer or independent validation.
Receipt SHA-256:
`71cdfd2af51a22a2b253011be66eb9ff65e1799977075b9de162f0f0e73fb8b6`.

The review returned eight lessons: two transferable, five conditional, and one
not-transferable. Useful checks against the supplied Oracle faces confirmed
Spellseeker's instant/sorcery restriction, Agadeem's nine-mana requirement for a
six-mana target, and Lingering Souls' potential discard, crew, and sacrifice
connections. These checks support those narrow mechanical statements, not every
strategic judgment in the response. The original eight absent cards remain
absent; neither the published result nor model interpretation becomes an
exact-list human endorsement. The source has now been exposed for review and
must not later be described as an untouched holdout for tuning these lessons.
No weight revision was adopted.

The latest full workspace run ended with 2,158 passed, six failed, and 89 skipped
files: 16,589 passed, seven failed, and 312 skipped tests, plus five reporting
channel errors. All 30 tests across five affected files passed a single-worker
rerun, including the browser target-closed failure. The remaining exhaustive DSL
calibration rerun also passed both tests in 337.35 seconds. These reruns do not
turn the full run green.

### Reversible local weight storage

`weight-store.ts` implements the installation mechanism, not adoption policy.
Its install path is now exposed only through the evidence-checking `quality adopt`
command; rollback remains a library operation. Each transition records exact weights, catalog/model identity,
its parent digest, and the decision digest. That digest is provenance only and
does not certify the decision. Rollback restores a previous sequence (zero is
the authored baseline) by appending a transition, leaving every earlier record
intact. A stale starting head or concurrent writer is refused.

Readers validate the entire contiguous history and expose `transitionPending`
when a live or interrupted lock was present in their directory snapshot. They
do not guess whether the writer died. Publication uses a synced temporary file
inside the exclusive lock and a same-filesystem exclusive hard link; readers
never receive partly written JSON. An IO failure after publication starts keeps
the lock for inspection. This is a local workflow safeguard, not protection
against an operator deleting or rewriting the journal, and not a promise about
filesystem behavior across power loss. The implementation reuses Node filesystem
primitives rather than adding `write-file-atomic`, whose replace-in-place purpose
does not provide this append-only journal contract.

Six test-first cases cover installation, rollback and restoration, concurrency,
stale writes, input snapshots and validation, damaged/missing history, catalog
drift, outstanding locks, and pending-file isolation. The combined storage and
quality-ledger run passes 12 tests. An independent review requested visible lock
state; that correction was reproduced red and verified green. A direct native V8
harness reached 11/11 functions and 41/41 reported blocks, not TypeScript line
coverage. No installed weight revision or UI calibration behavior changed.

### Evidence-checked provisional adoption

`legacy-cube-quality.ts adopt` reconstructs the reserved campaign and review
receipts rather than accepting an edited report or a caller's passed flag.
Adjacent human examples remain context-only, with their original source splits
recorded. They are not relabeled as exact-list held-out validation. Missing
quality or transfer reviews retain the baseline; malformed evidence is refused.
Adoption requires held-out quality support, all exploration policies, consistent
requested reviewer models, current catalog/model/runtime identity, and a baseline
matching the local journal. It runs fixed typecheck, lint, formatting, full-test,
and UI-build commands before a reversible provisional installation. Each command
archives bounded output and its digest. POSIX process groups ensure that a timeout
does not leave npm's children running. Timeout, output overflow, spawn failure,
and cleanup failure remain failed evidence even if the wrapper exits zero.

The canonical CLI integration and orchestration suites pass 21 tests together;
two subsequent boundary tests also pass (seven regression-runner tests total).
Root typecheck passes. Independent read-only reviews checked the evidence/context
separation and subprocess boundary. Positive adoption tests use synthetic review
fixtures and are software tests, not evidence of strategic improvement. No
nondefault weights have been adopted. The fully automated model-review campaign
remains unfinished; portable UI loading is described below.

The subsequent full workspace run reports 2,166 passed and 89 skipped files,
16,609 passed and 312 skipped tests, and no failed assertions. Two worker-reporting
timeouts were printed; the repository's reporting-channel classifier returned
exit zero. This run predates the final subprocess correction, whose focused tests
and typecheck were run afterward. The reporting errors remain a caveat, not
evidence about Legacy Cube recommendation quality.

### Portable calibration and draft UI

The quality CLI now exposes `snapshot --store <dir> --decision <file> --out <file>`.
It checks the active journal, its linked adoption decision, current catalog/model
and runtime fingerprints, and pending transitions before exclusively writing a
portable calibration document. The browser imports its schema from draft-export,
not the Node-only metrics package. Checksums detect modification, not an operator
forging both the journal and decision.

The app optionally reads `legacy-cube-advisor-calibration.json` once per URL and
catalog identity. It validates the document checksum and catalog/model identity;
missing files use authored defaults, while invalid files show a failure message
and use those defaults. A catalog change invalidates earlier in-flight results.
The selected weights reach both recommendations and card/path explanations. The
UI names the actual evaluator revision and labels provisional model-reviewed
calibration separately from independent human or bot validation. Drafting remains
available during loading, and picks do not trigger network or model requests.

Portable/adoption tests pass eight cases, route and advisor suites pass 22, and
loader/hook tests pass four. A real Chrome check passes at 1440, 768, and 375 pixel
widths, including keyboard picks, touch advice, pinning, and calibration labels.
These positive snapshots are synthetic software fixtures, not adopted weights or
evidence of improved drafting. Root typecheck, scoped ESLint, and the UI production
build pass; the build reports large-chunk warnings. A separate read-only review
found no concrete issue in the loading or evaluator wiring.

Automatic staging and rollback refresh are not connected yet. An already served
snapshot does not follow the local journal automatically, and the browser does
not check the source runtime fingerprint against a running server. Export checks
that fingerprint at creation time only. Reloading is required to read a new file;
do not treat this portable export as completed end-to-end automatic adoption.

### Once-only automated review execution

`runQualityReviews` validates the complete reserved bundle before exposing its
canonical, deduplicated prompts to an injected offline reviewer. The ledger fixes
the review directory by campaign digest; changing an output directory cannot
request another sample. Configuration freezes the requested model and runtime.
An explicit call budget must cover all pending tasks before any call starts.

Each task claims an exclusive attempt directory before invoking the reviewer.
Responses are archived before canonical receipt validation and publication.
Failures remain recorded, and an interrupted or failed attempt is not retried
automatically. Resume rechecks completed receipts against the archived responses,
catalog, requested model, and runtime. All incomplete claims are checked before
any previously unstarted task is called. Concurrent invocations cannot claim the
same task twice. These protections are local workflow integrity, not protection
against an operator rewriting the ledger.

Seven test-first runner cases and ten existing bundle cases pass together.
They include uncertain synthetic judgments flowing into the real collector and
retaining the baseline, budget checks, changed receipts/configuration, failure
retention, provenance mismatches, and concurrent task claims. Typecheck and scoped
ESLint pass. The initial five-case implementation received an independent
read-only review with no concrete findings. Native process coverage collection
did not expose the Vitest-loaded module, so this run does not establish a coverage
percentage. No live model was invoked and no weights changed.

The OAuth execution adapter is implemented and connected to the CLI's `run`
command. Its transport has been live-verified, but a complete real review
campaign has not yet run through it. Inspection found that this
machine's PATH `codex` is a wrapper adding integrations; the adapter must invoke
the underlying CLI directly rather than inherit that wrapper. The installed CLI
supports ephemeral, schema-constrained JSONL execution and ignoring user config,
but has no global tool-choice-none option. Accepted reviews must therefore both
disable available tool features and reject any tool-use transcript. ChatGPT-only
authentication, credential-filtered environment, an empty working directory,
bounded subprocess execution, and raw output archival are now implemented. See
the [official noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
for the execution and output contracts.

The adapter's 15 unit tests and five real-subprocess tests pass; together with
the once-only runner, the focused run passes 27 tests. Real subprocess tests
cover input/output, nonzero exits, timeout termination, output overflow, and a
missing executable, without accessing a model or account. Root typecheck and
scoped ESLint pass. An independent read-only review ran the 15 unit tests and
reported no concrete findings. The security-review skill guided explicit OAuth
checks, environment filtering and fail-closed transcript admission; TDD guided
the initial failing tests. Coverage percentage remains unmeasured. No new live
judgments were collected and no calibration weights changed. This is process
and adapter evidence, not evidence of strategic judgment quality or a completed
automated proposal/review/adoption chain.

The subsequent CLI integration adds required `--bundle`, `--ledger`, `--archive`,
`--codex-bin`, `--model`, and `--max-calls` options to `run`. Eight test-first CLI
cases pass, and the five existing review-CLI cases still pass. Other commands
remain model-call-free. Root typecheck, scoped ESLint and formatting pass; an
independent read-only CLI review found no concrete issue.

Two real transport smoke attempts used existing ChatGPT OAuth and explicit
`gpt-5.5`, not API keys. The first returned valid JSON but was correctly rejected
because the CLI emitted an error item warning about the under-development
`skip_host_skill_discovery` feature. The adapter now sets the CLI's
`suppress_unstable_features_warning=true`; its parser still rejects error items.
A failing-then-passing test pins that configuration. The second attempt passed:
run `01a08ef9-bc1c-7683-9346-d63a167ed653`, CLI 0.154.0, response `{"status":"ok"}`,
runtime SHA `b948465cbcb4858e89e11beab3d1fed1bd56d6b9b24343dd2eebfb279bcc65e9`.
The CLI does not report a resolved model version, so provenance leaves it null.
Raw archives are `out/legacy-cube-oauth-adapter-smoke-v1` and `-v2`; neither is
strategic evidence or an adoption input. No weights changed.

### Earlier workspace gate results

Typecheck, ESLint, the UI production build, focused formatting, and `git diff --check` pass. Root formatting still flags two pre-existing changed LLM files, which were preserved. Independent admission/export-boundary verification passes all 55 tests.

The completed root run reports 2,142 passed, six failed, and 89 skipped files (16,482 passed, six failed, and 312 skipped tests), plus five reporting-channel timeouts. All 60 format-health assertions pass. One failure was the card-name census, corrected and verified afterward. All five timeout files pass single-worker reruns: reference seed, reference milestone seed, Legacy Cube staging, the Legacy Cube route, and DSL-coverage calibration. The route's full-run timeout was explicitly classified NOT LOAD; two isolated 45-pick journeys took 2.0 and 2.3 seconds against the unchanged five-second limit. The exhaustive 471-card DSL calibration passes both tests in 341.46 seconds against its unchanged 706.5-second budget. These reruns do not make the original full run green or prove its performance variance resolved. None of these generated-set balance results are evidence about Legacy Cube recommendation quality.

A final focused run passes 91 tests in 11 files: advisor evaluation, metadata,
observation, real-card semantics, weights, human-evidence admission, calibration,
campaign orchestration, installed-adapter behavior, advisor UI, and three full
draft simulations. The installed-adapter tests in that run use fixtures; the
separate opt-in Forge test above is the actual autonomous gameplay check.

### Task-reference schema correction and second live tuning pilot

The first real deck-review campaign was rejected, not admitted: the model
mistyped a physical card ID. Its raw response remains under
`out/legacy-cube-live-quality-ledger/reviews-cad21ad3339ecbe272f3dddae7c2783d9e920e8821ecad57bb99c689804f7b89/attempts/`.
No correction was applied to that response, no replacement was sampled, and its
strategic critique is not accepted calibration evidence.

The model-facing response schema now enumerates the exact task digest and legal
card references; advice schemas additionally enumerate actual claim and path
IDs. Empty reference sets allow only empty arrays. These are structural output
constraints, not semantic judgments. Canonical task reconstruction, duplicate
checks, and receipt admission still run independently after generation. Four
test-first schema cases pass, and the bundle/runner/schema integration run passes
21 tests. Typecheck and focused lint/format pass. Independent read-only review
ran the four schema cases and found no actionable defect.

A new tuning sample reserves index 2 of `live-quality-pipeline-v1`, with unchanged
default weights in both arms. Its seven tasks are in
`out/legacy-cube-live-quality-tuning-v2/bundle`, campaign
`3f367d7c4baa4eb422a2ab2bab524436ec4bc4d81069b1028e338da43dbae76e`,
runtime `28ebadd451de25758aaa80da2fcb99c443a7bacb66a5715a5cd9ad6de7b75b90`.
This pilot tests the corrected pipeline; it is not a weight improvement or
independent human validation.

The preceding full workspace run exited 1: 2,164 passed, 11 failed, and 89 skipped
files; 16,649 passed, 17 failed, and 312 skipped tests; five reporting-channel
errors. Failures include load timeouts and an export-census entry for the CLI
test's literal `Infinity`, which is an invalid numeric input, not a private-world
card reference. The census has been updated. The three quality-review files
passed all 24 tests in an isolated single-worker rerun. Other timeout reruns are
still pending; this full run is not a green result. The two pre-existing LLM-file
formatting failures were corrected with Prettier without changing their logic.

### Adjacent-source automation and completed pilot outcome

The second live tuning pilot accepted five of its seven task receipts, then
the sixth Codex process exited 1 with a context-window exhaustion error. The
seventh task was not called. The failed attempt remains recorded; collection
correctly refuses the missing receipt, so there is no completed campaign report
and no weight adoption. Neither missing review was silently replaced.

`legacy-cube-quality.ts transfer-run` now accepts explicit `--corpus`, `--split`,
`--ledger`, `--archive`, `--codex-bin`, `--model`, and `--max-calls` flags. It
reconstructs adjacent-source tasks from the original corpus and pinned catalog,
then uses the same once-only review IO as deck/advice reviews. Source and cube
card references have separate exact-name schemas. Frozen configuration rejects
model/runtime changes, and resume validates receipts against archived responses.
Interpretations remain model evidence, with `independentHumanEvidence: false`
and `adoptionEligible: false`; overlap does not turn them into matched evidence.

Test-first implementation added five runner cases and two CLI cases. The four
focused transfer/quality runner, CLI, and transfer-review files pass all 29 tests;
independent read-only verification also passed the 12 runner tests. Focused lint
and diff whitespace checks pass. This CLI was exercised with synthetic reviewers
in tests, not a new live transfer model sample.

All outstanding timeout files from the preceding full run subsequently passed
isolated reruns: 42 tests in six files, plus both exhaustive DSL calibration tests
in 348.08 seconds. The census/LLM fixture regression run passed 53 tests. Root
format now passes. These are isolated follow-ups, not a fresh green full suite.

### Mixed proposal to campaign

The quality CLI's `propose` command accepts a tuning `--corpus`, active `--store`,
seed `--root`, comma-separated `--indices`, fresh `--out` directory, and optional
`--model-receipts` JSON array. It writes `proposal.json` plus `request.json`, which
the existing `export --request` command can consume without hand-editing weights
or policies. The generated holdout scope includes current, flexible, pivot, and
all 17 pinned archetypes. No model is invoked during proposal construction.

Coordinate proposals begin at the installed weights. Exact-list human pick
agreement and model pick agreement remain separate diagnostics: higher human
agreement takes precedence; model agreement breaks human ties, and baseline wins
complete ties. With no exact human picks, model tuning judgments can propose a
candidate but cannot authorize adoption. Adjacent finished decks do not acquire
invented pick labels. Any supplied holdout model receipt or holdout human case
is rejected before selection, and model receipt runtime must match the frozen
campaign runtime. These controls do not authenticate human sources or establish
model independence.

The local CLI exercise at `out/legacy-cube-mixed-proposal-pilot-v1` used the actual
adjacent tuning corpus and no model pick receipts. It returned
`insufficient-evidence`, retained default active weights, and wrote the explicit
two-seed holdout request. No draft seeds were reserved and no models were called.
Five proposal tests, one CLI integration test, and ten existing quality CLI tests
pass; root typecheck, focused lint, and diff whitespace checks pass. This is
proposal wiring evidence, not a completed end-to-end calibration campaign.

Independent review reproduced a session-leakage defect: a tuning-labeled model
receipt could name a proposed holdout session. A sixth proposal regression test
failed before the fix. The builder now rejects matching model or human source
session identities before emitting the proposal; arbitrary renamed source
provenance remains unproven and is recorded as a limitation. The historical
local proposal above predates this guard and is not a current-runtime campaign.

### Lossless offline review prompt compaction

The second live tuning pilot accepted five reviews, then exhausted the model's
context window on a 1,552-claim advice task. That failed attempt remains recorded;
it is not retried or counted as a completed campaign. No weights changed.

`quality-prompt.ts` now renders advice using a canonical card-reference dictionary,
exact-text claim dictionary, and claim rows. Remaining reason fields travel in a
details object, preserving explicit null values and future fields. All observations,
Oracle text, paths, and claims remain present; no evidence is sampled away. Models
must still cite canonical physical card IDs and original claim IDs, and receipt
admission and task identities are unchanged. Deck prompts are unchanged.

Six focused tests pass, including exact round trips across all draft stages,
payload reduction on the previously oversized draft, alias collision rejection,
optional-field absence, and additional reason details. Independent read-only
verification also passed all six and found no remaining issue in this scope.
Focused lint passes. A fresh live pilot is still required to establish whether
the smaller representation resolves context exhaustion in practice; lossless
encoding tests alone do not establish model review quality.

### Completed compact-format tuning pilot

The next unused tuning index, 3 under `live-quality-pipeline-v1`, completed all
seven OAuth reviews. Baseline and candidate used identical authored weights.
The largest prompt was 377,817 bytes. Canonical collection verified the reservation
and returned `retain-baseline`; it made no new model calls and changed no weights.

- Bundle: `out/legacy-cube-live-quality-tuning-v3/bundle`
- Campaign: `07465bf10d3b4ea48ec6b987504afcad9f000544f82b26eeca86bd193b63c95e`
- Runtime: `ca565a398318d0d6a32b529f589d468c9b83f294021df7074627e0bebd658460`
- Collected report: `out/legacy-cube-live-quality-tuning-v3/collected/report.json`
- Report hash: `a3762dd5d530bc38d1ff1ec0e9e58a0b4f19e308bda83d5742cc88a4d7d46203`

The model passed the completed deck's coherence, castability, and pool-alternative
criteria. It failed explanation accuracy and exploration usefulness at each of
the six advice checkpoints, citing overbroad archetype support and optimistic
mana/pivot explanations among its concerns. These are model-origin tuning findings
requiring source-level verification, not independent expert labels. This pilot
proves successful review/collection plumbing on this seed; it neither demonstrates
an improved candidate nor supplies a held-out adoption benchmark.

A new integration test, `legacy-cube-quality-pipeline.test.ts`, follows the exact
request emitted by the proposal CLI through export, both review runners, and the
real adoption CLI. Only reviewer callbacks are synthetic. Its first run reached
adoption after recording 279 deduplicated quality receipts across two seeds and
all 20 policies, then timed out at its unchanged 120-second budget. The reporter
measured load 44.7 on 16 cores. That test remains unverified pending an isolated
rerun; read-only review found no definite assertion or wiring defect.

Root lint, format, typecheck, and the UI build passed; the build retains chunk-size
warnings. A fresh full suite is still running. It found an unrecorded ordinary
connection-error literal in the transfer runner test; the public-export census
was updated after inspection and its check now passes. This is not yet a green
full-suite result. Coverage remains unmeasured: neither supported Vitest coverage
provider nor an Istanbul reporting package is installed, and no dependency was
installed during this work.

### Source-verified correction from the tuning pilot

Independent inspection reproduced the optimistic mana label on the saved
midrange review: WB/UB duals satisfied a generic fixer count while G/R demands
went unsupported. Two new real-card regression cases failed before the fix.
Pool assessment now checks actual additional colors for source coverage as well
as the path's existing fixing requirement. A two-color subset of a broad family
does not need all its usual colors. The shortage explanation identifies the
affected cards and explicitly disclaims finished-deck castability validation.

The real-card and evaluator checks passed 32/32 after the correction, including
an independent read-only rerun and reproduction against the original saved pool.
An additional accelerator regression passes as well. This is a directly tested
accounting correction, not adoption of a model's strategic judgment or new
calibration weights. The older pilot remains historical evidence for its recorded
runtime; it must not be reused as a campaign for this changed runtime. Broad
family pivot-cost limitations and other model critiques remain unvalidated.

The full workspace run subsequently finished: 2,178 test files passed, two
failed, and 89 were skipped; 16,690 tests passed, four failed, and 312 were
skipped. Its failures were the earlier census delta and three new mana tests
loaded against cached pre-fix source after edits during the run. Three worker
reporting-channel timeouts were also reported. This is not a clean final-tree
run. A fresh mana/public-boundary/spelling run passed all 57 tests after the
census recorded the ordinary `Comfortable` label and official Darkslick Shores
name. Post-fix root typecheck, focused lint, and whitespace checks pass.

The second full-pipeline test attempt also reached its 120-second limit under
shared load (27.6 on 16 cores, reported as MAYBE LOAD). Its timeout remains a
failure, not a passing pipeline. The next attempt runs after the full suite has
finished, with the same timeout and frozen source.

That isolated attempt passed in 81.82 seconds (82.70 seconds total), without
changing the 120-second budget. It exercised the exact proposal request through
export, canonical quality and transfer receipts, real adoption, and zero-call
resume across two seeds and all 20 policies. The decision retained the baseline
for unresolved synthetic judgments, verified independent seed counting, kept
transfer evidence context-only, and created no active weight store. Synthetic
review callbacks establish software behavior only. The test consumes 68% of
its budget on this machine and is vulnerable to contention; the prior failures
remain recorded. Log: `/tmp/mtg-calibration-current-gates-6hevzw/pipeline-isolated.log`.

This completes the implemented mixed-evidence workflow with a verified no-install
outcome. It does not complete empirical calibration: additional held-out evidence
is needed before a justified provisional weight change. Current-runtime coverage
of the expanded workflow remains unmeasured. No commits, pushes, remote sync,
paid API calls, or weight adoption were performed.

### Authorized coverage-provider measurement

The user approved adding `@vitest/coverage-v8@3.2.7`, matching Vitest.
The expanded instrumented run measured 94.77% lines, 93.39% branches, and
99.56% functions. Calibration source measured 99.59% lines / 94.10% branches;
advisor source 99.76% / 91.73%; the two advisor UI files 100% / 96.37%.
CLI wrappers remain under-covered at 25.89% lines / 74.19% branches.
Several zero-reported wrappers do have subprocess integration assertions:
advice export/import, model import/comparison/sampling, and evidence export.
Those child processes are not included in this V8 measurement. Their tests
check real emitted artifacts and failure handling, but that is not a substitute
for measuring their source coverage. The deck-sampling and calibration entry
wrappers still need a separate coverage audit.
These figures are not a passing gate: 340 tests passed and eight timed out
across four files. `reportOnFailure` includes code exercised by failing tests.
The attempted CLI exclusion did not exclude the full pipeline test; it exceeded
its unchanged 120-second budget under instrumentation. No timeout was raised.

Evidence: `/tmp/mtg-calibration-v8-R4Q0bb/run.log` and
`/tmp/mtg-calibration-v8-R4Q0bb/report/coverage-summary.json`.
The checkout temporarily became unavailable during the uninstrumented rerun;
only the route file had reported success (13 tests) before interruption.
The checkout and installed provider were checked again on resumption. This
removes the missing-provider blocker, not the remaining verification work.

After restoration, the three interrupted diagnostic files passed all 29 tests
without instrumentation or timeout changes. Root typecheck, lint, format, and
the UI production build also passed; the build retains its chunk-size warning.
Logs share the same directory with the `restored-` prefix. The full suite was
started separately and is not yet a completed gate at this checkpoint.

That run found a private-name substring in an ordinary word in this note;
rephrasing the sentence made the focused export-boundary check pass. It also
timed out the full calibration integration at 120 seconds. Investigation found
that equal baseline/candidate weights built the identical deterministic draft
twice. A regression test first failed on the duplicate simulation, then passed
after reusing that arm through a deep clone. Changed weights still run both
simulations; output objects remain independent; all canonical checks remain.
The full pair suite passes 9/9 and focused lint passes. Logs: `pair-red.log`,
`pair-green.log`, and `boundary-fixed.log` in the same directory. This does not
yet prove the full pipeline meets its budget. The full suite was already in
flight during this fix and therefore cannot be the final unchanged-tree gate.

That mixed-edit full run finished with 16,693 tests passed, four failed, 312
skipped, and three worker-reporting timeouts. It is not a passing gate. Fresh
focused runs pass the boundary and pair assertions. The optimized full pipeline
then passed alone in 67.56 seconds, keeping its original 120-second budget,
all 20 policies, both seeds, and the real adoption/resume path. Independent
review confirmed identical output hashes before and after the optimization.
This establishes pipeline behavior, not empirical improvement in recommendations.
Logs: `restored-full-suite.log` and `optimized-pipeline.log` in the directory
above. The reference-ledger timeout and a clean coverage run remain to check.

The reference-ledger file subsequently passed all five tests with unchanged
budgets. A fresh one-worker instrumented run passed all 349 tests in 56 files,
enforcing 80% aggregate thresholds: 94.31% lines/statements, 93.43% branches,
and 99.56% functions. Calibration source measured 99.66% lines / 94.07%
branches; advisor source 99.76% / 91.73%; advisor UI 100% / 96.37%.
All CLI wrapper source remained in the denominator (18.38% measured lines);
child-process coverage is still absent. The separately verified full pipeline
was omitted through an explicit test-file list, not a non-working exclusion.
Evidence: `/tmp/mtg-calibration-coverage-clean-IKAb7j/run.log` and its
`report/coverage-summary.json`; reference check: `reference-seed-fresh.log`
in the previous directory. No runtime model call or weight change was made.

The next full run finished with 16,695 tests passed, two timeout failures, 312
skips, and three worker-reporting errors. The calibration pipeline still
exceeded 120 seconds while competing with other projects; the reference-ledger
census again exceeded its 20-second budget under load. This is not a passing
gate. The pipeline now belongs to a final `calibration` project scheduling
group, still included by bare `npm test`, with its exact path excluded from
`unit` to prevent duplicate execution. Other projects remain concurrent and
all test budgets and pipeline assertions remain unchanged. A wiring regression
failed before the change; 37 configuration/browser-roster/load assertions pass
after it, as does independent active review of the installed Vitest scheduler.
Root typecheck, lint, formatting, and production UI build pass after the change
(the existing bundle-size warning remains). Logs: `scheduling-red.log`,
`scheduling-green.log`, and `full-suite.log` in the clean coverage directory.
A new full run is still required to verify the final scheduling arrangement.

That run exited zero with 16,697 tests passed and 312 skipped, but inspection
found that the calibration group never started. Three reporting-channel
rejections ended the earlier pool before the later group could run. The
existing reporter checked collected modules only, so its successful accounting
did not prove completion of the original plan. This is not a complete gate.
The calibration project now runs first, still in isolation and with its
original budget. A final reporter compares every scheduled task identity with
the reported modules and fails if any entire file or group is absent, including
when another reporter has cleared the exit code. Four new tests cover missing
groups, project-distinct identities, watch-run reset, and exit-code preservation.
The focused reporter and project checks pass 61/61. The source of the prior
omission is retained in `scheduled-full-suite.log` in the clean coverage directory.

The fresh accounted run completed every scheduled file: 2,182 files passed,
one failed, and 89 skipped; 16,700 tests passed, two failed, and 312 skipped.
The full calibration integration passed in 99.055 seconds under its unchanged
120-second budget. Two reporting-channel timeouts remained and were not
excused because assertions failed. The scheduled-file guard found no missing
module; its own coverage is 100% across all four metrics, and independent review
confirmed its identities against the installed Vitest implementation.

Both failures were in `sealed-foil.test.ts` and reproduced alone. Concurrent
changes to `DeckPane.ts` and `SealedBuilder.ts` made Limited panes default to
full cards, while the foil tests expected compact strips without selecting
that mode. The production change was preserved. The fixture now explicitly
selects compact for both panes; all eleven tests pass without changing their
assertions. Because other work changed the checkout during the run, this is
full-suite evidence plus a focused correction, not an unchanged-tree green
gate. Full log: `accounted-full-suite.log` in the clean coverage directory.

Final focused follow-up: 123/123 tests across eighteen files pass, including
the foil correction, Legacy Cube routes, advisor simulations, desktop/phone
browser interaction, scheduled-file accounting, spelling, and public boundary.
Root typecheck, lint, formatting, and the production UI build pass after that
correction. The existing large-bundle warning remains. No weights were adopted,
no new model calls were made during verification, and nothing was committed
or published. Broader bot competence, fresh human-source holdouts, and improved
40-card mana planning remain follow-up work rather than established evidence.
