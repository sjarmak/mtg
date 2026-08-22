# @mtg/data

Local card-data store for the lab: streaming ingest of Scryfall bulk data and
MTGJSON vocabulary into better-sqlite3.

## Usage

```bash
# Download + ingest oracle cards and rulings (default kinds)
npx tsx packages/data/src/cli.ts ingest

# MTGJSON CardTypes/Keywords/EnumValues
npx tsx packages/data/src/cli.ts vocab

npx tsx packages/data/src/cli.ts stats
npx tsx packages/data/src/cli.ts find "Lightning Bolt" --exact
npx tsx packages/data/src/cli.ts colors UR --mode subset --limit 20

# `card` and `rulings` take an oracle id or a name; a name that matches several
# cards lists their oracle ids and exits non-zero instead of guessing.
npx tsx packages/data/src/cli.ts card "Lightning Bolt"
npx tsx packages/data/src/cli.ts rulings 4457ed35-7c10-48c8-9776-456485fdf070
npx tsx packages/data/src/cli.ts check-vocab flying firstStrike
```

## Reference-set corpus

The committed `data/reference-sets-v1.json` is a normalized printing-level
snapshot of M11, M13, M15, M20, ORI, ISD, RTR, RAV, ROE, SOM, KTK, and MH2.
It preserves every card-face record, collector number and rarity, identifies
tokens/promos/alternate treatments/ancillary cards separately from the base
set, and carries MTGJSON's weighted Draft Booster sheets. It deliberately omits
images, prices, purchase links, flavor text, and translations.

Regenerate it in one operation:

```bash
npm run reference:import
```

The command downloads one complete MTGJSON set document per code into the
gitignored `data/cache/` directory, verifies the pinned SHA-256 and MTGJSON
build/date before parsing, then atomically writes the normalized artifact. A
corrupt cached source is rejected instead of silently replaced. Updating the
snapshot requires changing the source manifest and its expected populations in
the same revision; ordinary runs never follow a moving upstream document.

Library consumers use `loadReferenceCorpus()`. The checked schema exposes base
set size as collector positions and card count as printing-face records, since
a double-faced card occupies one collector position but has two MTGJSON records.

## Static reference profiles

`data/reference-profiles-v1.json` is derived from that corpus with:

```bash
npm run reference:profiles
npm run reference:diff -- path/to/executable-set.json
```

Every rate and distribution names its exact population and count. Mechanic
as-fan instead names the expected physical cards in one weighted Draft Booster,
because unique collector positions are the wrong denominator for pack exposure.
M11 and M13 remain separate profiles. Their combined primary-core target uses
the intersection of explicit policy-tolerance bands where possible and a
configurable M13 precedence where the bands conflict. The tolerance-policy
version is separate from both corpus and profile versions; its bands are not
confidence intervals. M15, M20, and ORI remain secondary, every expansion stays
labeled, and MH2 is stress-only and absent from the primary aggregate.

These profiles are static censuses and warning proxies. They make no gameplay,
draft-pick, card-strength, archetype-viability, human-preference, or confidence
claim. Native simulation and human evidence must be stored as separate evidence
instead of overwriting the static artifact.

Default store `data/store/mtg.sqlite`, default download cache `data/cache/` —
both gitignored. `--db` and `--cache` override them.

## `--json`

`--json` is machine-readable on both outcomes, not just on success. A failing
run puts an envelope on stdout and still exits non-zero:

```json
{
  "error": {
    "name": "InvalidInputError",
    "message": "Invalid card reference: no card matches \"Jace, Wielder of Nonsense\" — try `find \"Jace, Wielder of Nonsense\"` to search"
  }
}
```

`name` is the class from `src/errors.ts` — `InvalidInputError`, `HttpError`,
`RemoteShapeError`, `DownloadIntegrityError`, `SchemaVersionError`, or `Error`
for anything a dependency threw — so a caller branches on the cause instead of
matching message text. No stack trace crosses the boundary. A dependency that
throws something that is not an `Error` at all reports as `NonError`, with the
value rendered into `message`.

Three rules a consumer can rely on:

- **The exit code is the authority, not the document shape.** 0 is success, 2 is
  an unknown command, 1 is every other failure. A structured error is still an
  error; do not infer success from parseable stdout.
- **stderr always carries the human line.** `--json` adds the stdout channel, it
  does not move the message off stderr. Progress during `ingest` is on stderr too,
  so stdout stays a single document.
- **One exception, by construction:** a broken stdout (`… | head -3` closing the
  pipe) exits 0 without an envelope, because there is nowhere to write one.

Re-running `ingest` is free when upstream has not rebuilt the file: change
detection is Scryfall's `bulk_data.updated_at`. Ctrl-C stops at the next batch
boundary and leaves a checkpoint; the next run resumes from it.

## Library

```ts
import { openStore, findCardsByColorIdentity, upsertLabCard } from '@mtg/data';
```

Tables: `oracle_card`, `printing`, `ruling` (each with the upstream record
verbatim in `raw_json` plus provenance columns), `ingest_run`, `ingest_reject`,
`vocabulary`. Generated cards use the same `oracle_card`/`printing` shape with
`source = 'lab'`, so queries do not care where a card came from.

`@mtg/data` deliberately does not depend on `@mtg/dsl`: the vocabulary module
(`buildVocabulary`, `unknownKeywords`, `isKnownSubtype`, …) is the artifact the
DSL can consume later for validation, and a dependency in this direction would
close the cycle.

## Sources and attribution

Card data from [Scryfall](https://scryfall.com), used under their API
guidelines: bulk-first, a pinned descriptive `User-Agent` and `Accept` header on
every request, rate limiting per their documented limits, no paywalling.
Vocabulary and reference-set data from [MTGJSON](https://mtgjson.com) (MIT).

Portions of the materials used are property of Wizards of the Coast. ©Wizards of
the Coast LLC. This lab is unofficial Fan Content permitted under the Fan
Content Policy. Not approved/endorsed by Wizards.

Full envelope: `docs/research/prior-art-data-sources.md` §1, §2, §6.
