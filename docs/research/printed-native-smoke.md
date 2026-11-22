# Printed Limited native-game discovery

`packages/ui/tools/printed-native-smoke.ts` samples a full seeded draft pod
(seats zero and one) or two seeded sealed pools, builds 40-card decks with the
existing printed structural policy, and runs one installed-Forge native-bot game.
It reuses the pinned format and catalogs; there is no second card database.

Run the opt-in integration fixture with an explicit, fresh output parent:

```bash
task_smoke_dir=$(mktemp -d /tmp/akh-hou-native-smoke-XXXXXX)
MTG_REQUIRE_PRINTED_NATIVE_SMOKE=1 MTG_PRINTED_NATIVE_SMOKE_OUT="$task_smoke_dir" npx vitest run packages/ui/test/tools/printed-native-smoke.integration.test.ts
```

This runs draft and sealed samples at seed 42. The callable tool also accepts
other seeds, validated format/catalog documents, and a bounded timeout. Existing
run directories are refused rather than overwritten. No shared backend restart,
UI staging, network model call, or admission change is involved.

Each private report records format/catalog fingerprints, pool and selected
physical identities, exact deck-file hashes, the installed bot/runtime fingerprint,
and the native result or failure. Native logs can include terminal hidden hands;
they must not enter the draft advisor or a public player observation stream.

## Interpretation

`completed-native-game` means only that the sampled native game finished.
Every report remains `qualification: unproven` and
`bridgeCoverage: not-exercised`: the native benchmark bypasses interactive bridge
decisions and its AI is not the bridge controller's complete policy. It is a
discovery tool, not a compatibility certificate, gameplay-quality evaluation, or
evidence that every card in either pool was exercised.

On 2026-09-12, both seed-42 installed samples passed. Private artifacts are in
`/tmp/akh-hou-native-smoke-iz4BZs/{draft,sealed}/`. These temporary artifacts are
not durable qualification evidence. Broader seeds and targeted interaction
fixtures remain necessary before enabling the full format's play action.
