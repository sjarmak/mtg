# Where Jev attaches to Stagehand

`mtg-onjme`, first-dispatch lane scope, item 1: "Answer the seam question from
the correction comment first, and write the answer down before building
anything ... Read the published package, not the README alone."

The question, from the mtg-pl correction comment (2026-09-22T02:25:35Z): does
Stagehand expose a way to substitute the model that makes the per-step
decision, or must `observe()` run on a chat model with Jev choosing among the
selectors it returns?

## Method

`npm pack @browserbasehq/stagehand@4.1.0` into a scratch directory and read the
extracted tarball directly — `dist/index.d.mts` (the shipped type
declarations) and `dist/index.mjs` (the shipped runtime) — rather than the
README. Version 4.1.0 is npm's `latest` dist-tag as of this check.

## Finding: a model-substitution seam exists, and it is the wrong shape for Jev

Stagehand does expose a seam. `StagehandClientCreateConfigSchema.model` is a
union of two things:

- `ModelConfigSchema` — the fixed hosted-provider roster (`modelName`, a
  template-literal enum of `"openai/..."`, `"anthropic/..."`,
  `"google/..."`, `"groq/..."`, `"cerebras/..."` strings, plus `apiKey`).
  This is what `act`/`observe`/`extract` call internally when Stagehand talks
  to the model itself.
- `ClientLLMSchema` — `{ generate: (params) => Promise<result> }`, doc
  comment: _"An LLM callback implemented locally by the SDK consumer. It
  never crosses the wire."_ Confirmed as a real, wired seam in the runtime,
  not just a type: `dist/index.mjs`,
  `if (createConfig.model && "generate" in createConfig.model)
this.removeClientLLMHandler = rpcClient.onRequest(StagehandMethods.llmGenerate,
createConfig.model.generate)`. When `model` carries a `generate` function,
  Stagehand routes every internal model call through it over RPC instead of
  calling a hosted provider itself.

So the substitution point the correction comment asked about is real. But its
signature rules out Jev as the thing plugged into it. From `dist/index.mjs`,
the callback's input/output types:

```
LLMGenerateBaseParamsSchema = { messages: LLMMessage[], systemPrompt?, temperature?, stopSequences? }
LLMMessageGenerateParamsSchema    = LLMGenerateBaseParamsSchema + { tools?, toolChoice?, responseFormat? }
LLMStructuredGenerateParamsSchema = LLMGenerateBaseParamsSchema + { responseFormat: json_schema }
LLMGenerateParamsSchema = union of the two

LLMGenerateResultSchema = { role, content, stopReason?, usage? } + outputFormat: 'text' | 'json_schema' (+ structuredContent)
```

`generate()` is a general chat-completion-with-tool-calling callback: Stagehand
hands it an arbitrary, internally-constructed message array (page context, the
task instruction, possibly a tool roster) and expects back either free text or
schema-constrained JSON. That is the shape `act`, `observe`, and `extract` use
internally to reason about the page and plan the next action — variable per
call, per Stagehand version, and never enumerated as named options.

Jev's `evaluate()` (`packages/draft-export/tools/jev-label/jev-client.ts`) is a
different, fixed shape: `{ state, questions: { [id]: { type: 'choice',
instructions, criteria: Record<optionId, string> } } }` in, `{ answers: {
[id]: { choice, probabilities? } } }` out. It answers "which of these N named
options" with probabilities; it does not generate free text, does not call
tools, and has no way to satisfy a `messages`-shaped chat request it never
sees framed as a menu. Wrapping `evaluate()` as a `ClientLLM.generate` would
mean reverse-engineering whatever prompt Stagehand's internal planner sends on
a given call and refitting it into a `choice` question on the fly — unstable
across Stagehand versions and not what the seam is for.

## Conclusion

The `ClientLLM` seam is real but is the wrong attachment point for Jev. The
correction comment's original design is the correct one and is confirmed by
the published package's types, not just plausible from the README:

1. `observe()` runs on a real hosted chat model (`ModelConfigSchema`,
   `modelName` from the fixed roster) and returns real candidates —
   `ObserveResult`/`ActionSchema`: `{ selector, description, method?,
arguments? }[]`.
2. Those candidates become one Jev `choice` question: `criteria` keyed by a
   synthetic per-candidate id, one line per candidate built from its
   `description` (and `method`/`arguments` where useful) — the same shape
   `packages/draft-export/tools/jev-label/questions.ts` already builds per
   draft pick, options keyed by card id.
3. The candidate Jev chooses is executed by its returned `selector`/`method`/
   `arguments` directly, not re-inferred from English. Enumerate, Jev chooses,
   execute — as the correction comment stated.

Jev attaches downstream of `observe()`, never inside `act`/`observe`/`extract`
via `ClientLLM`. The hosted chat model producing candidates and the model
paying for the eventual `act` call (if `act` is invoked with a raw instruction
rather than a pre-resolved selector) are a separate, real cost the $5 ceiling
has to cover; only the choice step is Jev's, and only the choice step is close
to free (`docs/research/jev-labeler-study.md`: ~$0.00005/answer market cost,
gateway-reported `cost` `0` on the free tier).

## Corrections to the original requirements' Notes section

Two things in the requirements doc's Notes are stale against the actual
4.1.0 package, found while reading it for the seam question:

- **"Stagehand wraps Playwright, so this adds Playwright as a dependency."**
  Not in 4.1.0: `package.json`'s `dependencies` are `@browserbasehq/sdk`,
  `@opentelemetry/api`, `@opentelemetry/core`, `zod` only, and no
  `playwright` string appears anywhere in `dist/index.mjs`. Stagehand ships
  its own `Page`/`Locator`/`BrowserContext` types instead. This may have been
  true of an earlier major version; it is not true of the version this
  prototype would install. Worth re-checking before adding it as a
  dependency, but there is nothing to keep out of the root install path on
  this account.
- **"Jev is not usable here."** Already corrected in the mtg-pl comment this
  doc follows up on; restated here only so a reader of the original doc who
  stops at the Notes section doesn't miss the correction.

## Cost-reporting shape (relevant to AC4's design, not its live numbers)

Neither Stagehand nor Jev's gateway reports a dollar figure directly.
`StagehandResultUsageSchema`/`StagehandMetricsSchema` (`dist/index.d.mts`)
report only token counts (`inputTokens`, `outputTokens`, `reasoningTokens`,
`cachedInputTokens`) and `inferenceTimeMs`, broken down per `act`/`observe`/
`extract` and summed as `total*`. Jev's `EvaluateResponseSchema.usage` is the
same shape (`inputTokens`/`outputTokens` only). AC4 ("measured cost per run is
in the report") therefore needs a price-per-token table keyed by whichever
`modelName` is configured, the same way the jev-labeler study derived its
$0.00005/answer market-cost figure externally rather than reading it off an
API response. This is a plumbing note for the reporting mechanism the lead
will read numbers from; the live numbers themselves are the lead's, per lane
scope.

## `mtg-onjme.1`: the journey steps, the telemetry fix, and the Chrome binary

The follow-up lane that fills the stub this doc's first-dispatch scope left
behind (`live-journey.ts`'s `main()` used to print "this build has no journey
steps re-expressed through Stagehand yet" and exit 2 whenever `--max-usd` was
armed with a reachable key). `packages/ui/tools/stagehand-runner.ts` is the new
file; `packages/ui/tools/live-journey.ts`'s armed branch reaches it through a
dynamic `import()`, so the no-flag path still never loads
`@browserbasehq/stagehand`.

### The three converted steps

Chosen for carrying the most hand-written selector work in their CDP versions,
so the conversion actually removes selector logic rather than adding a second
copy of it beside the original:

- **`printed-gallery-face-toggle`** — the CDP `printedJourney` step matches
  every button's accessible name against `FACE_FLIP_LABEL_SOURCE`
  (`^Show .+ face of `), a regex written specifically to avoid re-matching a
  card actually named "Show of Valor" (Magic 2014) after an earlier, looser
  match once clicked a card tile instead of the toggle. The Stagehand version
  asks `observe()` to find "the button on a card that shows the other face of
  a double-faced or modal card" and lets Jev choose among whatever candidates
  come back, so no hand-written label regex is needed at all.
- **`precon-your-deck-select`** — `printedPreconJourney` walks the page's
  controls looking for labels starting `SELECT`/`CHOOSE`, a heuristic guess at
  a UI convention rather than a specific accessible name. The Stagehand version
  asks `observe()` for "the control that lets you choose or open 'Your deck'
  for this precon pairing".
- **`printed-draft-first-pick`** — `Page.draftToCompletion`'s CDP version holds
  a selector chain for the pack-card grid, the specific click target, and the
  wait condition for the next pack. The Stagehand version asks `observe()` for
  "the first pickable card in the current draft pack" for one pick, which is
  the point of this conversion (the observe-choose-act pipeline on one
  control), not a second implementation of the whole draft loop.

Each step opens its own directly-navigable URL (gallery, precon/commander,
draft) rather than replaying the CDP steps that precede it in the full
journey, for the same reason: this proves the pipeline, not a parallel
journey.

### The telemetry finding

Stagehand's `StagehandCreateOptionsSchema` defaults `telemetry.traces.endpoint`
to `https://example.com/v1/traces` with no off switch (confirmed by reading
the schema directly, same method as the rest of this doc). The armed path
never lets that default reach a real host: `stagehand-telemetry.ts`'s
`loopbackTelemetryEndpoint()` builds an explicit `http://127.0.0.1:<port>/v1/traces`
URL, and `runLiveStagehandJourney` passes its string form as
`telemetry.traces.endpoint` on every `Stagehand.create()` call on this path.
`stagehand-telemetry.test.ts` asserts the built endpoint names `127.0.0.1` and
never `example.com`. Nothing has to be listening on that port for the option to
do its job — the requirement is that traces never leave the loopback
interface, not that they land somewhere.

### The Chrome binary

The armed path reuses the same chrome-headless-shell process
`live-journey.ts` already launches for the CDP journeys
(`packages/ui/test/support/chrome-driver.ts`'s `launchChrome`), connecting
Stagehand to it via `localBrowser.connect({ cdpUrl: chrome.debuggerUrl })`
rather than launching a second browser. Simpler than a second launch, and more
portable: it works anywhere the CDP journeys already run, with no second
browser binary to provision.

Whether chrome-headless-shell can load Stagehand's bundled extension was
unverified going into this lane, and remains unverified in the sense that no
live run has been made here (no key is available to this lane, and the bead
explicitly forbids trying to get one) — but the _refusal_ is now handled: it
throws either an untyped `Error` naming `Extensions.loadUnpacked` (the CDP
method itself unsupported) or the typed `StagehandRuntimeIncompatibleError`
(the extension loads but its RPC protocol version doesn't match this SDK's,
confirmed distinct by reading the class's declaration directly).
`stagehand-runtime.ts`'s `withRuntimePreflight` catches both and rethrows one
named `StagehandRuntimeRefusalError`. `runLiveStagehandJourney` wraps
`localBrowser.connect` and a throwaway `observe()` probe in it before any of
the three named steps runs, so either failure surfaces as a clean refusal
naming the cause, before the journey starts, rather than wherever the first
real step's `observe()` happens to touch the extension. Whether
chrome-headless-shell actually supports the extension is something only a live
run can answer, and that run belongs to the lead.

## 2026-09-22 (`mtg-onjme.2`): off the gateway

The armed path no longer touches the Vercel AI Gateway. Jev's call goes to
TypeSafe's own API, and the `observe()` model call goes through `@mtg/llm`.

### The direct Jev endpoint, as read

Read on 2026-09-22 from TypeSafe's published docs:
<https://docs.typesafe.ai/api.md> (the request and response),
<https://docs.typesafe.ai/models.md> (the model alias and the price), and
<https://docs.typesafe.ai/llms.txt> (the index that names both).

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`,
  `Content-Type: application/json`. The key variable the vendor's SDKs read is
  `TYPESAFE_API_KEY`.
- Body: `{ "state": {...}, "model": "jev-latest", "questions": {...} }`. The
  question shape is the one the gateway arm already sends (`type: "choice"`,
  `instructions`, one `criteria` sentence per option), so `chooseCandidate`
  did not change.
- Response: `{ "model": "jev-1.13.0", "answers": { <id>: { "type": "choice",
"choice", "probabilities", "confidence" } }, "usage": { "input_tokens",
"output_tokens" } }`. `probabilities` and `usage` are always present there;
  on the gateway both were optional. The model field names the release that
  answered, not the alias.
- Errors: 401 (bad key), 422 (a malformed request), 429 (rate), 529
  (overloaded, retry with backoff). The client treats 429 and 529 as rate
  refusals and stops rather than retrying.
- Price: $0.042 per million input tokens, output free. That is the only entry
  left in `stagehand-price-table.ts`.

`createJevDirectClient` in `packages/draft-export/tools/jev-label/jev-client.ts`
implements this beside the gateway arm, sharing one request path, and
normalizes the answer to the gateway's `EvaluateResponse` so nothing downstream
reads two shapes. The gateway arm and its labeler tests are unchanged.

### The `observe()` call needs structured output only

Reading Stagehand 4.1.0's shipped service worker: `observe()` and `act()` both
go through `generateStructured`, which calls `ClientLLM.generate` with
`responseFormat: { type: 'json_schema', name, schema }` and no tools, and
throws unless the answer comes back as `outputFormat: 'json_schema'` with
`structuredContent`. The bridge built in `mtg-onjme.1` answered with
`outputFormat: 'text'`, so it would have been refused on the first live call,
a failure no fake-session test could see. The rewritten bridge answers in the
structured shape, and its test validates that answer against Stagehand's own
exported `ClientLLMSchema`. A request for free text or for tool calling is
refused by name, since Stagehand does not send one.

### The meter is `@mtg/llm`'s guard

`--max-usd` becomes `BudgetLimits.maxUsd` on one `BudgetGuard`. The `observe()`
provider (claude-cli by default, whatever `MTG_LLM_PROVIDER` names otherwise)
asserts and records against it itself; Jev's calls are asserted and recorded
against the same guard by `meterJev`, priced from the table. The run report's
totals are that guard's snapshot, and `unreconciledCalls` sits beside the
dollars: a Jev answer arriving with no usage counts there, because it billed an
amount nobody measured.

### Refusals before Chrome

The key is read from the environment, then from a file named by
`--env-file <path>` (through `readEnvFileVariable`; there is no default path
and no search). A missing key exits 2 naming the variable and, when given, the
file, and never prints a value. A provider that cannot run (no `claude`
binary, or `anthropic-api` with no key) is also an exit 2. Both happen before
discovery and before Chrome launches.

### Not verified here

The three steps have not run end to end against a live page under the fixture
provider. A fixture is keyed on the exact prompt, and `observe()`'s prompt
carries the page's accessibility tree, so the recordings can only come from
one record-mode run with a real provider, which spends. The bridge's
record-then-replay under the fixture provider is covered in unit tests; the
live run, recording included, is the lead's call.
